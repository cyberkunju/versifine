import { z } from 'zod';
import { CATEGORIES } from '../categories.ts';
import { CURRENCIES } from '../currencies.ts';

export const transactionType = z.enum(['income', 'expense', 'transfer', 'opening_balance']);
export type TransactionType = z.infer<typeof transactionType>;

export const transactionSource = z.enum([
  'manual_web',
  'whatsapp_text',
  'whatsapp_voice',
  'whatsapp_image',
  'csv_import',
  'recurring_engine',
]);
export type TransactionSource = z.infer<typeof transactionSource>;

export const categorizedBy = z.enum([
  'user',
  'minilm',
  'overrides',
  'merchants',
  'llm',
  'client',
  'default',
]);
export type CategorizedBy = z.infer<typeof categorizedBy>;

export const transactionCreateInput = z.object({
  type: transactionType.exclude(['opening_balance']),
  amount: z.number().positive(),
  currency: z.enum(CURRENCIES).default('INR'),
  date: z.string().date(),
  description: z.string().min(1).max(280),
  walletId: z.string().uuid(),
  category: z.enum(CATEGORIES).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(10).default([]),
  /** Set when categorisation already happened on the client (Privacy Mode). */
  categorizedBy: categorizedBy.optional(),
  /** Original transaction (FX): kept verbatim if currency != base. */
  originalAmount: z.number().positive().optional(),
  originalCurrency: z.enum(CURRENCIES).optional(),
});
export type TransactionCreateInput = z.infer<typeof transactionCreateInput>;

export const transactionUpdateInput = z.object({
  amount: z.number().positive().optional(),
  currency: z.enum(CURRENCIES).optional(),
  date: z.string().date().optional(),
  description: z.string().min(1).max(280).optional(),
  walletId: z.string().uuid().optional(),
  category: z.enum(CATEGORIES).optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(10).optional(),
});
export type TransactionUpdateInput = z.infer<typeof transactionUpdateInput>;

export const transactionListQuery = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  type: transactionType.optional(),
  category: z.enum(CATEGORIES).optional(),
  walletId: z.string().uuid().optional(),
  search: z.string().max(120).optional(),
  tag: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TransactionListQuery = z.infer<typeof transactionListQuery>;

export const transactionSummary = z.object({
  id: z.string().uuid(),
  type: transactionType,
  amount: z.number(),
  currency: z.enum(CURRENCIES),
  baseAmount: z.number(),
  date: z.string().date(),
  description: z.string(),
  category: z.enum(CATEGORIES).nullable(),
  categoryConfidence: z.number().min(0).max(1).nullable(),
  categorizedBy: categorizedBy.nullable(),
  walletId: z.string().uuid(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  source: transactionSource,
  transferId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TransactionSummary = z.infer<typeof transactionSummary>;
