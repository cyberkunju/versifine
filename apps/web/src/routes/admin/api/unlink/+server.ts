/** POST /admin/api/unlink → unlink the paired WhatsApp device (cookie-gated). */
import { json } from '@sveltejs/kit';
import { callBot, relayJson, requireSession } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
  requireSession(cookies);
  const { status, data } = await relayJson(await callBot('/unlink', 'POST'));
  return json(data, { status });
};
