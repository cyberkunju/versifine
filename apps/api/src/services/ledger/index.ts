/**
 * Lend / borrow ledger.
 *
 * The ledger is the system's memory of money the user has loaned out
 * (`direction='lent'`) or borrowed (`direction='borrowed'`). An entry is
 * created with `outstanding === baseAmount` and `status='open'`. As
 * settlements come in we decrement `outstanding`; the status is then
 * `partial` until it hits zero, at which point it becomes `settled`.
 *
 * Settlement may optionally produce a wallet transaction so cash actually
 * moves on the books — when settling a `lent` entry the counterparty gave
 * us money back, so we record an `income` transaction; when settling a
 * `borrowed` entry we paid them, so it's an `expense`. The transaction id
 * is then stored as `linked_transaction_id` on the settlement so the UI
 * can drill from one to the other.
 *
 * This iteration intentionally exposes no `update`/`delete` on entries —
 * losing audit history of who-owes-whom is a worse failure mode than
 * forcing a contra-entry to undo a mistake.
 */
import { and, eq, sql as drizzleSql } from 'drizzle-orm';
import {
  type LedgerCreateInput,
  type LedgerDirection,
  type LedgerEntrySummary,
  type LedgerSettlementInput,
  type LedgerStatus,
} from '@versifine/shared';
import { db } from '../../db/client.ts';
import {
  ledgerEntries,
  ledgerSettlements,
  type LedgerEntry,
  type LedgerSettlement,
} from '../../db/schema/ledger.ts';
import { wallets } from '../../db/schema/wallets.ts';
import { errors } from '../../utils/errors.ts';
import { log } from '../../utils/logger.ts';
import { emit } from '../events/bus.ts';
import { getRate } from '../fx/client.ts';
import { normalizeCurrencyCode, toBase } from '../fx/convert.ts';
import { createTransactionInTx } from '../transactions/create.ts';

interface ListLedgerOpts {
  direction?: LedgerDirection;
  status?: LedgerStatus;
  counterpartyName?: string;
}

export async function listLedger(
  spaceId: string,
  opts: ListLedgerOpts = {},
): Promise<LedgerEntry[]> {
  const filters = [eq(ledgerEntries.spaceId, spaceId)];
  if (opts.direction) filters.push(eq(ledgerEntries.direction, opts.direction));
  if (opts.status) filters.push(eq(ledgerEntries.status, opts.status));
  if (opts.counterpartyName) {
    filters.push(eq(ledgerEntries.counterpartyName, opts.counterpartyName));
  }
  return await db
    .select()
    .from(ledgerEntries)
    .where(and(...filters))
    .orderBy(drizzleSql`${ledgerEntries.date} desc, ${ledgerEntries.createdAt} desc`);
}

export async function getEntry(spaceId: string, entryId: string): Promise<LedgerEntry | null> {
  const [row] = await db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.spaceId, spaceId)))
    .limit(1);
  return row ?? null;
}

/**
 * Create a ledger entry. The amount is recorded in its native currency,
 * then converted into the user's base for `baseAmount`/`outstanding` so
 * cross-currency aggregation works without re-fetching FX. If the FX
 * fetch fails we fall back to a 1:1 rate and trust the upstream cache;
 * the entry is still usable, just with a possibly imprecise base amount.
 */
export async function createEntry(
  userId: string,
  spaceId: string,
  baseCurrency: string,
  input: LedgerCreateInput,
): Promise<LedgerEntry> {
  const native = normalizeCurrencyCode(input.currency);
  const base = normalizeCurrencyCode(baseCurrency);

  let fxRate = 1;
  if (native !== base) {
    try {
      fxRate = await getRate(native, base);
    } catch (err) {
      log.warn('LEDGER_FX_FALLBACK', {
        spaceId,
        from: native,
        to: base,
        error: err instanceof Error ? err.message : String(err),
      });
      fxRate = 1;
    }
  }

  const baseAmount = toBase(input.amount, native, base, fxRate);

  const [row] = await db
    .insert(ledgerEntries)
    .values({
      spaceId,
      direction: input.direction === 'lent' ? 'lent' : 'borrowed',
      counterpartyName: input.counterpartyName,
      amount: input.amount.toFixed(2),
      currency: native,
      baseAmount: baseAmount.toFixed(2),
      outstanding: baseAmount.toFixed(2),
      status: 'open',
      date: input.date,
      note: input.note ?? null,
      linkedTransactionId: input.linkedTransactionId ?? null,
    })
    .returning();
  if (!row) throw errors.internal('Ledger create failed');

  // Post-commit, best-effort — must not throw (the row is already written).
  try {
    emitUpdated(userId, row);
  } catch (err) {
    log.warn('LEDGER_EMIT_FAIL', { error: err instanceof Error ? err.message : String(err) });
  }
  return row;
}

