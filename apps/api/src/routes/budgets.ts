/**
 * Budget routes.
 *
 *   GET    /budgets                    list
 *   POST   /budgets                    create
 *   GET    /budgets/:id                fetch
 *   PATCH  /budgets/:id                update (name/allocations/thresholds)
 *   DELETE /budgets/:id                delete
 *   GET    /budgets/:id/progress       per-category progress
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { budgetCreateInput, budgetUpdateInput } from '@versifine/shared';
import type { Budget } from '../db/schema/budgets.ts';
import { requireUser } from '../middleware/auth.ts';
import {
  computeBudgetProgress,
  createBudget,
  deleteBudget,
  getBudget,
  listBudgets,
  recomputeAffectedBudgets,
  updateBudget,
} from '../services/budgets/index.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';

const app = new Hono();
app.use('*', requireUser);

function serializeBudget(b: Budget) {
  return {
    id: b.id,
    name: b.name,
    recurrence: b.recurrence,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    allocations: b.allocations,
    warnThreshold: b.warnThreshold,
    exceedThreshold: b.exceedThreshold,
    createdAt: b.createdAt.toISOString(),
  };
}

app.get('/', async (c) => {
  const u = c.get('user');
  const rows = await listBudgets(u.activeSpaceId);
  return c.json(ok({ budgets: rows.map(serializeBudget) }));
});

app.post('/', zValidator('json', budgetCreateInput), async (c) => {
  const u = c.get('user');
  const body = c.req.valid('json');
  const row = await createBudget(u.activeSpaceId, body);
  // Recompute on creation in case spend already exists in this period.
  await recomputeAffectedBudgets(u.id, u.activeSpaceId, null);
  return c.json(ok({ budget: serializeBudget(row) }), 201);
});

app.get('/:id', async (c) => {
  const u = c.get('user');
  const row = await getBudget(u.activeSpaceId, c.req.param('id'));
  if (!row) throw errors.notFound('Budget not found');
  return c.json(ok({ budget: serializeBudget(row) }));
});

app.patch('/:id', zValidator('json', budgetUpdateInput), async (c) => {
  const u = c.get('user');
  const body = c.req.valid('json');
  const row = await updateBudget(u.activeSpaceId, c.req.param('id'), body);
  await recomputeAffectedBudgets(u.id, u.activeSpaceId, null);
  return c.json(ok({ budget: serializeBudget(row) }));
});

app.delete('/:id', async (c) => {
  const u = c.get('user');
  await deleteBudget(u.activeSpaceId, c.req.param('id'));
  return c.json(ok({ deleted: true }));
});

app.get('/:id/progress', async (c) => {
  const u = c.get('user');
  const budget = await getBudget(u.activeSpaceId, c.req.param('id'));
  if (!budget) throw errors.notFound('Budget not found');
  const progress = await computeBudgetProgress(u.activeSpaceId, budget);
  return c.json(ok({ progress }));
});

export const budgetRoutes = app;
