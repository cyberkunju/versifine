/**
 * Forecast route.
 *
 *   GET /forecast?days=30   — recurring-decomposed ARIMA projection
 *
 * `days` is restricted to the discrete set 7|14|30|60|90 because the cache
 * key is per-space-per-horizon and arbitrary inputs would explode the
 * cache without buying any user value. Defaults to 30 — the dashboard's
 * canonical view.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../middleware/auth.ts';
import { computeForecast } from '../services/forecast/index.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';

const app = new Hono();
app.use('*', requireUser);

const querySchema = z.object({
  days: z
    .preprocess(
      (v) => (typeof v === 'string' ? Number(v) : v),
      z.number().int(),
    )
    .refine((v) => [7, 14, 30, 60, 90].includes(v), {
      message: 'days must be one of 7, 14, 30, 60, 90',
    })
    .default(30),
});

app.get('/', async (c) => {
  const u = c.get('user');
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    throw errors.validation('Invalid query', { issues: parsed.error.issues });
  }
  const result = await computeForecast(u.activeSpaceId, parsed.data.days);
  return c.json(ok({ forecast: result }));
});

export const forecastRoutes = app;
