/**
 * Transaction creation pipeline.
 *
 * Steps:
 *   1. Validate the wallet belongs to the caller's space (no cross-tenant writes).
 *   2. Normalize the merchant from the description.
 *   3. If no category was supplied, run the categorizer (with a defensive fallback).
 *   4. Resolve the FX rate against the wallet's currency. We compute
 *      `baseAmount` in the wallet's currency — wallet-currency is the canonical
 *      "base" for the row because every per-wallet aggregate sums in that unit.
 *      For cross-space reporting the caller can still convert into the user's
 *      base via the FX layer.
 *   5. Insert the row inside a transaction.
 *   6. Emit `transaction.created` on the events bus.
 */
import { and, eq } from 'drizzle-orm';
import {
  CATEGORIES,
  CURRENCIES,
  type Category,
  type TransactionCreateInput,
  transactionCreateInput,
} from '@versifine/shared';
import { db, type Db, type DbTx } from '../../db/client.ts';
import { transactions, type Transaction } from '../../db/schema/transactions.ts';
import { wallets } from '../../db/schema/wallets.ts';
import { errors } from '../../utils/errors.ts';
import { log } from '../../utils/logger.ts';
import { safeCategorize, safeNormalizeMerchant } from '../categorize/_safe.ts';
import { recomputeAffectedBudgets } from '../budgets/index.ts';
import { emit } from '../events/bus.ts';
import { getRate } from '../fx/client.ts';
import { normalizeCurrencyCode, toBase } from '../fx/convert.ts';
import { recordMutation, snapshotTx } from './mutations.ts';
import { enqueueEmbed } from './embed.ts';

export interface CreateTransactionOptions {
  userId: string;
  spaceId: string;
  source: Transaction['source'];
  input: TransactionCreateInput | Record<string, unknown>;
}

/**
 * Result of a successful create. The `undoToken` is the user-facing 6-char
 * handle the bot surfaces in its reply ("✅ Logged ₹50 · undo K7P2A9") and
 * the user types back to reverse THIS specific create. Transactions stay
 * lookups by the UUID `row.id` internally; the token is the conversational
 * layer (L2-2).
 */
export interface CreateTransactionResult {
  row: Transaction;
  undoToken: string;
}

export async function createTransaction(opts: CreateTransactionOptions): Promise<CreateTransactionResult> {
  const parsed = transactionCreateInput.parse(opts.input);
  return await persist(opts.userId, opts.spaceId, opts.source, parsed, db);
}

/** Variant that runs inside an existing Drizzle transaction (for batch imports). */
export async function createTransactionInTx(
  opts: CreateTransactionOptions & { tx: Db | DbTx },
): Promise<CreateTransactionResult> {
  const parsed = transactionCreateInput.parse(opts.input);
  return await persist(opts.userId, opts.spaceId, opts.source, parsed, opts.tx);
}

