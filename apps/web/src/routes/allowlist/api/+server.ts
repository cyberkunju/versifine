/**
 * Server-side proxy for the WhatsApp demo allowlist admin page.
 *
 * Lives at /allowlist/api (NOT /api/*, which nginx routes to the API server).
 * nginx's catch-all `location /` sends this to the SvelteKit/web process,
 * which can reach the bot's internal HTTP server on localhost.
 *
 * The bot exposes allowlist CRUD gated by the shared BOT_SECRET. That secret
 * must NEVER reach the browser, so this endpoint is the only thing the page
 * talks to:
 *   - it authenticates the operator with an admin token (a header the page
 *     sends, checked against ADMIN_TOKEN / BOT_SECRET here on the server),
 *   - then forwards to the bot with the X-Bot-Secret header.
 *
 * Runtime config (server-only, via $env/dynamic/private):
 *   BOT_SECRET            shared secret the bot expects (required).
 *   WABOT_INTERNAL_URL    where the bot's internal server is reachable from
 *                         the web process. Defaults to http://127.0.0.1:5101
 *                         (production BOT_PORT). For local dev set 5001.
 *   ADMIN_TOKEN           token the operator must present. Falls back to
 *                         BOT_SECRET when unset.
 */
import { json, error as svelteError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const BOT_URL = (env.WABOT_INTERNAL_URL ?? 'http://127.0.0.1:5101').replace(/\/$/, '');
const ADMIN_TOKEN = env.ADMIN_TOKEN ?? env.BOT_SECRET ?? '';
const BOT_SECRET = env.BOT_SECRET ?? '';

/** Length-checked constant-time-ish token compare. */
function tokenOk(provided: string | null): boolean {
  if (!ADMIN_TOKEN || !provided) return false;
  if (provided.length !== ADMIN_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ ADMIN_TOKEN.charCodeAt(i);
  }
  return diff === 0;
}

function requireAdmin(request: Request): void {
  const provided =
    request.headers.get('x-admin-token') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;
  if (!tokenOk(provided)) {
    throw svelteError(401, 'Invalid or missing admin token');
  }
}

async function callBot(method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<Response> {
  if (!BOT_SECRET) {
    throw svelteError(503, 'Bot secret not configured on the server');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    return await fetch(`${BOT_URL}/allowlist`, {
      method,
      headers: {
        'x-bot-secret': BOT_SECRET,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw svelteError(502, 'Could not reach the WhatsApp bot');
  } finally {
    clearTimeout(timer);
  }
}

async function relay(res: Response): Promise<Response> {
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw svelteError(502, 'Bot returned a non-JSON response');
  }
  return json(data, { status: res.status });
}

async function readPhone(request: Request): Promise<string> {
  let payload: { phone?: unknown };
  try {
    payload = (await request.json()) as { phone?: unknown };
  } catch {
    throw svelteError(400, 'Invalid JSON body');
  }
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  if (!phone) throw svelteError(400, 'phone is required');
  return phone;
}

/** GET /allowlist/api → { seed, dynamic, demoMode } */
export const GET: RequestHandler = async ({ request }) => {
  requireAdmin(request);
  return relay(await callBot('GET'));
};

/** POST /allowlist/api { phone } → add to the dynamic allowlist */
export const POST: RequestHandler = async ({ request }) => {
  requireAdmin(request);
  const phone = await readPhone(request);
  return relay(await callBot('POST', { phone }));
};

/** DELETE /allowlist/api { phone } → remove from the dynamic allowlist */
export const DELETE: RequestHandler = async ({ request }) => {
  requireAdmin(request);
  const phone = await readPhone(request);
  return relay(await callBot('DELETE', { phone }));
};
