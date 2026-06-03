/**
 * Identity-layer tables.
 *
 * `users` is the only authentication subject. A successful registration
 * creates exactly one row here, plus a personal `spaces` row, plus a default
 * INR `wallets` row in a single transaction.
 *
 * `phone_link_otps` are short-lived tokens used to bind a WhatsApp number
 * to an account: the user requests a code on the web, then sends it to
 * the bot. Once consumed the row is kept for audit but won't validate again.
 *
 * `refresh_tokens` are stored as one-way hashes. The plain token only ever
 * exists in transit; rotation marks the previous row as rotated, revocation
 * marks it revoked.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/** Citext (case-insensitive text). */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: citext('email').notNull(),
    passwordHash: text('password_hash'),
    googleSub: varchar('google_sub', { length: 64 }),
    googlePictureUrl: text('google_picture_url'),
    googleEmailVerifiedAt: timestamp('google_email_verified_at', { withTimezone: true }),
    displayName: varchar('display_name', { length: 80 }),
    primaryLanguage: varchar('primary_language', { length: 4 }).notNull().default('en'),
    baseCurrency: char('base_currency', { length: 3 }).notNull().default('INR'),
    /** FK is added later as ALTER TABLE in spaces.ts to break the cycle. */
    activeSpaceId: uuid('active_space_id'),
    whatsappPhone: varchar('whatsapp_phone', { length: 20 }),
    whatsappPhoneVerifiedAt: timestamp('whatsapp_phone_verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    uniqueIndex('users_google_sub_unique').on(t.googleSub).where(sql`${t.googleSub} IS NOT NULL`),
    uniqueIndex('users_whatsapp_phone_unique')
      .on(t.whatsappPhone)
      .where(sql`${t.whatsappPhone} IS NOT NULL`),
  ],
);

export const phoneLinkOtps = pgTable(
  'phone_link_otps',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('phone_link_otps_user_id_idx').on(t.userId),
    index('phone_link_otps_code_idx').on(t.code),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_unique').on(t.tokenHash),
    index('refresh_tokens_user_id_idx').on(t.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PhoneLinkOtp = typeof phoneLinkOtps.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;

// Boolean import is unused but kept available for future fields without churn.
void boolean;
