/**
 * Column helpers shared across every table.
 *
 * Keeping the boilerplate here means the table definitions stay focused on
 * what makes them different rather than repeating the same `id` + `created_at`
 * + `updated_at` columns thirteen times.
 */
import { sql } from 'drizzle-orm';
import { numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

export const primaryUuid = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`now()`);

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`now()`);

export const deletedAt = () => timestamp('deleted_at', { withTimezone: true, mode: 'date' });

/** Money column. Always positive; sign is encoded in the row's `type`. */
export const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
