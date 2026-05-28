/**
 * Money containers. A wallet is everything from a cash drawer to a credit
 * card. Live balance is *computed* on the fly from non-deleted transactions
 * so we never have to keep a stored balance in sync with a transaction log.
 */
import { sql } from 'drizzle-orm';
import { char, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    type: varchar('type', { length: 20 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('wallets_space_id_idx').on(t.spaceId, t.archivedAt)],
);

export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
