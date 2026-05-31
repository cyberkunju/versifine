/** GET /admin/api/session → { authed } based on the cookie. */
import { json } from '@sveltejs/kit';
import { ADMIN_COOKIE, verifySession } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
  return json({ authed: verifySession(cookies.get(ADMIN_COOKIE)) });
};
