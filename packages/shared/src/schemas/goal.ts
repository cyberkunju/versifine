import { z } from 'zod';
import { CATEGORIES } from '../categories.ts';

export const goalStatus = z.enum(['active', 'achieved', 'archived']);
export type GoalStatus = z.infer<typeof goalStatus>;

export const goalCreateInput = z.object({
  name: z.string().min(1).max(80),
  targetAmount: z.number().positive(),
  currentAmount: z.number().nonnegative().default(0),
  deadline: z.string().date().optional(),
  linkedCategory: z.enum(CATEGORIES).optional(),
});
export type GoalCreateInput = z.infer<typeof goalCreateInput>;

export const goalUpdateInput = z.object({
  name: z.string().min(1).max(80).optional(),
  targetAmount: z.number().positive().optional(),
  currentAmount: z.number().nonnegative().optional(),
  deadline: z.string().date().nullable().optional(),
  linkedCategory: z.enum(CATEGORIES).nullable().optional(),
  status: goalStatus.optional(),
});
export type GoalUpdateInput = z.infer<typeof goalUpdateInput>;

export const goalSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  targetAmount: z.number(),
  currentAmount: z.number(),
  deadline: z.string().date().nullable(),
  linkedCategory: z.enum(CATEGORIES).nullable(),
  status: goalStatus,
  progressPercentage: z.number().min(0).max(100),
  projectedCompletion: z.string().date().nullable(),
  atRisk: z.boolean(),
  createdAt: z.string().datetime(),
});
export type GoalSummary = z.infer<typeof goalSummary>;

export const goalProgressInput = z.object({
  amount: z.number().positive(),
  note: z.string().max(200).optional(),
});
export type GoalProgressInput = z.infer<typeof goalProgressInput>;
