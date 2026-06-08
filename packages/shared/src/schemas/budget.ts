import { z } from 'zod';
import { CATEGORIES } from '../categories.ts';

const allocationsSchema = z.record(z.enum(CATEGORIES), z.number().nonnegative());

export const budgetCreateInput = z
  .object({
    name: z.string().min(1).max(80),
    recurrence: z.enum(['monthly', 'custom']),
    periodStart: z.string().date().optional(),
    periodEnd: z.string().date().optional(),
    /** Per-category caps. May be empty when an `overallLimit` is given. */
    allocations: allocationsSchema.default({}),
    /** A single cap across ALL spending for the period (no-category budget). */
    overallLimit: z.number().positive().optional(),
    warnThreshold: z.number().min(1).max(100).default(80),
    exceedThreshold: z.number().min(1).max(200).default(100),
  })
  .superRefine((value, ctx) => {
    if (value.recurrence === 'custom' && (!value.periodStart || !value.periodEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'custom budgets require periodStart and periodEnd',
        path: ['periodStart'],
      });
    }
    const hasAllocations = Object.keys(value.allocations ?? {}).length > 0;
    if (!hasAllocations && value.overallLimit === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a budget needs at least one category allocation or an overall limit',
        path: ['allocations'],
      });
    }
  });
export type BudgetCreateInput = z.infer<typeof budgetCreateInput>;

export const budgetUpdateInput = z.object({
  name: z.string().min(1).max(80).optional(),
  allocations: allocationsSchema.optional(),
  overallLimit: z.number().positive().nullable().optional(),
  warnThreshold: z.number().min(1).max(100).optional(),
  exceedThreshold: z.number().min(1).max(200).optional(),
});
export type BudgetUpdateInput = z.infer<typeof budgetUpdateInput>;

export const budgetProgress = z.object({
  budgetId: z.string().uuid(),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  perCategory: z.record(
    z.enum(CATEGORIES),
    z.object({
      allocated: z.number(),
      spent: z.number(),
      remaining: z.number(),
      percentage: z.number(),
      status: z.enum(['ok', 'warn', 'exceeded']),
    }),
  ),
  /** Present when the budget has an overall (all-category) cap. */
  overall: z
    .object({
      limit: z.number(),
      spent: z.number(),
      remaining: z.number(),
      percentage: z.number(),
      status: z.enum(['ok', 'warn', 'exceeded']),
    })
    .nullable()
    .default(null),
  totals: z.object({
    allocated: z.number(),
    spent: z.number(),
    remaining: z.number(),
  }),
});
export type BudgetProgress = z.infer<typeof budgetProgress>;
