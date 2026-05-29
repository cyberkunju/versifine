/**
 * Goal routes.
 *
 *   GET    /goals            list (optional ?status=active|achieved|archived)
 *   POST   /goals            create
 *   GET    /goals/:id        fetch
 *   PATCH  /goals/:id        update
 *   DELETE /goals/:id        hard delete (history of contributions isn't kept yet)
 *   POST   /goals/:id/progress   add to current_amount + emit goal.updated
 *
 * Every state change emits `goal.updated` so the web client and bot can
 * reconcile in real time.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  goalCreateInput,
  goalProgressInput,
  goalStatus,
  goalUpdateInput,
} from '@versifine/shared';
import { requireUser } from '../middleware/auth.ts';
import { emit } from '../services/events/bus.ts';
import {
  createGoal,
  deleteGoal,
  getGoal,
  listGoals,
  recordProgress,
  serializeGoal,
  updateGoal,
} from '../services/goals/index.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';
import type { Goal } from '../db/schema/goals.ts';

const app = new Hono();
app.use('*', requireUser);

async function emitGoalUpdated(userId: string, row: Goal) {
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
  return summary;
}

app.get('/', async (c) => {
  const u = c.get('user');
  const statusParam = c.req.query('status');
  const parsed = statusParam ? goalStatus.safeParse(statusParam) : null;
  if (parsed && !parsed.success) {
    throw errors.validation('Invalid status filter', { status: statusParam });
  }
  const rows = await listGoals(u.activeSpaceId, parsed?.success ? { status: parsed.data } : {});
  const summaries = await Promise.all(rows.map((r) => serializeGoal(r)));
  return c.json(ok({ goals: summaries }));
});

app.post('/', zValidator('json', goalCreateInput), async (c) => {
  const u = c.get('user');
  const body = c.req.valid('json');
  const row = await createGoal(u.activeSpaceId, body);
  const summary = await emitGoalUpdated(u.id, row);
  return c.json(ok({ goal: summary }), 201);
});

app.get('/:id', async (c) => {
  const u = c.get('user');
  const row = await getGoal(u.activeSpaceId, c.req.param('id'));
  if (!row) throw errors.notFound('Goal not found');
  return c.json(ok({ goal: await serializeGoal(row) }));
});

app.patch('/:id', zValidator('json', goalUpdateInput), async (c) => {
  const u = c.get('user');
  const body = c.req.valid('json');
  const row = await updateGoal(u.activeSpaceId, c.req.param('id'), body);
  const summary = await emitGoalUpdated(u.id, row);
  return c.json(ok({ goal: summary }));
});

app.delete('/:id', async (c) => {
  const u = c.get('user');
  await deleteGoal(u.activeSpaceId, c.req.param('id'));
  return c.json(ok({ deleted: true }));
});

app.post('/:id/progress', zValidator('json', goalProgressInput), async (c) => {
  const u = c.get('user');
  const body = c.req.valid('json');
  const row = await recordProgress(
    u.id,
    u.activeSpaceId,
    c.req.param('id'),
    body.amount,
    body.note,
  );
  return c.json(ok({ goal: await serializeGoal(row) }));
});

export const goalRoutes = app;
