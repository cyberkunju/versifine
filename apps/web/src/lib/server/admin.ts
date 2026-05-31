/**
 * Server-only helpers for the /admin operator panel.
 *
 * Auth model: a single operator credential (username + password) checked
 * against server env, exchanged for a signed, httpOnly session cookie. The
 * cookie value is an HMAC of a fixed payload + the server secret, so it can't
 * be forged without the secret and never exposes the password.
 *
 * Everything here is server-side only (imported from +server.ts endpoints).
 * The bot secret and admin password NEVER reach the browser.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { error as svelteError, type Cookies } from '@sveltejs/kit';

export const ADMIN_COOKIE = 'vf_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

const ADMIN_USER = env.ADMIN_USER ?? 'cyberkunju';
const ADMIN_PASS = env.ADMIN_PASS ?? '*Nk*creation*2348';
/** Secret used to sign the session cookie. Falls back to BOT_SECRET. */
const SESSION_SECRET = env.ADMIN_SESSION_SECRET ?? env.BOT_SECRET ?? 'versifine-admin-fallback-secret';

const BOT_URL = (env.WABOT_INTERNAL_URL ?? 'http://127.0.0.1:5101').replace(/\/$/, '');
const BOT_SECRET = env.BOT_SECRET ?? '';

/* ----------------------------- credentials ----------------------------- */

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Verify the operator's username + password. */
export function checkCredentials(username: string, password: string): boolean {
  // Compare both even when the username is wrong to keep timing uniform.
  const userOk = safeEqual(username, ADMIN_USER);
  const passOk = safeEqual(password, ADMIN_PASS);
  return userOk && passOk;
}

/* ----------------------------- session cookie --------------------------- */

function sign(payload: string): string {
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

/** Mint a cookie value: `<issuedAtMs>.<hmac>`. */
export function issueSession(): string {
  const issued = Date.now().toString();
  return `${issued}.${sign(issued)}`;
}

/** Validate a cookie value: correct signature + not expired. */
export function verifySession(value: string | undefined): boolean {
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot === -1) return false;
  const issued = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(issued);
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const issuedMs = Number(issued);
  if (!Number.isFinite(issuedMs)) return false;
  return Date.now() - issuedMs < SESSION_TTL_MS;
}

export function setSessionCookie(cookies: Cookies): void {
  cookies.set(ADMIN_COOKIE, issueSession(), {
    path: '/admin',
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(ADMIN_COOKIE, { path: '/admin' });
}

/** Throw 401 unless the request carries a valid admin session cookie. */
export function requireSession(cookies: Cookies): void {
  if (!verifySession(cookies.get(ADMIN_COOKIE))) {
    throw svelteError(401, 'Not authenticated');
  }
}

/* ----------------------------- bot proxy -------------------------------- */

/** Call the bot's internal HTTP server with the shared secret. */
export async function callBot(
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<Response> {
  if (!BOT_SECRET) throw svelteError(503, 'Bot secret not configured on the server');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    return await fetch(`${BOT_URL}${path}`, {
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

/** Forward the bot's JSON response (status + parsed body) to the client. */
export async function relayJson(res: Response): Promise<{ status: number; data: unknown }> {
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw svelteError(502, 'Bot returned a non-JSON response');
  }
  return { status: res.status, data };
}
