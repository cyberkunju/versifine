/**
 * Auth routes.
 *
 *   POST /auth/register             create account + personal space + default wallet
 *   POST /auth/login                exchange credentials for token pair
 *   POST /auth/google               verify Google ID token + exchange for token pair
 *   POST /auth/refresh              rotate refresh token, mint new access
 *   POST /auth/logout               revoke the presented refresh token
 *   GET  /auth/me                   current user
 *   POST /auth/phone-link/start     mint OTP; user types `LINK <code>` in WhatsApp
 *   POST /auth/phone-link/confirm   alternative client-driven confirmation path
 */
import { and, eq, gt, isNull, sql as drizzleSql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  googleAuthInput,
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
import { validate } from '../middleware/validate.ts';
import {
  hashRefreshToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../services/auth/jwt.ts';
import { hashPassword, verifyPassword } from '../services/auth/password.ts';
import { createOtp, getValidOtp } from '../services/auth/otp.ts';
import { ok } from '../utils/envelope.ts';
import { errors } from '../utils/errors.ts';
import { normalizePhone } from '../utils/phone.ts';
import { isAuthoritativeGoogleEmail, verifyGoogleCredential } from '../services/auth/google.ts';

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

const authUserColumns = {
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
  googleSub: users.googleSub,
};

app.post('/register', authLimit, validate('json', registerInput), async (c) => {
  const { email, password, displayName, primaryLanguage } = c.req.valid('json');

  const passwordHash = await hashPassword(password);

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        googleSub: users.googleSub,
        displayName: users.displayName,
        activeSpaceId: users.activeSpaceId,
        whatsappPhone: users.whatsappPhone,
        whatsappPhoneVerifiedAt: users.whatsappPhoneVerifiedAt,
        primaryLanguage: users.primaryLanguage,
        baseCurrency: users.baseCurrency,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      // A phone-first WhatsApp account (passwordless, no Google) that already
      // claimed this real email is "claimable": registering on the web with
      // the same address adopts it, so both surfaces share one account. Any
      // account with a password or Google identity is a genuine collision.
      const claimable = !existing.passwordHash && !existing.googleSub;
      if (!claimable || !existing.activeSpaceId) {
        throw errors.conflict('Email already registered');
      }
      const [adopted] = await tx
        .update(users)
        .set({
          passwordHash,
          displayName: existing.displayName ?? displayName ?? null,
          primaryLanguage: existing.primaryLanguage ?? primaryLanguage,
          lastLoginAt: new Date(),
        })
        .where(eq(users.id, existing.id))
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
      if (!adopted || !adopted.activeSpaceId) throw errors.internal('Account claim failed');
      return { user: adopted, spaceId: adopted.activeSpaceId };
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

  const tokens = await issueTokenPair(result.user.id, result.spaceId);

  c.get('log').info('AUTH_REGISTER_OK', { userId: result.user.id });

  return c.json(
    ok({
      user: serializeUser(result.user, result.spaceId),
      tokens,
    }),
    201,
  );
});

app.post('/login', authLimit, validate('json', loginInput), async (c) => {
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

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id));
  const tokens = await issueTokenPair(row.id, row.activeSpaceId);

  c.get('log').info('AUTH_LOGIN_OK', { userId: row.id });

  return c.json(
    ok({
      user: serializeUser(row, row.activeSpaceId),
      tokens,
    }),
  );
});

