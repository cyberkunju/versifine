/**
 * The transaction is the system's atomic record of money moving in or out.
 *
 * `amount` is always positive — direction is encoded in `type`. `baseAmount`
 * is the amount converted to the wallet's currency; native amount and
 * currency are kept verbatim and the `fx_rate` used is recorded for audit.
 * Soft delete via `deleted_at` so audit remains intact.
 *
 * Indexes target the queries we actually run: list by date desc, filter by
 * category, filter by wallet, full-text search on description (gin_trgm).
 *
 * `categoryOverrides` and `categoryCorrections` live next to this table in
 * `schema/overrides.ts` so a single import gives every related table.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  customType,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';
import { wallets } from './wallets.ts';

/**
 * Numeric custom types — strings on the wire so `.toFixed()` calls in the
 * services typecheck cleanly. The driver keeps decimals exact (no IEEE 754
 * rounding) and SELECT queries wrap with `Number(row.amount)` at the
 * service layer when a JS number is needed.
 */
const numeric14_2 = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(14,2)',
});
const numeric3_2 = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(3,2)',
});
const numeric18_8 = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(18,8)',
});

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),

    type: varchar('type', { length: 20 }).notNull(),
    amount: numeric14_2('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    baseAmount: numeric14_2('base_amount').notNull(),
    fxRate: numeric18_8('fx_rate'),

    description: text('description').notNull(),
    category: varchar('category', { length: 40 }),
    categoryConfidence: numeric3_2('category_confidence'),
    categorizedBy: varchar('categorized_by', { length: 16 }),

    date: date('date').notNull(),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),

    source: varchar('source', { length: 24 }).notNull(),
    transferId: uuid('transfer_id'),
    needsFxResolution: boolean('needs_fx_resolution').notNull().default(false),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('transactions_space_date_idx').on(t.spaceId, t.date.desc()),
    index('transactions_space_category_idx').on(t.spaceId, t.category),
    index('transactions_space_wallet_idx').on(t.spaceId, t.walletId),
    index('transactions_space_type_idx').on(t.spaceId, t.type),
    index('transactions_transfer_idx').on(t.transferId),
    // Trigram index on description so /search can use `description ILIKE %...%`
    // efficiently. Drizzle emits `USING gin (description gin_trgm_ops)`.
    index('transactions_description_trgm_idx').using(
      'gin',
      sql`description gin_trgm_ops`,
    ),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
