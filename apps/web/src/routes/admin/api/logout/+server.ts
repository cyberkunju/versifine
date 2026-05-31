/** POST /admin/api/logout → clears the admin session cookie. */
import { json } from '@sveltejs/kit';
import { clearSessionCookie } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
  clearSessionCookie(cookies);
  return json({ ok: true });
};
