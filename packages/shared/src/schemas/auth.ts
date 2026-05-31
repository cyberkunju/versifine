import { z } from 'zod';
import { LANGUAGES } from '../languages.ts';

/**
 * Auth contract shared between the API, the web client, and the bot.
 *
 * The password policy is enforced both client-side (so the user gets fast
 * feedback) and on the server (the only enforcement that actually matters).
 * Anything user-provided crosses through these schemas before touching the
 * database.
 */

export const passwordPolicy = z
  .string()
  .min(12, 'at least 12 characters')
  .regex(/[A-Z]/, 'one uppercase letter')
  .regex(/[a-z]/, 'one lowercase letter')
  .regex(/[0-9]/, 'one digit')
  .regex(/[^A-Za-z0-9]/, 'one special character');

export const registerInput = z.object({
  email: z.string().email().max(254),
  password: passwordPolicy,
  displayName: z.string().min(1).max(80).optional(),
  primaryLanguage: z.enum(LANGUAGES).default('en'),
});
export type RegisterInput = z.infer<typeof registerInput>;

export const loginInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

export const googleAuthInput = z.object({
  /**
   * Google Identity Services ID token. The API verifies signature, issuer,
   * audience, expiry, subject, and verified email before minting Versifine
   * tokens.
   */
  credential: z.string().min(20).max(4096),
  /** Used only when a brand-new account is created from the Google flow. */
  primaryLanguage: z.enum(LANGUAGES).default('en'),
});
export type GoogleAuthInput = z.infer<typeof googleAuthInput>;

export const refreshInput = z.object({
  refreshToken: z.string().min(20),
});
export type RefreshInput = z.infer<typeof refreshInput>;

export const phoneLinkStartInput = z.object({}).strict();
export type PhoneLinkStartInput = z.infer<typeof phoneLinkStartInput>;

export const phoneLinkConfirmInput = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/, 'six digits required'),
  /** E.164-style phone digits only (no +, no spaces). The API normalises again server-side. */
  phone: z.string().regex(/^\d{10,15}$/),
});
export type PhoneLinkConfirmInput = z.infer<typeof phoneLinkConfirmInput>;

/**
 * Bot → API: find-or-create an account for a WhatsApp number.
 * Auth is the bot secret (X-Bot-Secret); the phone travels in the body so
 * this one call can provision a number that isn't linked yet (unlike the
 * X-Phone middleware path which requires an existing user).
 */
export const botEnsureUserInput = z.object({
  phone: z.string().regex(/^\d{10,15}$/),
  language: z.enum(LANGUAGES).default('en'),
});
export type BotEnsureUserInput = z.infer<typeof botEnsureUserInput>;

export const botEnsureUserResult = z.object({
  userId: z.string().uuid(),
  spaceId: z.string().uuid(),
  isNew: z.boolean(),
  displayName: z.string().nullable(),
  language: z.enum(LANGUAGES),
});
export type BotEnsureUserResult = z.infer<typeof botEnsureUserResult>;

/** Bot → API: read-only "is this number known?" check on first contact. */
export const botWhoamiResult = z.object({
  exists: z.boolean(),
  displayName: z.string().nullable(),
  language: z.enum(LANGUAGES),
  /** Account originated from web/Google (has password or Google identity). */
  webLinked: z.boolean(),
});
export type BotWhoamiResult = z.infer<typeof botWhoamiResult>;

export const tokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof tokenPair>;

export const userSummary = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  primaryLanguage: z.enum(LANGUAGES),
  baseCurrency: z.string().length(3),
  activeSpaceId: z.string().uuid(),
  whatsappPhone: z.string().nullable(),
  whatsappPhoneVerifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type UserSummary = z.infer<typeof userSummary>;
