/** POST /admin/api/login { username, password } → sets the admin session cookie. */
import { json, error as svelteError } from '@sveltejs/kit';
import { checkCredentials, setSessionCookie } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { username?: unknown; password?: unknown };
  } catch {
    throw svelteError(400, 'Invalid JSON body');
  }
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!checkCredentials(username, password)) {
    throw svelteError(401, 'Invalid username or password');
  }
  setSessionCookie(cookies);
  return json({ ok: true });
};