app.post('/google', authLimit, validate('json', googleAuthInput), async (c) => {
  const { credential, primaryLanguage } = c.req.valid('json');
  const profile = await verifyGoogleCredential(credential);
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const [bySub] = await tx
      .select(authUserColumns)
      .from(users)
      .where(eq(users.googleSub, profile.sub))
      .limit(1);

    if (bySub) {
      if (!bySub.activeSpaceId) throw errors.unauthorized('User missing workspace');
      const [updated] = await tx
        .update(users)
        .set({
          displayName: bySub.displayName ?? profile.name,
          googlePictureUrl: profile.picture,
          googleEmailVerifiedAt: now,
          lastLoginAt: now,
        })
        .where(eq(users.id, bySub.id))
        .returning(authUserColumns);
      if (!updated || !updated.activeSpaceId) throw errors.internal('Google login failed');
      return { user: updated, spaceId: updated.activeSpaceId, created: false };
    }

    const [byEmail] = await tx
      .select(authUserColumns)
      .from(users)
      .where(eq(users.email, profile.email))
      .limit(1);

    if (byEmail) {
      if (byEmail.googleSub && byEmail.googleSub !== profile.sub) {
        throw errors.conflict('This email is already linked to another Google account');
      }
      if (!byEmail.googleSub && !isAuthoritativeGoogleEmail(profile)) {
        throw errors.conflict(
          'Sign in with your password once before linking Google for this email',
        );
      }
      if (!byEmail.activeSpaceId) throw errors.unauthorized('User missing workspace');

      const [updated] = await tx
        .update(users)
        .set({
          googleSub: profile.sub,
          displayName: byEmail.displayName ?? profile.name,
          googlePictureUrl: profile.picture,
          googleEmailVerifiedAt: now,
          lastLoginAt: now,
        })
        .where(eq(users.id, byEmail.id))
        .returning(authUserColumns);
      if (!updated || !updated.activeSpaceId) throw errors.internal('Google login failed');
      return { user: updated, spaceId: updated.activeSpaceId, created: false };
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
        email: profile.email,
        passwordHash: null,
        googleSub: profile.sub,
        googlePictureUrl: profile.picture,
        googleEmailVerifiedAt: now,
        displayName: profile.name,
        primaryLanguage,
        baseCurrency: 'INR',
        activeSpaceId: space.id,
        lastLoginAt: now,
      })
      .returning(authUserColumns);
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

    return { user, spaceId: space.id, created: true };
  });

  const tokens = await issueTokenPair(result.user.id, result.spaceId);
  c.get('log').info('AUTH_GOOGLE_OK', {
    userId: result.user.id,
    created: result.created,
  });

  return c.json(
    ok({
      user: serializeUser(result.user, result.spaceId),
      tokens,
    }),
    result.created ? 201 : 200,
  );
});

app.post('/refresh', validate('json', refreshInput), async (c) => {
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
      .where(and(eq(refreshTokens.tokenHash, tokenHash), gt(refreshTokens.expiresAt, new Date())))
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

    await tx
      .update(refreshTokens)
      .set({ rotatedAt: new Date() })
      .where(eq(refreshTokens.id, row.id));

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
  if (
    body &&
    typeof body === 'object' &&
    'refreshToken' in body &&
    typeof (body as { refreshToken: unknown }).refreshToken === 'string'
  ) {
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
      // The code is not sent out-of-band yet, so the web UI must show it.
      // It is short-lived and still has to be sent from the user's WhatsApp
      // number, which proves control of the phone being linked.
      code: otp.code,
      expiresAt: otp.expiresAt.toISOString(),
      instruction: 'Send LINK <code> to the Versifine bot from your WhatsApp.',
    }),
  );
});

app.post('/phone-link/confirm', otpLimit, validate('json', phoneLinkConfirmInput), async (c) => {
  const { code, phone } = c.req.valid('json');
  const normalized = normalizePhone(phone);

  const otp = await getValidOtp(code);

  const linked = await db.transaction(async (tx) => {
    const [conflict] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.whatsappPhone, normalized))
      .limit(1);
    if (conflict && conflict.id !== otp.userId) {
      // The LINK command proves both sides: the user is signed in on the web
      // account that minted the code, and controls the WhatsApp number that
      // sent it. Move the number to the web account instead of trapping them
      // behind an older phone-first account.
      await tx
        .update(users)
        .set({ whatsappPhone: null, whatsappPhoneVerifiedAt: null })
        .where(eq(users.id, conflict.id));
    }

    const [user] = await tx
      .update(users)
      .set({ whatsappPhone: normalized, whatsappPhoneVerifiedAt: new Date() })
      .where(eq(users.id, otp.userId))
      .returning({ id: users.id, activeSpaceId: users.activeSpaceId });
    if (!user?.activeSpaceId) throw errors.internal('Phone link target missing workspace');

    const [consumed] = await tx
      .update(phoneLinkOtps)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(phoneLinkOtps.id, otp.id),
          isNull(phoneLinkOtps.consumedAt),
          gt(phoneLinkOtps.expiresAt, new Date()),
        ),
      )
      .returning({ id: phoneLinkOtps.id });
    if (!consumed) throw errors.notFound('OTP not found or expired');

    // Clean stale OTPs.
    await tx
      .update(phoneLinkOtps)
      .set({ consumedAt: drizzleSql`coalesce(${phoneLinkOtps.consumedAt}, now())` })
      .where(eq(phoneLinkOtps.userId, otp.userId));

    return { userId: user.id, spaceId: user.activeSpaceId };
  });

  return c.json(ok({ linked: true, phone: normalized, ...linked }));
});

async function issueTokenPair(userId: string, activeSpaceId: string) {
  const accessToken = await signAccessToken({ sub: userId, asid: activeSpaceId });
  const { token: refreshToken } = await signRefreshToken({ sub: userId });
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000),
  });
  return {
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  };
}

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
