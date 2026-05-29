/**
 * Goals — savings targets with optional category links and projected completion.
 *
 * A goal is a target amount the user is steering toward. Progress is tracked
 * on the row itself (`currentAmount`) since contributions can come from
 * three places — explicit calls to `recordProgress`, manual edits via
 * PATCH, and (eventually) ambient income/expense flowing through a linked
 * category. The auto-link path stays read-only here: the projection math
 * looks at recent transactions in the linked category to estimate "at this
 * pace, when do I hit the target?", but it doesn't mutate `currentAmount`.
 *
 * Achievement is sticky — once `currentAmount >= targetAmount` we flip
 * `status` to `achieved`. The user can still archive after that. We never
 * reset 'achieved' back to 'active' automatically, even if the target is
 * raised, because the historical milestone matters.
 */
import { and, eq, gte, sql as drizzleSql } from 'drizzle-orm';
import {
  type Category,
  type GoalCreateInput,
  type GoalStatus,
  type GoalSummary,
  type GoalUpdateInput,
  isCategory,
} from '@versifine/shared';
import { db } from '../../db/client.ts';
import { goals, type Goal } from '../../db/schema/goals.ts';
import { transactions } from '../../db/schema/transactions.ts';
import { errors } from '../../utils/errors.ts';
import { emit } from '../events/bus.ts';

const PROJECTION_WINDOW_DAYS = 30;

export async function listGoals(
  spaceId: string,
  opts?: { status?: GoalStatus },
): Promise<Goal[]> {
  const filters = [eq(goals.spaceId, spaceId)];
  if (opts?.status) filters.push(eq(goals.status, opts.status));
  return await db.select().from(goals).where(and(...filters));
}

export async function getGoal(spaceId: string, goalId: string): Promise<Goal | null> {
  const [row] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.spaceId, spaceId)))
    .limit(1);
  return row ?? null;
}

export async function createGoal(spaceId: string, input: GoalCreateInput): Promise<Goal> {
  const startCurrent = input.currentAmount ?? 0;
  const status: GoalStatus = startCurrent >= input.targetAmount ? 'achieved' : 'active';
  const [row] = await db
    .insert(goals)
    .values({
      spaceId,
      name: input.name,
      targetAmount: input.targetAmount.toFixed(2),
      currentAmount: startCurrent.toFixed(2),
      deadline: input.deadline ?? null,
      linkedCategory: input.linkedCategory ?? null,
      status,
    })
    .returning();
  if (!row) throw errors.internal('Goal create failed');
  return row;
}

export async function updateGoal(
  spaceId: string,
  goalId: string,
  patch: GoalUpdateInput,
): Promise<Goal> {
  const existing = await getGoal(spaceId, goalId);
  if (!existing) throw errors.notFound('Goal not found');

  const updates: Partial<typeof goals.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.targetAmount !== undefined) updates.targetAmount = patch.targetAmount.toFixed(2);
  if (patch.currentAmount !== undefined) updates.currentAmount = patch.currentAmount.toFixed(2);
  if (patch.deadline !== undefined) updates.deadline = patch.deadline;
  if (patch.linkedCategory !== undefined) updates.linkedCategory = patch.linkedCategory;
  if (patch.status !== undefined) updates.status = patch.status;

  // Auto-flip to 'achieved' when an edit pushes current past target — unless
  // the caller explicitly archived. The reverse is intentionally not done.
  const nextCurrent =
    patch.currentAmount !== undefined ? patch.currentAmount : Number(existing.currentAmount);
  const nextTarget =
    patch.targetAmount !== undefined ? patch.targetAmount : Number(existing.targetAmount);
  const explicitStatus = patch.status;
  if (!explicitStatus && nextCurrent >= nextTarget && existing.status === 'active') {
    updates.status = 'achieved';
  }

  const [row] = await db
    .update(goals)
    .set(updates)
    .where(and(eq(goals.id, goalId), eq(goals.spaceId, spaceId)))
    .returning();
  if (!row) throw errors.internal('Goal update failed');
  return row;
}

export async function deleteGoal(spaceId: string, goalId: string): Promise<void> {
  const result = await db
    .delete(goals)
    .where(and(eq(goals.id, goalId), eq(goals.spaceId, spaceId)))
    .returning({ id: goals.id });
  if (result.length === 0) throw errors.notFound('Goal not found');
}

/**
 * Add to current_amount and emit `goal.updated`. Auto-archives via
 * `status='achieved'` when the new current crosses the target. The note
 * is accepted but not persisted in this iteration — there's no
 * `goal_contributions` history table yet; once we add one, this is where
 * we'd write the row.
 */
