/**
 * Either-or auth: accept a web JWT *or* the bot's shared secret.
 *
 * Capture endpoints are reachable from both surfaces — the web omnibar
 * sends a Bearer token, the WhatsApp bot signs server-to-server calls
 * with `X-Bot-Secret` + `X-Phone`. This wrapper picks the right path at
 * request time so each route doesn't have to fork into two copies.
 */
import type { MiddlewareHandler } from 'hono';
import { requireBot, requireUser } from './auth.ts';

export const requireUserOrBot: MiddlewareHandler = async (c, next) => {
  const hasBotSecret = Boolean(c.req.header('x-bot-secret'));
  const hasBearer = (c.req.header('authorization') ?? '').toLowerCase().startsWith('bearer ');

  if (hasBotSecret) {
    return requireBot(c, next);
  }
  if (hasBearer) {
    return requireUser(c, next);
  }
  // Neither header present — let requireUser raise the canonical 401.
  return requireUser(c, next);
};
