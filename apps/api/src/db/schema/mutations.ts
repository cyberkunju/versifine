/**
 * Transaction mutation log — append-only audit + the undo stack.
 *
 * Every state change to a transaction (create, update/correction, delete)
 * writes one row here with a BEFORE and/or AFTER snapshot of the affected
 * fields. Two jobs in one table:
 *
 *   1. AUDIT — an immutable trail of who changed what (amount corrections
 *      included, which `category_corrections` never recorded). A silently
 *      rewritten ₹50,000 → ₹50 is now provable and reversible.
 *   2. UNDO — "undo" / "oops" reverses the user's most recent mutation by
 *      replaying the snapshot in the opposite direction. `undoneAt` marks a
 *      row as already reversed so the next "undo" walks to the prior action
 *      (a real stack) and a mutation is never undone twice.
 *
 * Scoped by (space_id, user_id); the latest non-undone row for a user is the
 * top of their undo stack.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';
import { users } from './users.ts';
import { transactions } from './transactions.ts';

export const transactionMutations = pgTable(
  'transaction_mutations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    /** 'create' | 'update' | 'delete' */
    action: varchar('action', { length: 16 }).notNull(),
    /**
     * Short user-friendly token (6 chars, unambiguous alphanumeric) the bot
     * surfaces in every reply that involves a mutation: "✅ Logged ₹50 ·
     * undo K7P2A9". The user types the token to reverse THIS specific
     * mutation — no state required, the token itself is the lookup key.
     * Unique within the user's space.
     */
    token: varchar('token', { length: 8 }),
    /** Field snapshot BEFORE the change (null for 'create'). */
    before: jsonb('before'),
    /** Field snapshot AFTER the change (null for 'delete'). */
    after: jsonb('after'),
    /** Where the change came from (whatsapp_text, correction, manual_web, …). */
    source: varchar('source', { length: 32 }),
    /** Set when this mutation has been reversed by an undo. */
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('transaction_mutations_space_user_idx').on(t.spaceId, t.userId, t.createdAt),
    // Unique on (space, token) so the bot's "type the token to undo" flow
    // never resolves to two different mutations in the same user's space.
    // The 31-char × 6-len alphabet (887M tokens) makes collisions negligible
    // even for power users; recordMutation retries on the rare collision.
    uniqueIndex('transaction_mutations_token_idx').on(t.spaceId, t.token),
  ],
);

export type TransactionMutation = typeof transactionMutations.$inferSelect;
export type NewTransactionMutation = typeof transactionMutations.$inferInsert;
