import { z } from 'zod';
import { CURRENCIES } from '../currencies.ts';

export const walletType = z.enum(['cash', 'bank', 'upi', 'credit_card', 'wallet']);
export type WalletType = z.infer<typeof walletType>;

export const walletCreateInput = z.object({
  name: z.string().min(1).max(80),
  type: walletType,
  currency: z.enum(CURRENCIES).default('INR'),
  /** Opening balance is optional. When > 0, an opening_balance transaction is recorded. */
  openingBalance: z.number().nonnegative().default(0),
});
export type WalletCreateInput = z.infer<typeof walletCreateInput>;

export const walletUpdateInput = z.object({
  name: z.string().min(1).max(80).optional(),
  archived: z.boolean().optional(),
});
export type WalletUpdateInput = z.infer<typeof walletUpdateInput>;

export const walletSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: walletType,
  currency: z.enum(CURRENCIES),
  /** Live balance in the wallet's own currency. */
  balance: z.number(),
  archived: z.boolean(),
  createdAt: z.string().datetime(),
});
export type WalletSummary = z.infer<typeof walletSummary>;

export const transferInput = z.object({
  fromWalletId: z.string().uuid(),
  toWalletId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().min(1).max(200).optional(),
  date: z.string().date().optional(),
});
export type TransferInput = z.infer<typeof transferInput>;
