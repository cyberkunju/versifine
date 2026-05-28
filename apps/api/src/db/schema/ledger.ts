import { sql } from 'drizzle-orm';
import {
  char,
  customType,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';
import { transactions } from './transactions.ts';

const numeric14_2 = customType<{ data: string; driverData: string }>({
  dataType: () => 'numeric(14,2)',
});

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    direction: varchar('direction', { length: 16 }).notNull(),
    counterpartyName: varchar('counterparty_name', { length: 120 }).notNull(),
    amount: numeric14_2('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    baseAmount: numeric14_2('base_amount').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    outstanding: numeric14_2('outstanding').notNull(),
    date: date('date').notNull(),
    note: text('note'),
    linkedTransactionId: uuid('linked_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('ledger_entries_space_status_idx').on(t.spaceId, t.status),
    index('ledger_entries_counterparty_idx').on(t.spaceId, t.counterpartyName),
  ],
);

export const ledgerSettlements = pgTable(
  'ledger_settlements',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ledgerEntryId: uuid('ledger_entry_id')
      .notNull()
      .references(() => ledgerEntries.id, { onDelete: 'cascade' }),
    amount: numeric14_2('amount').notNull(),
    date: date('date').notNull(),
    linkedTransactionId: uuid('linked_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ledger_settlements_entry_idx').on(t.ledgerEntryId)],
);

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
export type LedgerSettlement = typeof ledgerSettlements.$inferSelect;
export type NewLedgerSettlement = typeof ledgerSettlements.$inferInsert;
