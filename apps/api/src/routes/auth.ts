/**
 * Auth routes.
 *
 *   POST /auth/register             create account + personal space + default wallet
 *   POST /auth/login                exchange credentials for token pair
 *   POST /auth/refresh              rotate refresh token, mint new access
 *   POST /auth/logout               revoke the presented refresh token
 *   GET  /auth/me                   current user
 *   POST /auth/phone-link/start     mint OTP; user types `LINK <code>` in WhatsApp
 *   POST /auth/phone-link/confirm   alternative client-driven confirmation path
 */
import { zValidator } from '@hono/zod-validator';
import { and, eq, gt, isNull, sql as drizzleSql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  loginInput,
  phoneLinkConfirmInput,
  refreshInput,
  registerInput,
} from '@versifine/shared';
import { db } from '../db/client.ts';
import { spaceMembers, spaces } from '../db/schema/spaces.ts';
import { phoneLinkOtps, refreshTokens, users } from '../db/schema/users.ts';
import { wallets } from '../db/schema/wallets.ts';
import { env } from '../env.ts';
import { requireUser } from '../middleware/auth.ts';
import { rateLimit, limits } from '../middleware/rateLimit.ts';
import {
  hashRefreshToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../services/auth/jwt.ts';
import { hashPassword, verifyPassword } from '../services/auth/password.ts';
import { consumeOtp, createOtp } from '../services/auth/otp.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';
import { normalizePhone } from '../utils/phone.ts';

const app = new Hono();

const authLimit = rateLimit({
  ...limits.auth,
  key: (c) => c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'auth-anon',
});

// OTP confirm is an unauthenticated route that checks a 6-digit code, so it
// is the brute-force target. Keep it tight: ~5 attempts/minute per client.
// Keyed by IP (the body's phone is attacker-controlled, so IP is the honest
// throttle dimension; we fall back to a shared bucket if no IP header).
const otpLimit = rateLimit({
  capacity: 5,
  refillTokens: 5,
  refillIntervalMs: 60_000,
  key: (c) =>
    `otp:${c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'anon'}`,
});

app.post('/register', authLimit, zValidator('json', registerInput), async (c) => {
  const { email, password, displayName, primaryLanguage } = c.req.valid('json');

  const passwordHash = await hashPassword(password);

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      throw errors.conflict('Email already registered');
    }

    const [space] = await tx
      .insert(spaces)
      .values({
        name: 'Personal',
        type: 'personal',
        baseCurrency: 'INR',
      })
      .returning({ id: spaces.id });
    if (!space) throw errors.internal('Space creation failed');

    const [user] = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        displayName: displayName ?? null,
        primaryLanguage,
        baseCurrency: 'INR',
        activeSpaceId: space.id,
      })
      .returning({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        primaryLanguage: users.primaryLanguage,
        baseCurrency: users.baseCurrency,
        activeSpaceId: users.activeSpaceId,
        whatsappPhone: users.whatsappPhone,
        whatsappPhoneVerifiedAt: users.whatsappPhoneVerifiedAt,
        createdAt: users.createdAt,
      });
    if (!user) throw errors.internal('User creation failed');

    await tx.update(spaces).set({ createdBy: user.id }).where(eq(spaces.id, space.id));

    await tx.insert(spaceMembers).values({
      spaceId: space.id,
      userId: user.id,
      role: 'owner',
    });

    await tx.insert(wallets).values({
      spaceId: space.id,
      name: 'Cash',
      type: 'cash',
      currency: 'INR',
    });

    return { user, spaceId: space.id };
  });

  const accessToken = await signAccessToken({ sub: result.user.id, asid: result.spaceId });
  const { token: refreshToken, nonce } = await signRefreshToken({ sub: result.user.id });
  await db.insert(refreshTokens).values({
    userId: result.user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000),
  });
  void nonce;

  c.get('log').info('AUTH_REGISTER_OK', { userId: result.user.id });

  return c.json(
    ok({
      user: serializeUser(result.user, result.spaceId),
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      },
    }),
    201,
  );
});

app.post('/login', authLimit, zValidator('json', loginInput), async (c) => {
  const { email, password } = c.req.valid('json');

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      primaryLanguage: users.primaryLanguage,
      baseCurrency: users.baseCurrency,
      activeSpaceId: users.activeSpaceId,
      whatsappPhone: users.whatsappPhone,
      whatsappPhoneVerifiedAt: users.whatsappPhoneVerifiedAt,
      createdAt: users.createdAt,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const okPassword = await verifyPassword(password, row?.passwordHash);
  if (!row || !okPassword || !row.activeSpaceId) {
    c.get('log').warn('AUTH_LOGIN_FAIL', { email });
    throw errors.unauthorized('Invalid credentials');
  }

  const accessToken = await signAccessToken({ sub: row.id, asid: row.activeSpaceId });
  const { token: refreshToken } = await signRefreshToken({ sub: row.id });
  await db.insert(refreshTokens).values({
    userId: row.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000),
  });

  c.get('log').info('AUTH_LOGIN_OK', { userId: row.id });

  return c.json(
    ok({
      user: serializeUser(row, row.activeSpaceId),
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      },
    }),
  );
});

