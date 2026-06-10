/**
 * Bridge between the parser output and the canonical create-transaction
 * service.
 *
 * `createTransaction` lives in `services/transactions/create.ts` and is
 * imported statically so the dependency survives bundling (`bun build`).
 * The earlier string-concatenated `await import('../transactions/' +
 * 'create.ts')` trick hid the dep from the bundler, which left a raw
 * runtime `import()` in `dist/index.js` that resolved against `dist/` and
 * always threw — silently degrading every capture to "service unavailable"
 * in production. We still try/catch the call itself so a genuine runtime
 * failure surfaces as a structured error instead of crashing the request.
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
import { createTransaction } from '../transactions/create.ts';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { wallets } from '../../db/schema/wallets.ts';

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
    baseAmount?: number;
    baseCurrency?: string;
    description: string;
    date: string;
    category: string | null;
    /** User-facing 6-char undo token (L2-2). Present on the create path. */
    undoToken?: string;
  };
}

export interface PersistFailure {
  ok: false;
  reason: 'service_unavailable' | 'bad_input';
  message: string;
}

export async function persistDraft(input: PersistInput): Promise<PersistResult | PersistFailure> {
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
  // Carry the user's extra context/story onto the transaction notes.
  if (draft.notes && draft.notes.trim()) {
    payload.notes = draft.notes.trim().slice(0, 2000);
  }
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
    const [wallet] = await db
      .select({ currency: wallets.currency })
      .from(wallets)
      .where(eq(wallets.id, input.walletId))
      .limit(1);
    const walletCurrency = wallet?.currency ?? 'INR';

    const { row, undoToken } = await createTransaction({
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
        baseAmount: Number(row.baseAmount),
        baseCurrency: walletCurrency,
        description: row.description,
        date: row.date,
        category: row.category,
        undoToken,
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
