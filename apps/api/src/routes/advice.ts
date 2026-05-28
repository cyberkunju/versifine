/**
 * Advice route.
 *
 *   GET /advice   — returns 3 to 5 ranked advice items.
 *
 * The actual ranking and source (LLM vs rules) lives in the service. The
 * route just walks the user envelope and packages the response. We expose
 * `source` so the UI can show a "powered by AI" badge when it's a real
 * model call rather than the deterministic fallback.
 */
import { Hono } from 'hono';
import { requireUser } from '../middleware/auth.ts';
import { generateAdvice } from '../services/ai/advice.ts';
import { ok } from '../utils/envelope.ts';

const app = new Hono();
app.use('*', requireUser);

app.get('/', async (c) => {
  const u = c.get('user');
  const envelope = await generateAdvice(u.activeSpaceId);
  return c.json(ok(envelope));
});

export const adviceRoutes = app;