app.post('/refresh', zValidator('json', refreshInput), async (c) => {
  const { refreshToken } = c.req.valid('json');
  const claims = await verifyRefreshToken(refreshToken);
  const tokenHash = hashRefreshToken(refreshToken);

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: refreshTokens.id,
        userId: refreshTokens.userId,
        rotatedAt: refreshTokens.rotatedAt,
        revokedAt: refreshTokens.revokedAt,
      })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row || row.userId !== claims.sub) {
      throw errors.unauthorized('Refresh token not recognised');
    }
    if (row.revokedAt || row.rotatedAt) {
      // Reuse of an already-rotated token: defensively revoke all of this user's tokens.
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
      throw errors.unauthorized('Refresh token reused, all sessions revoked');
    }

    await tx.update(refreshTokens).set({ rotatedAt: new Date() }).where(eq(refreshTokens.id, row.id));

    const [user] = await tx
      .select({
        activeSpaceId: users.activeSpaceId,
      })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    if (!user || !user.activeSpaceId) throw errors.unauthorized('User missing');

    const { token: nextRefresh } = await signRefreshToken({ sub: row.userId });
    await tx.insert(refreshTokens).values({
      userId: row.userId,
      tokenHash: hashRefreshToken(nextRefresh),
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000),
    });

    const accessToken = await signAccessToken({
      sub: row.userId,
      asid: user.activeSpaceId,
    });
    return { accessToken, refreshToken: nextRefresh };
  });

  return c.json(
    ok({
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      },
    }),
  );
});

app.post('/logout', requireUser, async (c) => {
  const body = await c.req.json().catch(() => ({}) as { refreshToken?: unknown });
  if (body && typeof body === 'object' && 'refreshToken' in body && typeof (body as { refreshToken: unknown }).refreshToken === 'string') {
    const tokenHash = hashRefreshToken((body as { refreshToken: string }).refreshToken);
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
  }
  return c.json(ok({ loggedOut: true }));
});

app.get('/me', requireUser, async (c) => {
  const u = c.get('user');
  return c.json(
    ok({
      user: {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        primaryLanguage: u.primaryLanguage,
        baseCurrency: u.baseCurrency,
        activeSpaceId: u.activeSpaceId,
        whatsappPhone: u.whatsappPhone,
      },
    }),
  );
});

app.post('/phone-link/start', requireUser, async (c) => {
  const u = c.get('user');
  const otp = await createOtp(u.id);
  return c.json(
    ok({
      // Only expose the code in dev; production should never echo it.
      code: env.NODE_ENV === 'development' ? otp.code : undefined,
      expiresAt: otp.expiresAt.toISOString(),
      instruction: 'Send LINK <code> to the Versifine bot from your WhatsApp.',
    }),
  );
});

app.post('/phone-link/confirm', otpLimit, zValidator('json', phoneLinkConfirmInput), async (c) => {
  const { code, phone } = c.req.valid('json');
  const normalized = normalizePhone(phone);

  const otp = await consumeOtp(code);

  await db.transaction(async (tx) => {
    const [conflict] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.whatsappPhone, normalized))
      .limit(1);
    if (conflict && conflict.id !== otp.userId) {
      throw errors.conflict('Phone already linked to another account');
    }

    await tx
      .update(users)
      .set({ whatsappPhone: normalized, whatsappPhoneVerifiedAt: new Date() })
      .where(eq(users.id, otp.userId));
    // Clean stale OTPs.
    await tx
      .update(phoneLinkOtps)
      .set({ consumedAt: drizzleSql`coalesce(${phoneLinkOtps.consumedAt}, now())` })
      .where(eq(phoneLinkOtps.userId, otp.userId));
  });

  return c.json(ok({ linked: true, phone: normalized }));
});

function serializeUser(
  row: {
    id: string;
    email: string;
    displayName: string | null;
    primaryLanguage: string;
    baseCurrency: string;
    whatsappPhone: string | null;
    whatsappPhoneVerifiedAt: Date | null;
    createdAt: Date;
  },
  activeSpaceId: string,
) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    primaryLanguage: row.primaryLanguage,
    baseCurrency: row.baseCurrency,
    activeSpaceId,
    whatsappPhone: row.whatsappPhone,
    whatsappPhoneVerifiedAt: row.whatsappPhoneVerifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const authRoutes = app;
