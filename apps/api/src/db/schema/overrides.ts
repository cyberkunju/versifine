/**
 * Per-space category overrides — the personalization layer.
 *
 * When a user corrects a transaction's category, we:
 *   1. Insert a row into `category_corrections` (history / audit).
 *   2. Upsert into `category_overrides` keyed by `merchant_normalized` so
 *      every future transaction with the same normalized merchant gets
 *      the corrected label instantly.
 *
 * `merchant_normalized` lowercases, strips UPI handles like `@oksbi`, store
 * numbers, city codes, and collapses whitespace. The exact algorithm lives
 * in `services/transactions/normalize.ts`.
 *
 * Column types here are the canonical definitions and match what the
 * initial migration created. The `transactions.ts` schema file used to
 * define these tables as well — it no longer does.
 */
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';
import { transactions } from './transactions.ts';

const numeric6_0 = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(6,0)',
});

export const categoryOverrides = pgTable(
  'category_overrides',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    merchantNormalized: varchar('merchant_normalized', { length: 200 }).notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    occurrences: numeric6_0('occurrences').notNull().default('1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('category_overrides_space_merchant_unique').on(t.spaceId, t.merchantNormalized),
  ],
);

export const categoryCorrections = pgTable(
  'category_corrections',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    fromCategory: varchar('from_category', { length: 40 }),
    toCategory: varchar('to_category', { length: 40 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('category_corrections_space_idx').on(t.spaceId)],
);

export type CategoryOverride = typeof categoryOverrides.$inferSelect;
export type NewCategoryOverride = typeof categoryOverrides.$inferInsert;
export type CategoryCorrection = typeof categoryCorrections.$inferSelect;
export type NewCategoryCorrection = typeof categoryCorrections.$inferInsert;
