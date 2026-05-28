/**
 * Two auth modes:
 *   - requireUser: web client sends Authorization: Bearer <jwt>. We verify
 *     and load the user; the active space is derived from the token claim
 *     and re-confirmed against the database.
 *   - requireBot: the wa-bot signs every internal call with X-Bot-Secret +
 *     X-Phone (digits). We trust the secret to authenticate the bot itself
 *     and resolve the user by phone. The bot never holds a JWT.
 */
import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { db } from '../db/client.ts';
import { spaceMembers } from '../db/schema/spaces.ts';
import { users } from '../db/schema/users.ts';
import { env } from '../env.ts';
import { verifyAccessToken } from '../services/auth/jwt.ts';
import { errors } from '../utils/errors.ts';
import { normalizePhone } from '../utils/phone.ts';

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string | null;
  primaryLanguage: string;
  baseCurrency: string;
  activeSpaceId: string;
  whatsappPhone: string | null;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthedUser;
  }
}

function extractBearer(c: Context): string | null {
  const header = c.req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

async function loadAuthedUser(userId: string, claimedSpaceId: string): Promise<AuthedUser> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      primaryLanguage: users.primaryLanguage,
      baseCurrency: users.baseCurrency,
      activeSpaceId: users.activeSpaceId,
      whatsappPhone: users.whatsappPhone,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || !row.activeSpaceId) throw errors.unauthorized('Account not found');

  // Confirm the JWT-claimed space is still a space the user belongs to.
  const [member] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(eq(spaceMembers.userId, userId))
    .limit(1);
  if (!member) throw errors.forbidden('No active space');

  const activeSpaceId = row.activeSpaceId === claimedSpaceId ? claimedSpaceId : row.activeSpaceId;

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    primaryLanguage: row.primaryLanguage,
    baseCurrency: row.baseCurrency,
    activeSpaceId,
    whatsappPhone: row.whatsappPhone,
  };
}

export const requireUser: MiddlewareHandler = async (c, next) => {
  const token = extractBearer(c);
  if (!token) throw errors.unauthorized('Missing bearer token');
  const claims = await verifyAccessToken(token);
  const user = await loadAuthedUser(claims.sub, claims.asid);
  c.set('user', user);
  await next();
};

export const requireBot: MiddlewareHandler = async (c, next) => {
  const provided = c.req.header('x-bot-secret');
  if (!provided || provided !== env.BOT_SECRET) {
    throw errors.unauthorized('Bot secret missing or invalid');
  }
  const phoneHeader = c.req.header('x-phone');
  if (!phoneHeader) throw errors.unauthorized('Missing X-Phone header');
  const phone = normalizePhone(phoneHeader);
  if (!phone) throw errors.unauthorized('Invalid phone');

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      primaryLanguage: users.primaryLanguage,
      baseCurrency: users.baseCurrency,
      activeSpaceId: users.activeSpaceId,
      whatsappPhone: users.whatsappPhone,
    })
    .from(users)
    .where(eq(users.whatsappPhone, phone))
    .limit(1);

  if (!row || !row.activeSpaceId) throw errors.notFound('No user linked to this phone');

  c.set('user', {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    primaryLanguage: row.primaryLanguage,
    baseCurrency: row.baseCurrency,
    activeSpaceId: row.activeSpaceId,
    whatsappPhone: row.whatsappPhone,
  });
  await next();
};
