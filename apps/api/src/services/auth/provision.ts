/**
 * Phone-first account provisioning.
 *
 * The WhatsApp bot is the entry point for users who never touch the web:
 * a message from a number is, by WhatsApp's own delivery, proof that the
 * sender controls that number. So the bot can auto-provision an account
 * keyed by `whatsapp_phone` with no password and no second OTP — the same
 * way the Google path provisions a passwordless account keyed by `google_sub`.
 *
 * `ensureUserByPhone` is the single find-or-create entry point:
 *   - existing account for this phone  → return it (optionally refresh its
 *     primary language when the bot reports a switch),
 *   - no account                       → create user + personal space +
 *     default wallet in one transaction, exactly like /auth/register.
 *
 * The synthetic email (`wa-<phone>@wa.versifine.local`) satisfies the NOT
 * NULL + UNIQUE constraint on `users.email` without colliding with any real
 * address. A phone-first user who later wants the website goes through the
 * explicit claim/link flow rather than logging in with this placeholder.
 */
import { eq } from 'drizzle-orm';
import type { Language } from '@versifine/shared';
import { db } from '../../db/client.ts';
import { spaceMembers, spaces } from '../../db/schema/spaces.ts';
import { users } from '../../db/schema/users.ts';
import { wallets } from '../../db/schema/wallets.ts';
import { errors } from '../../utils/errors.ts';
import { normalizePhone } from '../../utils/phone.ts';

export interface ProvisionedAccount {
  userId: string;
  spaceId: string;
  displayName: string | null;
  language: string;
  isNew: boolean;
}

export interface ExistingAccount {
  exists: boolean;
  userId: string | null;
  displayName: string | null;
  language: string;
  /** True when the phone is bound to an account created on the web/Google
   * side (has a password or Google identity) rather than auto-provisioned. */
  webLinked: boolean;
}

/** Placeholder address bound to the phone; valid email shape, never a real inbox. */
function syntheticEmail(phone: string): string {
  return `wa-${phone}@wa.versifine.local`;
}

/**
 * Read-only lookup: does an account already exist for this phone?
 * Never creates anything — used by the bot on first contact to decide
 * between "welcome back" and onboarding.
 */
export async function findAccountByPhone(phoneRaw: string): Promise<ExistingAccount> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return { exists: false, userId: null, displayName: null, language: 'en', webLinked: false };

  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      primaryLanguage: users.primaryLanguage,
      passwordHash: users.passwordHash,
      googleSub: users.googleSub,
      activeSpaceId: users.activeSpaceId,
    })
    .from(users)
    .where(eq(users.whatsappPhone, phone))
    .limit(1);

  if (!row || !row.activeSpaceId) {
    return { exists: false, userId: null, displayName: null, language: 'en', webLinked: false };
  }

  return {
    exists: true,
    userId: row.id,
    displayName: row.displayName,
    language: row.primaryLanguage,
    webLinked: Boolean(row.passwordHash) || Boolean(row.googleSub),
  };
}

/**
 * Find-or-create an account for a WhatsApp phone. Idempotent: a second call
 * for the same phone returns the same account. When `language` is supplied
 * and differs from the stored value for an existing account, the stored
 * primary language is refreshed (so a LANGUAGE switch in the bot persists
 * and survives bot restarts).
 */
export async function ensureUserByPhone(
  phoneRaw: string,
  language: Language,
): Promise<ProvisionedAccount> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw errors.validation('Invalid phone');

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: users.id,
        displayName: users.displayName,
        primaryLanguage: users.primaryLanguage,
        activeSpaceId: users.activeSpaceId,
      })
      .from(users)
      .where(eq(users.whatsappPhone, phone))
      .limit(1);

    if (existing && existing.activeSpaceId) {
      if (existing.primaryLanguage !== language) {
        await tx
          .update(users)
          .set({ primaryLanguage: language })
          .where(eq(users.id, existing.id));
      }
      return {
        userId: existing.id,
        spaceId: existing.activeSpaceId,
        displayName: existing.displayName,
        language,
        isNew: false,
      };
    }

    const [space] = await tx
      .insert(spaces)
      .values({ name: 'Personal', type: 'personal', baseCurrency: 'INR' })
      .returning({ id: spaces.id });
    if (!space) throw errors.internal('Space creation failed');

    const [user] = await tx
      .insert(users)
      .values({
        email: syntheticEmail(phone),
        passwordHash: null,
        displayName: null,
        primaryLanguage: language,
        baseCurrency: 'INR',
        activeSpaceId: space.id,
        whatsappPhone: phone,
        whatsappPhoneVerifiedAt: new Date(),
      })
      .returning({ id: users.id });
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

    return {
      userId: user.id,
      spaceId: space.id,
      displayName: null,
      language,
      isNew: true,
    };
  });
}