async function persist(
  userId: string,
  spaceId: string,
  source: Transaction['source'],
  parsed: TransactionCreateInput,
  database: Db | DbTx,
): Promise<CreateTransactionResult> {
  const [wallet] = await database
    .select({
      id: wallets.id,
      currency: wallets.currency,
      archivedAt: wallets.archivedAt,
      spaceId: wallets.spaceId,
    })
    .from(wallets)
    .where(and(eq(wallets.id, parsed.walletId), eq(wallets.spaceId, spaceId)))
    .limit(1);
  if (!wallet) throw errors.notFound('Wallet not found in this space');
  if (wallet.archivedAt) throw errors.validation('Cannot post to an archived wallet');

  const requestedCurrency = normalizeCurrencyCode(parsed.currency ?? wallet.currency);
  if (!CURRENCIES.includes(requestedCurrency as (typeof CURRENCIES)[number])) {
    throw errors.validation('Unsupported currency', { currency: requestedCurrency });
  }

  // Categorize when the caller didn't specify one.
  let category: TransactionCreateInput['category'] | null = parsed.category ?? null;
  let categoryConfidence: number | null = null;
  let categorizedBy: Transaction['categorizedBy'] = parsed.categorizedBy ?? null;

  if (!category && parsed.type === 'expense') {
    const result = await safeCategorize(spaceId, parsed.description);
    category = isCategoryString(result.category) ? result.category : 'Other';
    categoryConfidence = result.confidence;
    categorizedBy = result.categorizedBy;
  } else if (category && !categorizedBy) {
    categorizedBy = 'user';
    categoryConfidence = 1;
  }

  // Pre-compute normalized merchant (used by overrides, recurring detector, etc.).
  // We don't store it directly on the row; downstream modules recompute it. But
  // resolving it here keeps the contract symmetrical with the corrections path.
  void (await safeNormalizeMerchant(parsed.description));

  // FX: convert into wallet currency. The wallet IS the row's currency boundary.
  const walletCurrency = normalizeCurrencyCode(wallet.currency);
  let fxRate = 1;
  let baseAmount = parsed.amount;
  let needsFxResolution = false;

  if (requestedCurrency !== walletCurrency) {
    try {
      fxRate = await getRate(requestedCurrency, walletCurrency);
      baseAmount = toBase(parsed.amount, requestedCurrency, walletCurrency, fxRate);
    } catch (err) {
      log.warn('FX_RESOLUTION_DEFERRED', {
        spaceId,
        from: requestedCurrency,
        to: walletCurrency,
        error: err instanceof Error ? err.message : String(err),
      });
      fxRate = 1;
      baseAmount = parsed.amount;
      needsFxResolution = true;
    }
  }

  const stored = await database.transaction(async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values({
        spaceId,
        walletId: wallet.id,
        type: parsed.type,
        amount: parsed.amount.toFixed(2),
        currency: requestedCurrency,
        baseAmount: baseAmount.toFixed(2),
        fxRate: fxRate.toFixed(8),
        description: parsed.description,
        category,
        categoryConfidence: categoryConfidence !== null ? categoryConfidence.toFixed(2) : null,
        categorizedBy,
        date: parsed.date,
        notes: parsed.notes ?? null,
        tags: parsed.tags,
        source,
        needsFxResolution,
      })
      .returning();
    if (!row) throw errors.internal('Failed to insert transaction');
    // Audit + undo stack: record the create atomically with the insert so
    // "undo" right after a log removes this exact row. recordMutation
    // returns the user-facing token (L2-2) — the bot surfaces it in the
    // reply so the user can type it to reverse THIS specific create.
    const { token } = await recordMutation(tx, {
      spaceId,
      userId,
      transactionId: row.id,
      action: 'create',
      after: snapshotTx(row),
      source,
    });
    return { row, undoToken: token };
  });

  // Post-commit side effects MUST NOT throw: the row is already committed, so
  // a throw here would surface as a create failure to the caller (and, in the
  // compound-plan executor, could mislead the double-write guard). Each is
  // best-effort and independently swallowed.
  try {
    emitCreated(userId, stored.row);
  } catch (err) {
    log.warn('EMIT_CREATED_FAIL', { error: err instanceof Error ? err.message : String(err) });
  }
  // Best-effort RAG embedding for EVERY creation path (manual web, CSV
  // import, copilot tool, capture/confirm). Fire-and-forget — never blocks
  // the create. The job resolves the row by id at run time, so it works
  // even when this persist ran inside a batch-import transaction that
  // commits slightly later.
  try {
    enqueueEmbed(stored.row.id, stored.row.description);
  } catch (err) {
    log.warn('ENQUEUE_EMBED_FAIL', { error: err instanceof Error ? err.message : String(err) });
  }
  // Fire-and-forget budget recompute. We never block the create path on this.
  void recomputeAffectedBudgets(userId, spaceId, stored.row.category).catch((err) => {
    log.warn('BUDGET_RECOMPUTE_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  // Forecast cache: any new spend invalidates it. Lazy-import the
  // forecaster so this module stays cycle-free with services/forecast which
  // pulls schemas through here.
  void import('../forecast/index.ts')
    .then((mod) => {
      mod.invalidateForecast(spaceId);
    })
    .catch(() => {
      // The forecast module is optional at boot; if it fails to load there's
      // nothing useful to log to the user.
    });
  return stored;
}

/** Internal: post the WS event. Kept separate so importers can disable it for bulk loads. */
export function emitCreated(userId: string, row: Transaction): void {
  // Filter out soft-deleted rows; emitCreated is normally only called on fresh inserts.
  if (row.deletedAt) return;
  emit(userId, {
    type: 'transaction.created',
    entityId: row.id,
    data: {
      transactionId: row.id,
      walletId: row.walletId,
      type: row.type as 'income' | 'expense' | 'transfer' | 'opening_balance',
      amount: Number(row.amount),
      baseAmount: Number(row.baseAmount),
      currency: row.currency,
      date: row.date,
      description: row.description,
      category: row.category,
    },
  });
}

/** Touched? signal so callers can hold the existing rule about excluding deletions. */
export function isLiveTransaction(t: Pick<Transaction, 'deletedAt'>): boolean {
  return t.deletedAt === null;
}

/** Re-export for tests / consumers that want to skip the create wrapper. */
export { transactions } from '../../db/schema/transactions.ts';

function isCategoryString(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
