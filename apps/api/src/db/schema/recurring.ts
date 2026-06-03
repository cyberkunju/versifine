import { sql } from 'drizzle-orm';
import {
  char,
  customType,
  date,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';

const numeric14_2 = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(14,2)',
});
const numeric3_2 = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(3,2)',
});

export const recurringItems = pgTable(
  'recurring_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    merchantNormalized: varchar('merchant_normalized', { length: 200 }).notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    averageAmount: numeric14_2('average_amount').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    frequencyDays: integer('frequency_days').notNull(),
    nextExpectedDate: date('next_expected_date'),
    occurrences: integer('occurrences').notNull(),
    confidence: numeric3_2('confidence').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('recurring_items_space_merchant_unique').on(t.spaceId, t.merchantNormalized),
    index('recurring_items_space_status_idx').on(t.spaceId, t.status),
  ],
);

export type RecurringItem = typeof recurringItems.$inferSelect;
export type NewRecurringItem = typeof recurringItems.$inferInsert;
