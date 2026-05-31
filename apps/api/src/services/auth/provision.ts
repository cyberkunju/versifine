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
  /** Email now stored on the account (synthetic placeholder when skipped). */
  email: string;
  /** True when the phone was attached to a pre-existing web/email account. */
  linkedExisting: boolean;
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

/** Synthetic domain marker — these addresses are placeholders, not real inboxes. */
const SYNTHETIC_EMAIL_DOMAIN = '@wa.versifine.local';

/**
 * True when `email` is one of our auto-generated placeholders (a phone-first
 * account that never supplied a real address). Such an account is "claimable":
 * its real identity isn't set yet, so it can adopt a real email later.
 */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase().endsWith(SYNTHETIC_EMAIL_DOMAIN));
}

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
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
 *
 * `email` (optional) enables passwordless cross-surface linking — no OTP,
 * because a WhatsApp message already proves control of the number:
 *   - phone NOT yet known + email matches a web/email account with no phone
 *     → attach this phone to that account (WhatsApp now logs into the web
 *     account). `linkedExisting = true`.
 *   - phone NOT yet known + email is free → create the account storing the
 *     REAL email, so a later web `register`/Google sign-in with the same
 *     address adopts this same account.
 *   - phone already known + account still on a synthetic placeholder email +
 *     the real email is free → upgrade the stored email to the real one.
 */
export async function ensureUserByPhone(
  phoneRaw: string,
  language: Language,
  emailRaw?: string | null,
): Promise<ProvisionedAccount> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw errors.validation('Invalid phone');
  const email = normalizeEmail(emailRaw);

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        primaryLanguage: users.primaryLanguage,
        activeSpaceId: users.activeSpaceId,
      })
      .from(users)
      .where(eq(users.whatsappPhone, phone))
      .limit(1);

    // ── Phone already linked to an account ────────────────────────────────
    if (existing && existing.activeSpaceId) {
      const patch: Partial<typeof users.$inferInsert> = {};
      if (existing.primaryLanguage !== language) patch.primaryLanguage = language;

      // Upgrade a placeholder email to the real one the user just typed,
      // but only when nobody else already owns that address.
      let storedEmail = existing.email;
      if (email && isSyntheticEmail(existing.email)) {
        const [emailOwner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!emailOwner || emailOwner.id === existing.id) {
          patch.email = email;
          storedEmail = email;
        }
      }

      if (Object.keys(patch).length > 0) {
        await tx.update(users).set(patch).where(eq(users.id, existing.id));
      }
      return {
        userId: existing.id,
        spaceId: existing.activeSpaceId,
        displayName: existing.displayName,
        language,
        isNew: false,
        email: storedEmail,
        linkedExisting: false,
      };
    }

    // ── Phone not known yet, but an email was provided: try to link ───────
    if (email) {
      const [byEmail] = await tx
        .select({
          id: users.id,
          displayName: users.displayName,
          primaryLanguage: users.primaryLanguage,
          activeSpaceId: users.activeSpaceId,
          whatsappPhone: users.whatsappPhone,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (byEmail && byEmail.activeSpaceId && !byEmail.whatsappPhone) {
        // Attach this phone to the pre-existing web/email account.
        await tx
          .update(users)
          .set({
            whatsappPhone: phone,
            whatsappPhoneVerifiedAt: new Date(),
            primaryLanguage: byEmail.primaryLanguage ?? language,
          })
          .where(eq(users.id, byEmail.id));
        return {
          userId: byEmail.id,
          spaceId: byEmail.activeSpaceId,
          displayName: byEmail.displayName,
          language: (byEmail.primaryLanguage as Language) ?? language,
          isNew: false,
          email,
          linkedExisting: true,
        };
      }
      // Email belongs to an account that already has a (different) phone —
      // we can't safely merge two populated accounts here, so fall through
      // and create a fresh phone-first account under a placeholder email.
    }

    // ── Brand-new account. Store the real email when it's free. ──────────
    let emailToStore = syntheticEmail(phone);
    if (email) {
      const [emailOwner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (!emailOwner) emailToStore = email;
    }

    const [space] = await tx
      .insert(spaces)
      .values({ name: 'Personal', type: 'personal', baseCurrency: 'INR' })
      .returning({ id: spaces.id });
    if (!space) throw errors.internal('Space creation failed');

    const [user] = await tx
      .insert(users)
      .values({
        email: emailToStore,
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
      email: emailToStore,
      linkedExisting: false,
    };
  });
}
