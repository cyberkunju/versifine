/**
 * Budgets store named recurring or one-off allocations across categories.
 * Allocations live in JSONB so the set of categories per budget is flexible
 * without a join table. Progress is computed on demand from transactions.
 */
import { sql } from 'drizzle-orm';
import {
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    recurrence: varchar('recurrence', { length: 16 }).notNull(),
    /** Stored only for `custom` recurrence; monthly budgets compute from now(). */
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    allocations: jsonb('allocations').notNull(),
    warnThreshold: smallint('warn_threshold').notNull().default(80),
    exceedThreshold: smallint('exceed_threshold').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('budgets_space_idx').on(t.spaceId)],
);

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
