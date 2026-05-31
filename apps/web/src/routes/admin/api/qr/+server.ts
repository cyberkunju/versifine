/** GET /admin/api/qr → bot pairing status + QR (cookie-gated, no-store). */
import { json } from '@sveltejs/kit';
import { callBot, relayJson, requireSession } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
  requireSession(cookies);
  const { status, data } = await relayJson(await callBot('/qr.json', 'GET'));
  return json(data, { status, headers: { 'cache-control': 'no-store' } });
};
