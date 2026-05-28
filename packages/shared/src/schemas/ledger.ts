import { z } from 'zod';
import { CURRENCIES } from '../currencies.ts';

export const ledgerDirection = z.enum(['lent', 'borrowed']);
export type LedgerDirection = z.infer<typeof ledgerDirection>;

export const ledgerStatus = z.enum(['open', 'partial', 'settled']);
export type LedgerStatus = z.infer<typeof ledgerStatus>;

export const ledgerCreateInput = z.object({
  direction: ledgerDirection,
  counterpartyName: z.string().min(1).max(120),
  amount: z.number().positive(),
  currency: z.enum(CURRENCIES).default('INR'),
  date: z.string().date(),
  note: z.string().max(280).optional(),
  linkedTransactionId: z.string().uuid().optional(),
});
export type LedgerCreateInput = z.infer<typeof ledgerCreateInput>;

export const ledgerSettlementInput = z.object({
  amount: z.number().positive(),
  date: z.string().date(),
  /** When set, the settlement also creates a wallet transaction. */
  walletId: z.string().uuid().optional(),
});
export type LedgerSettlementInput = z.infer<typeof ledgerSettlementInput>;

export const ledgerEntrySummary = z.object({
  id: z.string().uuid(),
  direction: ledgerDirection,
  counterpartyName: z.string(),
  amount: z.number(),
  currency: z.enum(CURRENCIES),
  baseAmount: z.number(),
  outstanding: z.number(),
  status: ledgerStatus,
  date: z.string().date(),
  note: z.string().nullable(),
  linkedTransactionId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type LedgerEntrySummary = z.infer<typeof ledgerEntrySummary>;
