/**
 * Admin allowlist proxy (cookie-gated).
 *   GET    → { seed, dynamic, demoMode }
 *   POST   { phone } → add
 *   DELETE { phone } → remove
 */
import { json, error as svelteError } from '@sveltejs/kit';
import { callBot, relayJson, requireSession } from '$lib/server/admin';
import type { RequestHandler } from './$types';

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

export const GET: RequestHandler = async ({ cookies }) => {
  requireSession(cookies);
  const { status, data } = await relayJson(await callBot('/allowlist', 'GET'));
  return json(data, { status });
};

export const POST: RequestHandler = async ({ cookies, request }) => {
  requireSession(cookies);
  const phone = await readPhone(request);
  const { status, data } = await relayJson(await callBot('/allowlist', 'POST', { phone }));
  return json(data, { status });
};

export const DELETE: RequestHandler = async ({ cookies, request }) => {
  requireSession(cookies);
  const phone = await readPhone(request);
  const { status, data } = await relayJson(await callBot('/allowlist', 'DELETE', { phone }));
  return json(data, { status });
};
