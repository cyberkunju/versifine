/**
 * Recurring routes.
 *
 *   GET    /recurring             list (optional ?status=active|dismissed)
 *   POST   /recurring/run         trigger detection over the last 90 days
 *   PATCH  /recurring/:id         change status (active ↔ dismissed)
 *
 * Detection is server-driven and idempotent — running it twice in quick
 * succession just refreshes the same rows. The response is the up-to-date
 * list so the UI can re-render without a follow-up GET.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { RecurringItem } from '../db/schema/recurring.ts';
import { requireUser } from '../middleware/auth.ts';
import { invalidateForecast } from '../services/forecast/index.ts';
import { listRecurring, runDetector, setRecurringStatus } from '../services/forecast/recurring.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';

const app = new Hono();
app.use('*', requireUser);

function serializeRecurring(r: RecurringItem) {
  return {
    id: r.id,
    merchantNormalized: r.merchantNormalized,
    displayName: r.displayName,
    averageAmount: Number(r.averageAmount),
    currency: r.currency,
    frequencyDays: r.frequencyDays,
    nextExpectedDate: r.nextExpectedDate,
    occurrences: r.occurrences,
    confidence: Number(r.confidence),
    status: r.status,
    detectedAt: r.detectedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const statusQuerySchema = z.object({
  status: z.enum(['active', 'dismissed']).optional(),
});

app.get('/', async (c) => {
  const u = c.get('user');
  const parsed = statusQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    throw errors.validation('Invalid query', { issues: parsed.error.issues });
  }
  const opts: { status?: 'active' | 'dismissed' } = {};
  if (parsed.data.status) opts.status = parsed.data.status;
  const rows = await listRecurring(u.activeSpaceId, opts);
  return c.json(ok({ items: rows.map(serializeRecurring) }));
});

app.post('/run', async (c) => {
  const u = c.get('user');
  const result = await runDetector(u.id, u.activeSpaceId);
  // Detection often shifts amounts and dates; the cached forecast no longer
  // reflects the new picture. Drop it so the next /forecast call recomputes.
  invalidateForecast(u.activeSpaceId);
  const rows = await listRecurring(u.activeSpaceId, { status: 'active' });
  return c.json(
    ok({
      summary: result,
      items: rows.map(serializeRecurring),
    }),
  );
});

const patchInput = z.object({
  status: z.enum(['active', 'dismissed']),
});

app.patch('/:id', zValidator('json', patchInput), async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const row = await setRecurringStatus(u.activeSpaceId, id, body.status);
  invalidateForecast(u.activeSpaceId);
  return c.json(ok({ item: serializeRecurring(row) }));
});

export const recurringRoutes = app;
