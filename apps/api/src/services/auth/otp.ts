/**
 * Phone-link OTP service.
 *
 * Six-digit code, ten-minute TTL, single-use. The cleartext code is shown
 * to the user once (web → "send LINK <code>") and NEVER stored: we persist
 * only an HMAC-SHA256 of the code keyed by a server secret. The HMAC is
 * deterministic, so we can still look the row up by hashing the submitted
 * code, but the stored value is useless to anyone who reads the database.
 * Confirmation is gated by a tight rate limit at the route layer, so the
 * 6-digit space can't be brute-forced online.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { phoneLinkOtps } from '../../db/schema/users.ts';
import { env } from '../../env.ts';
import { errors } from '../../utils/errors.ts';

const OTP_TTL_MS = 10 * 60 * 1000;

function generateCode(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

/** Deterministic, non-reversible hash of an OTP code (hex, 64 chars). */
function hashCode(code: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(code).digest('hex');
}

export async function createOtp(userId: string): Promise<{ id: string; code: string; expiresAt: Date }> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const [row] = await db
    .insert(phoneLinkOtps)
    .values({ userId, code: hashCode(code), expiresAt })
    .returning({ id: phoneLinkOtps.id });
  if (!row) throw errors.internal('OTP creation failed');
  // Return the cleartext code to the caller (shown to the user once); the
  // database only ever holds the hash.
  return { id: row.id, code, expiresAt };
}

export async function consumeOtp(code: string): Promise<{ userId: string }> {
  const now = new Date();
  const hashed = hashCode(code);
  const [row] = await db
    .select({
      id: phoneLinkOtps.id,
      userId: phoneLinkOtps.userId,
      code: phoneLinkOtps.code,
    })
    .from(phoneLinkOtps)
    .where(
      and(
        eq(phoneLinkOtps.code, hashed),
        isNull(phoneLinkOtps.consumedAt),
        gt(phoneLinkOtps.expiresAt, now),
      ),
    )
    .limit(1);

  // Constant-time confirmation that the row's stored hash matches, so the
  // lookup itself can't be turned into a timing oracle.
  if (!row || !safeEqualHex(row.code, hashed)) {
    throw errors.notFound('OTP not found or expired');
  }

  await db
    .update(phoneLinkOtps)
    .set({ consumedAt: now })
    .where(eq(phoneLinkOtps.id, row.id));

  return { userId: row.userId };
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
