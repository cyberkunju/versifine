/**
 * Phone-link OTP service.
 *
 * Six-digit code, ten-minute TTL, single-use. Codes are stored in clear in
 * the dev database for ease of debugging — fine because they expire fast and
 * the bot consumes them out-of-band. For prod they should be hashed.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { phoneLinkOtps } from '../../db/schema/users.ts';
import { errors } from '../../utils/errors.ts';

const OTP_TTL_MS = 10 * 60 * 1000;

function generateCode(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

export async function createOtp(userId: string): Promise<{ id: string; code: string; expiresAt: Date }> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const [row] = await db
    .insert(phoneLinkOtps)
    .values({ userId, code, expiresAt })
    .returning({ id: phoneLinkOtps.id });
  if (!row) throw errors.internal('OTP creation failed');
  return { id: row.id, code, expiresAt };
}

export async function consumeOtp(code: string): Promise<{ userId: string }> {
  const now = new Date();
  const [row] = await db
    .select({
      id: phoneLinkOtps.id,
      userId: phoneLinkOtps.userId,
    })
    .from(phoneLinkOtps)
    .where(
      and(
        eq(phoneLinkOtps.code, code),
        isNull(phoneLinkOtps.consumedAt),
        gt(phoneLinkOtps.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) throw errors.notFound('OTP not found or expired');

  await db
    .update(phoneLinkOtps)
    .set({ consumedAt: now })
    .where(eq(phoneLinkOtps.id, row.id));

  return { userId: row.userId };
}
