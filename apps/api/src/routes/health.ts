/**
 * Liveness + readiness endpoints.
 *
 * `/health` is liveness — the process is alive and the HTTP listener works.
 * `/health/ready` adds a database round-trip so a load balancer can know
 * whether to route traffic during a cold start.
 */
import { Hono } from 'hono';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { ok } from '../utils/envelope.ts';

const app = new Hono();

app.get('/', (c) =>
  c.json(
    ok({
      service: 'versifine-api',
      uptime: process.uptime(),
      ts: new Date().toISOString(),
    }),
  ),
);

app.get('/ready', async (c) => {
  await db.execute(drizzleSql`select 1`);
  return c.json(ok({ ready: true }));
});

export const healthRoutes = app;
