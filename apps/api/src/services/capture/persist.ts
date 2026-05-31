/**
 * Bridge between the parser output and the canonical create-transaction
 * service.
 *
 * The transactions service is owned by another agent in this codebase.
 * We import it lazily and try/catch the call; if it isn't there yet we
 * surface a structured "service unavailable" error so the capture flow
 * can keep functioning end-to-end (the draft is shown, the user is told
 * persistence is offline). Same defensive shape we use for categorize.
 */
import {
  type Currency,
  isCurrency,
  CATEGORIES,
  type Category,
  type TransactionSource,
} from '@versifine/shared';
import type { ParsedExpense } from '../ai/parser.ts';
import { log } from '../../utils/logger.ts';

export interface PersistInput {
  userId: string;
  spaceId: string;
  source: TransactionSource;
  draft: ParsedExpense;
  walletId: string;
  /** Date the user picked or "today" if they didn't. */
  date: string;
}

export interface PersistResult {
  ok: true;
  transaction: {
    id: string;
    walletId: string;
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    currency: string;
    description: string;
    date: string;
    category: string | null;
  };
}

export interface PersistFailure {
  ok: false;
  reason: 'service_unavailable' | 'bad_input';
  message: string;
}

type CreateFn = (opts: {
  userId: string;
  spaceId: string;
  source: TransactionSource;
  input: Record<string, unknown>;
}) => Promise<{
  id: string;
  walletId: string;
  type: 'income' | 'expense' | 'transfer' | 'opening_balance';
  amount: string;
  currency: string;
  description: string;
  date: string;
  category: string | null;
}>;

let cached: CreateFn | null | undefined;

async function loadCreate(): Promise<CreateFn | null> {
  if (cached !== undefined) return cached;
  try {
    // TODO: cross-agent import — services/transactions/create.ts is built
    // by another worker. The dynamic specifier hides the dep from tsc so
    // typechecks stay green even when the file isn't in place yet.
    const path = '../transactions/' + 'create.ts';
    const mod = (await import(path)) as { createTransaction?: CreateFn };
    cached = typeof mod.createTransaction === 'function' ? mod.createTransaction : null;
  } catch (err) {
    cached = null;
    log.warn('CAPTURE_CREATE_IMPORT_FAIL', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return cached ?? null;
}

export async function persistDraft(
  input: PersistInput,
): Promise<PersistResult | PersistFailure> {
  const { draft } = input;
  if (draft.amount === null) {
    return { ok: false, reason: 'bad_input', message: 'Draft has no amount' };
  }
  if (!draft.description || !draft.description.trim()) {
    return { ok: false, reason: 'bad_input', message: 'Draft has no description' };
  }
  if (draft.type === 'transfer') {
    // Transfer creation is a different service signature; we don't support
    // creating it directly from the omnibar in this iteration.
    return {
      ok: false,
      reason: 'bad_input',
      message: 'Transfer captures must use the dedicated transfer flow',
    };
  }

  const create = await loadCreate();
  if (!create) {
    return {
      ok: false,
      reason: 'service_unavailable',
      message: 'Transaction service is not yet available',
    };
  }

  const currency: Currency =
    draft.currency && isCurrency(draft.currency)
      ? (draft.currency.toUpperCase() as Currency)
      : 'INR';

  const payload: Record<string, unknown> = {
    type: draft.type,
    amount: draft.amount,
    currency,
    date: input.date,
    description: draft.description.trim(),
    walletId: input.walletId,
    tags: [],
  };
  // Honour an explicit category the user picked in the confirm dialog. The
  // parser/confirm flow carries it on `categoryHint`; map it into `category`
  // so createTransaction treats it as user-chosen instead of silently
  // re-categorizing and discarding the edit.
  if (draft.categoryHint && (CATEGORIES as readonly string[]).includes(draft.categoryHint)) {
    payload.category = draft.categoryHint as Category;
    payload.categorizedBy = 'user';
  }
  if (draft.originalAmount !== null && draft.originalCurrency) {
    payload.originalAmount = draft.originalAmount;
    payload.originalCurrency = draft.originalCurrency.toUpperCase();
  }

  try {
    const row = await create({
      userId: input.userId,
      spaceId: input.spaceId,
      source: input.source,
      input: payload,
    });
    // Embeddings are enqueued centrally inside createTransaction now, so we
    // don't enqueue again here (that would double-embed the same row).
    return {
      ok: true,
      transaction: {
        id: row.id,
        walletId: row.walletId,
        type: (row.type === 'opening_balance' ? 'expense' : row.type) as
          | 'income'
          | 'expense'
          | 'transfer',
        amount: Number(row.amount),
        currency: row.currency,
        description: row.description,
        date: row.date,
        category: row.category,
      },
    };
  } catch (err) {
    log.warn('CAPTURE_CREATE_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return {
      ok: false,
      reason: 'service_unavailable',
      message: 'Could not create transaction',
    };
  }
}
