import { sql } from 'drizzle-orm';
import { customType, date, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';

const numeric14_2 = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(14,2)',
});

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    targetAmount: numeric14_2('target_amount').notNull(),
    currentAmount: numeric14_2('current_amount').notNull().default('0'),
    deadline: date('deadline'),
    linkedCategory: varchar('linked_category', { length: 40 }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('goals_space_status_idx').on(t.spaceId, t.status),
    index('goals_space_category_idx').on(t.spaceId, t.linkedCategory),
  ],
);

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