/**
 * Apply a settlement. All writes happen inside one Postgres transaction so
 * a partially-applied settlement is impossible — either the ledger row is
 * decremented and (optionally) a wallet transaction was created, or
 * nothing changed at all.
 */
export async function settleEntry(
  userId: string,
  spaceId: string,
  entryId: string,
  baseCurrency: string,
  input: LedgerSettlementInput,
): Promise<{ entry: LedgerEntry; settlement: LedgerSettlement }> {
  const existing = await getEntry(spaceId, entryId);
  if (!existing) throw errors.notFound('Ledger entry not found');
  if (existing.status === 'settled') {
    throw errors.validation('Entry is already settled');
  }
  if (input.amount <= 0) {
    throw errors.validation('Settlement amount must be positive');
  }

  const outstandingBefore = Number(existing.outstanding);
  if (input.amount - outstandingBefore > 0.005) {
    throw errors.validation('Settlement exceeds outstanding balance', {
      outstanding: outstandingBefore,
      amount: input.amount,
    });
  }

  // If a wallet was supplied, validate it up front (outside the tx is fine —
  // the wallet's identity won't change between this read and the inner read).
  let wallet: { id: string; currency: string } | null = null;
  if (input.walletId) {
    const [w] = await db
      .select({ id: wallets.id, currency: wallets.currency, archivedAt: wallets.archivedAt })
      .from(wallets)
      .where(and(eq(wallets.id, input.walletId), eq(wallets.spaceId, spaceId)))
      .limit(1);
    if (!w) throw errors.notFound('Wallet not found in this space');
    if (w.archivedAt) throw errors.validation('Cannot settle into an archived wallet');
    wallet = { id: w.id, currency: w.currency };
  }

  const result = await db.transaction(async (tx) => {
    let linkedTransactionId: string | null = null;

    if (wallet) {
      // lent → counterparty repaid us → income on the wallet.
      // borrowed → we paid them → expense on the wallet.
      const txType = existing.direction === 'lent' ? 'income' : 'expense';
      const description =
        existing.direction === 'lent'
          ? `Repayment from ${existing.counterpartyName}`
          : `Repayment to ${existing.counterpartyName}`;

      const created = await createTransactionInTx({
        userId,
        spaceId,
        source: 'manual_web',
        tx,
        input: {
          type: txType,
          amount: input.amount,
          currency: baseCurrency,
          date: input.date,
          description,
          walletId: wallet.id,
          tags: ['ledger'],
        },
      });
      linkedTransactionId = created.row.id;
    }

    const [settlement] = await tx
      .insert(ledgerSettlements)
      .values({
        ledgerEntryId: entryId,
        amount: input.amount.toFixed(2),
        date: input.date,
        linkedTransactionId,
      })
      .returning();
    if (!settlement) throw errors.internal('Failed to record settlement');

    const outstandingAfter = round2(outstandingBefore - input.amount);
    const baseAmount = Number(existing.baseAmount);
    let nextStatus: LedgerStatus;
    if (outstandingAfter <= 0) {
      nextStatus = 'settled';
    } else if (outstandingAfter < baseAmount) {
      nextStatus = 'partial';
    } else {
      nextStatus = 'open';
    }

    const [updated] = await tx
      .update(ledgerEntries)
      .set({
        outstanding: Math.max(0, outstandingAfter).toFixed(2),
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.spaceId, spaceId)))
      .returning();
    if (!updated) throw errors.internal('Failed to update ledger entry');

    return { entry: updated, settlement };
  });

  emitUpdated(userId, result.entry);
  return result;
}

export function serializeEntry(row: LedgerEntry): LedgerEntrySummary {
  return {
    id: row.id,
    direction: (row.direction === 'lent' ? 'lent' : 'borrowed') as LedgerDirection,
    counterpartyName: row.counterpartyName,
    amount: Number(row.amount),
    currency: row.currency as LedgerEntrySummary['currency'],
    baseAmount: Number(row.baseAmount),
    outstanding: Number(row.outstanding),
    status: row.status as LedgerStatus,
    date: row.date,
    note: row.note,
    linkedTransactionId: row.linkedTransactionId,
    createdAt: row.createdAt.toISOString(),
  };
}

function emitUpdated(userId: string, row: LedgerEntry): void {
  emit(userId, {
    type: 'ledger.updated',
    entityId: row.id,
    data: {
      entryId: row.id,
      direction: (row.direction === 'lent' ? 'lent' : 'borrowed') as LedgerDirection,
      outstanding: Number(row.outstanding),
      status: row.status as LedgerStatus,
    },
  });
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export type { LedgerEntry, LedgerSettlement } from '../../db/schema/ledger.ts';
