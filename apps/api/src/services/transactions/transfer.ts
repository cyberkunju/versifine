/**
 * Wallet-to-wallet transfers.
 *
 * A transfer is two `transactions` rows linked by a shared `transfer_id`:
 *   - the from-side is `expense` against `fromWalletId`
 *   - the to-side is `income` against `toWalletId`
 *
 * If the wallets carry different currencies we convert to the destination's
 * currency (the destination is the one storing money, so its frame of
 * reference is the canonical one for the transfer). The from-side keeps the
 * original currency/amount; the to-side stores the converted amount in its
 * own currency. Both rows reference the rate used so the audit trail is
 * unambiguous.
 *
 * The whole thing runs in one Drizzle transaction so a partial failure
 * never leaves a half-transfer on the books.
 */
import { eq } from 'drizzle-orm';
import { type TransferInput, transferInput } from '@versifine/shared';
import { db } from '../../db/client.ts';
import { transactions, type Transaction } from '../../db/schema/transactions.ts';
import { wallets } from '../../db/schema/wallets.ts';
import { errors } from '../../utils/errors.ts';
import { emit } from '../events/bus.ts';
import { getRate } from '../fx/client.ts';
import { normalizeCurrencyCode, toBase } from '../fx/convert.ts';

export interface CreateTransferOptions {
  userId: string;
  spaceId: string;
  source: Transaction['source'];
  input: TransferInput | Record<string, unknown>;
}

export interface TransferResult {
  transferId: string;
  fromTransaction: Transaction;
  toTransaction: Transaction;
}

export async function createTransfer(opts: CreateTransferOptions): Promise<TransferResult> {
  const parsed = transferInput.parse(opts.input);
  if (parsed.fromWalletId === parsed.toWalletId) {
    throw errors.validation('Source and destination wallet must differ');
  }
  const today = parsed.date ?? new Date().toISOString().slice(0, 10);

  // Load both wallets in one round-trip and verify space ownership.
  const rows = await db
    .select({
      id: wallets.id,
      currency: wallets.currency,
      archivedAt: wallets.archivedAt,
      spaceId: wallets.spaceId,
      name: wallets.name,
    })
    .from(wallets)
    .where(eq(wallets.spaceId, opts.spaceId));
  const fromWallet = rows.find((r) => r.id === parsed.fromWalletId);
  const toWallet = rows.find((r) => r.id === parsed.toWalletId);
  if (!fromWallet || !toWallet) throw errors.notFound('Wallet not found in this space');
  if (fromWallet.archivedAt || toWallet.archivedAt) {
    throw errors.validation('Cannot transfer with an archived wallet');
  }

  const fromCurrency = normalizeCurrencyCode(fromWallet.currency);
  const toCurrency = normalizeCurrencyCode(toWallet.currency);

  // Resolve FX. The amount is denominated in the source wallet's currency.
  let fxRate = 1;
  let toAmount = parsed.amount;
  if (fromCurrency !== toCurrency) {
    fxRate = await getRate(fromCurrency, toCurrency);
    toAmount = toBase(parsed.amount, fromCurrency, toCurrency, fxRate);
  }

  const transferId = crypto.randomUUID();
  const description = parsed.description ?? `Transfer ${fromWallet.name} → ${toWallet.name}`;

  const result = await db.transaction(async (tx) => {
    const [fromRow] = await tx
      .insert(transactions)
      .values({
        spaceId: opts.spaceId,
        walletId: fromWallet.id,
        type: 'transfer',
        amount: parsed.amount.toFixed(2),
        currency: fromCurrency,
        baseAmount: parsed.amount.toFixed(2),
        fxRate: '1.00000000',
        description,
        category: 'Transfers',
        categoryConfidence: '1.00',
        categorizedBy: 'user',
        date: today,
        tags: [],
        source: opts.source,
        transferId,
        metadata: {
          side: 'from',
          counterpartWalletId: toWallet.id,
          convertedAmount: toAmount,
          convertedCurrency: toCurrency,
          fxRate,
        },
      })
      .returning();

    const [toRow] = await tx
      .insert(transactions)
      .values({
        spaceId: opts.spaceId,
        walletId: toWallet.id,
        type: 'transfer',
        amount: toAmount.toFixed(2),
        currency: toCurrency,
        baseAmount: toAmount.toFixed(2),
        fxRate: fxRate.toFixed(8),
        description,
        category: 'Transfers',
        categoryConfidence: '1.00',
        categorizedBy: 'user',
        date: today,
        tags: [],
        source: opts.source,
        transferId,
        metadata: {
          side: 'to',
          counterpartWalletId: fromWallet.id,
          originalAmount: parsed.amount,
          originalCurrency: fromCurrency,
          fxRate,
        },
      })
      .returning();

    if (!fromRow || !toRow) throw errors.internal('Transfer insert failed');
    return { fromRow, toRow };
  });

  // Emit one event per side so wallet balance subscribers get both legs.
  emit(opts.userId, {
    type: 'transaction.created',
    entityId: result.fromRow.id,
    data: {
      transactionId: result.fromRow.id,
      walletId: result.fromRow.walletId,
      type: result.fromRow.type as 'transfer',
      amount: Number(result.fromRow.amount),
      baseAmount: Number(result.fromRow.baseAmount),
      currency: result.fromRow.currency,
      date: result.fromRow.date,
      description: result.fromRow.description,
      category: result.fromRow.category,
    },
  });
  emit(opts.userId, {
    type: 'transaction.created',
    entityId: result.toRow.id,
    data: {
      transactionId: result.toRow.id,
      walletId: result.toRow.walletId,
      type: result.toRow.type as 'transfer',
      amount: Number(result.toRow.amount),
      baseAmount: Number(result.toRow.baseAmount),
      currency: result.toRow.currency,
      date: result.toRow.date,
      description: result.toRow.description,
      category: result.toRow.category,
    },
  });

  return {
    transferId,
    fromTransaction: result.fromRow,
    toTransaction: result.toRow,
  };
}

/** Make `eq` available to consumers that need to compose extra filters. */
export const _internals = { eq };