export async function recordProgress(
  userId: string,
  spaceId: string,
  goalId: string,
  amount: number,
  _note?: string,
): Promise<Goal> {
  const existing = await getGoal(spaceId, goalId);
  if (!existing) throw errors.notFound('Goal not found');
  if (existing.status === 'archived') {
    throw errors.validation('Goal is archived; reopen it before recording progress');
  }

  const currentBefore = Number(existing.currentAmount);
  const target = Number(existing.targetAmount);
  const nextCurrent = round2(currentBefore + amount);

  const nextStatus: GoalStatus =
    nextCurrent >= target && existing.status !== 'archived' ? 'achieved' : 'active';

  const [row] = await db
    .update(goals)
    .set({
      currentAmount: nextCurrent.toFixed(2),
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(goals.id, goalId), eq(goals.spaceId, spaceId)))
    .returning();
  if (!row) throw errors.internal('Goal progress failed');

  const summary = await serializeGoal(row);
  emit(userId, {
    type: 'goal.updated',
    entityId: row.id,
    data: {
      goalId: row.id,
      currentAmount: summary.currentAmount,
      progressPercentage: summary.progressPercentage,
      atRisk: summary.atRisk,
    },
  });
  return row;
}

/**
 * Convert a stored row to the Zod-validated `GoalSummary`, including the
 * derived projection fields. This is async because the projection touches
 * `transactions` for the linked category — a cheap aggregate but still a
 * round trip per goal. Callers that list many goals should be fine at the
 * dataset size we target; if it ever bites we can batch by category.
 */
export async function serializeGoal(row: Goal): Promise<GoalSummary> {
  const target = Number(row.targetAmount);
  const current = Number(row.currentAmount);
  const progressPercentage =
    target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 0;

  const projectedCompletion = await computeProjectedCompletion(row);
  const deadline = row.deadline ?? null;
  const atRisk =
    projectedCompletion !== null && deadline !== null && projectedCompletion > deadline;

  const status = (row.status as GoalStatus | undefined) ?? 'active';
  const linked =
    row.linkedCategory && isCategory(row.linkedCategory) ? (row.linkedCategory as Category) : null;

  return {
    id: row.id,
    name: row.name,
    targetAmount: round2(target),
    currentAmount: round2(current),
    deadline,
    linkedCategory: linked,
    status,
    progressPercentage: round2(progressPercentage),
    projectedCompletion,
    atRisk,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Estimate the date at which `currentAmount` will reach `targetAmount`
 * given the recent contribution rate.
 *
 * For category-linked goals we sum `base_amount` over the last 30 days of
 * transactions in that category — that's the "channel" the user implicitly
 * declared progresses the goal. For category-corrected rows the current
 * `category` column is what we read, so corrections are honoured automatically.
 *
 * For unlinked goals we fall back to a flat assumption: `currentAmount`
 * accumulated linearly since `createdAt`. If the goal is brand new with
 * no progress, the rate is zero and we return null — better honest than
 * overconfident.
 */
async function computeProjectedCompletion(row: Goal): Promise<string | null> {
  const target = Number(row.targetAmount);
  const current = Number(row.currentAmount);
  const remaining = target - current;
  if (remaining <= 0) return null;

  let avgDaily = 0;

  if (row.linkedCategory && isCategory(row.linkedCategory)) {
    avgDaily = await computeCategoryDailyContribution(row.spaceId, row.linkedCategory);
  } else {
    const ageDays = Math.max(1, daysBetween(row.createdAt, new Date()));
    avgDaily = current / ageDays;
  }

  if (!Number.isFinite(avgDaily) || avgDaily <= 0) return null;

  const daysToCompletion = Math.ceil(remaining / avgDaily);
  // Cap projection at ~30 years out so absurdly slow rates don't yield
  // year-2147 dates that overflow downstream date pickers.
  const cappedDays = Math.min(daysToCompletion, 30 * 365);
  const projection = new Date(Date.now() + cappedDays * 86_400_000);
  return projection.toISOString().slice(0, 10);
}

async function computeCategoryDailyContribution(
  spaceId: string,
  category: Category,
): Promise<number> {
  const since = new Date(Date.now() - PROJECTION_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [row] = await db
    .select({
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.spaceId, spaceId),
        eq(transactions.category, category),
        gte(transactions.date, since),
      ),
    );
  if (!row) return 0;
  return Number(row.total) / PROJECTION_WINDOW_DAYS;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export type { Goal } from '../../db/schema/goals.ts';
