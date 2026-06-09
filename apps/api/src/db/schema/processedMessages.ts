/**
 * Inbound WhatsApp message idempotency — durable dedup.
 *
 * Meta's Cloud API delivers webhooks at-least-once and retries on any non-200
 * or timeout, sometimes across minutes. The in-memory ring catches retries
 * while the process is up, but is lost on restart — a retry that lands just
 * after a deploy/restart would re-process the message, which now risks a
 * double-log, double-correction, or double-delete. This table makes the dedup
 * survive restarts: insert-on-conflict-do-nothing keyed by the Meta message id.
 *
 * Rows are tiny and pruned by `created_at` (a few days of retention is plenty —
 * Meta never retries older than that).
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const processedMessages = pgTable(
  'processed_messages',
  {
    messageId: varchar('message_id', { length: 128 }).primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('processed_messages_created_idx').on(t.createdAt)],
);

export type ProcessedMessage = typeof processedMessages.$inferSelect;
