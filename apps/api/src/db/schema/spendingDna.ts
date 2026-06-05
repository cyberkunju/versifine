/**
 * Spending DNA — per-space behavioural fingerprint derived from transaction
 * history.  Rebuilt asynchronously after every confirmed transaction.
 *
 * `spending_dna`  — one row per space, storing the aggregated profile.
 * `prompt_examples` — curated space-specific few-shot examples for the LLM,
 *   ordered by the difficulty score (1 − initial confidence) so the hardest
 *   cases get priority in the dynamic prompt.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  real,
} from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';

/* -------------------------------------------------------------------------
 * spending_dna
 * ---------------------------------------------------------------------- */

export const spendingDna = pgTable('spending_dna', {
  spaceId: uuid('space_id')
    .primaryKey()
    .references(() => spaces.id, { onDelete: 'cascade' }),

  /**
   * Rank-ordered wallet names from most-used to least.
   * e.g. ["HDFC", "Cash", "UPI"]
   */
  preferredWallets: jsonb('preferred_wallets').notNull().default(sql`'[]'::jsonb`),

  /**
   * Top spending categories with share percentages.
   * e.g. [{ category: "Food", share: 0.32 }, ...]
   */
  topCategories: jsonb('top_categories').notNull().default(sql`'[]'::jsonb`),

  /**
   * Average amounts keyed by category.
   * e.g. { "Food": 320, "Transport": 150 }
   */
  avgAmounts: jsonb('avg_amounts').notNull().default(sql`'{}'::jsonb`),

  /**
   * Frequently seen merchant/description tokens.
   * e.g. ["swiggy", "auto", "chai", "netflix"]
   */
  commonMerchants: jsonb('common_merchants').notNull().default(sql`'[]'::jsonb`),

  /**
   * Total confirmed transactions used to compute this profile.
   * Used to gate how much weight we give the DNA (profiles with < 10
   * transactions are treated as weak priors).
   */
  transactionCount: integer('transaction_count').notNull().default(0),

  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SpendingDna = typeof spendingDna.$inferSelect;
export type NewSpendingDna = typeof spendingDna.$inferInsert;

/* -------------------------------------------------------------------------
 * prompt_examples
 * ---------------------------------------------------------------------- */

/**
 * Space-specific few-shot examples injected into the LLM parse prompt.
 *
 * `difficultyScore` = 1 − initial_confidence of the LLM parse on first
 * encounter.  We surface the hardest examples (highest score) so the prompt
 * becomes maximally calibrated to each space's unusual vocabulary.
 */
export const promptExamples = pgTable(
  'prompt_examples',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),

    /** The original user utterance. */
    utterance: text('utterance').notNull(),

    /**
     * The verified ParsedExpense (after confirmation) serialised as JSON.
     * Used verbatim as the "→ output" side of the few-shot example.
     */
    parsedJson: jsonb('parsed_json').notNull(),

    /**
     * Higher → harder.  Hard examples are more valuable as few-shot context
     * because they teach the model the edge cases it would otherwise flunk.
     */
    difficultyScore: real('difficulty_score').notNull().default(0.5),

    /** Number of times this example has been surfaced in a prompt. */
    useCount: integer('use_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('prompt_examples_space_utterance_uidx').on(t.spaceId, t.utterance),
    index('prompt_examples_difficulty_idx').on(t.spaceId, t.difficultyScore),
    index('prompt_examples_space_idx').on(t.spaceId),
  ],
);

export type PromptExample = typeof promptExamples.$inferSelect;
export type NewPromptExample = typeof promptExamples.$inferInsert;
