/**
 * Tenancy. Every owned row in the system has `space_id`, even though the MVP
 * only ever creates one personal space per user. The `space_members` table
 * is empty in MVP (the owner relationship lives on `users.activeSpaceId`)
 * but exists so that v2 can grant collaborators without a migration.
 */
import { sql } from 'drizzle-orm';
import { char, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 80 }).notNull(),
  type: varchar('type', { length: 20 }).notNull().default('personal'),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('INR'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull().default('owner'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] })],
);

export type Space = typeof spaces.$inferSelect;
export type NewSpace = typeof spaces.$inferInsert;
export type SpaceMember = typeof spaceMembers.$inferSelect;
