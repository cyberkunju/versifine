/**
 * Bot ↔ API routes that operate on a phone number BEFORE a user exists.
 *
 * The regular `requireBot` middleware resolves an existing user from the
 * `X-Phone` header and 404s when the number is unknown — perfect for the
 * capture/query endpoints, useless for onboarding. These routes instead
 * authenticate the bot itself (shared secret) and take the phone in the
 * body, so the very first message from a brand-new number can provision
 * an account.
 *
 *   POST /bot/whoami        read-only: is this number already an account?
 *   POST /bot/ensure-user   find-or-create the account (phone-first signup)
 *
 * Both require a valid `X-Bot-Secret`. Only the bot can reach them; they are
 * never exposed to the public web origin (nginx proxies only /qr* on the bot
 * and these live on the API behind the bot secret).
 */
import { Hono } from 'hono';
import { botEnsureUserInput, isLanguage } from '@versifine/shared';
import { z } from 'zod';
import { env } from '../env.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { validate } from '../middleware/validate.ts';
import {
  ensureUserByPhone,
  findAccountByPhone,
  isSyntheticEmail,
} from '../services/auth/provision.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';
import { normalizePhone } from '../utils/phone.ts';

const app = new Hono();

/** Gate every /bot route on the shared secret. */
app.use('*', async (c, next) => {
  const provided = c.req.header('x-bot-secret');
  if (!provided || provided !== env.BOT_SECRET) {
    throw errors.unauthorized('Bot secret missing or invalid');
  }
  await next();
});

// Provisioning is cheap but writes rows; cap it per-phone so a flood of
// distinct numbers can't be used to mass-create accounts.
const provisionLimit = rateLimit({
  capacity: 30,
  refillTokens: 30,
  refillIntervalMs: 60_000,
  key: (c) => `bot-provision:${normalizePhone(c.req.header('x-phone') ?? 'anon')}`,
});

const whoamiInput = z.object({ phone: z.string().regex(/^\d{10,15}$/) });

app.post('/whoami', validate('json', whoamiInput), async (c) => {
  const { phone } = c.req.valid('json');
  const account = await findAccountByPhone(phone);
  const language = isLanguage(account.language) ? account.language : 'en';
  return c.json(
    ok({
      exists: account.exists,
      displayName: account.displayName,
      language,
      webLinked: account.webLinked,
    }),
  );
});

app.post('/ensure-user', provisionLimit, validate('json', botEnsureUserInput), async (c) => {
  const { phone, language, email } = c.req.valid('json');
  const account = await ensureUserByPhone(phone, language, email);
  const resolved = isLanguage(account.language) ? account.language : 'en';
  c.get('log').info('BOT_ENSURE_USER', {
    userId: account.userId,
    isNew: account.isNew,
    linkedExisting: account.linkedExisting,
    withEmail: Boolean(email),
  });
  return c.json(
    ok({
      userId: account.userId,
      spaceId: account.spaceId,
      isNew: account.isNew,
      displayName: account.displayName,
      language: resolved,
      email: isSyntheticEmail(account.email) ? null : account.email,
      linkedExisting: account.linkedExisting,
    }),
    account.isNew ? 201 : 200,
  );
});

export const botRoutes = app;
