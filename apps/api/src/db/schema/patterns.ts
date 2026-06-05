/**
 * Learned patterns — templates compiled from confirmed parses, used by
 * the PatternLearner as the Tier 1 fast path (~1 ms, zero LLM cost).
 *
 * The Adaptive Intelligence Engine extends this table with reinforcement
 * signals (confirm / reject counts) and a lifecycle status so patterns
 * can be promoted to gold (permanent) or demoted for self-healing.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  real,
} from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';

export const learnedPatterns = pgTable(
  'learned_patterns',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    template: text('template').notNull(),
    regex: text('regex').notNull(),
    fields: text('fields').array().notNull(),

    /* ── Reinforcement counters ─────────────────────────────────────── */

    /** How many times a user explicitly confirmed a parse matched by this pattern. */
    confirmCount: integer('confirm_count').notNull().default(0),

    /** How many times a user rejected / corrected a parse matched by this pattern. */
    rejectCount: integer('reject_count').notNull().default(0),

    /**
     * Rolling accuracy: confirmCount / (confirmCount + rejectCount).
     * Null until at least one feedback signal arrives.
     */
    lastAccuracy: real('last_accuracy'),

    /* ── Lifecycle ──────────────────────────────────────────────────── */

    /**
     * Pattern lifecycle state:
     *   'active'   — normal, matched against all incoming text
     *   'gold'     — promoted (≥20 confirms, ≥90% accuracy); never auto-pruned
     *   'demoted'  — accuracy < 30%; queued for self-healing pass
     *   'retired'  — self-healer could not fix it; excluded from matching
     */
    status: varchar('status', { length: 16 }).notNull().default('active'),

    /** Timestamp when the pattern reached 'gold' status. */
    promotedAt: timestamp('promoted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('learned_patterns_space_regex_unique').on(t.spaceId, t.regex),
    index('learned_patterns_space_idx').on(t.spaceId),
    index('learned_patterns_status_idx').on(t.spaceId, t.status),
  ],
);

export type LearnedPattern = typeof learnedPatterns.$inferSelect;
export type NewLearnedPattern = typeof learnedPatterns.$inferInsert;
