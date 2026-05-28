import { z } from 'zod';
import { CATEGORIES } from '../categories.ts';

const allocationsSchema = z
  .record(z.enum(CATEGORIES), z.number().nonnegative())
  .refine((rec) => Object.keys(rec).length > 0, 'at least one allocation required');

export const budgetCreateInput = z
  .object({
    name: z.string().min(1).max(80),
    recurrence: z.enum(['monthly', 'custom']),
    periodStart: z.string().date().optional(),
    periodEnd: z.string().date().optional(),
    allocations: allocationsSchema,
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
  });
export type BudgetCreateInput = z.infer<typeof budgetCreateInput>;

export const budgetUpdateInput = z.object({
  name: z.string().min(1).max(80).optional(),
  allocations: allocationsSchema.optional(),
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
  totals: z.object({
    allocated: z.number(),
    spent: z.number(),
    remaining: z.number(),
  }),
});
export type BudgetProgress = z.infer<typeof budgetProgress>;
