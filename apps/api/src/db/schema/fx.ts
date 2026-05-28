/**
 * FX cache. Keyed by (base, quote). Refreshed every 6h by the `fx` service.
 * Reads always hit Postgres; we never call the upstream rate API per-request.
 */
import { char, customType, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core';

const numeric18_8 = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(18,8)',
});

export const fxRates = pgTable(
  'fx_rates',
  {
    base: char('base', { length: 3 }).notNull(),
    quote: char('quote', { length: 3 }).notNull(),
    rate: numeric18_8('rate').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.base, t.quote] })],
);

export type FxRate = typeof fxRates.$inferSelect;
export type NewFxRate = typeof fxRates.$inferInsert;
