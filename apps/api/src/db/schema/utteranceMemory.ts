/**
 * Utterance Memory — the semantic nearest-neighbor cache at the heart of the
 * Adaptive Intelligence Engine (AIE).
 *
 * Every confirmed parse is stored here as a 1536-dim embedding.  On the next
 * call, cosine similarity search finds the closest past utterance in O(log n)
 * and returns its cached parse directly — bypassing the LLM entirely (Tier 0,
 * ~5 ms). After a few weeks of use, 60–80 % of messages resolve from memory.
 *
 * `confirm_count` / `reject_count` track user feedback so the system knows
 * which cached parses to trust and which to demote.
 */
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  real,
} from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';

export const UTTERANCE_VECTOR_DIM = 1024;

const utteranceVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${UTTERANCE_VECTOR_DIM})`,
  toDriver: (v) => `[${v.join(',')}]`,
  fromDriver: (v) => JSON.parse(v) as number[],
});

export const utteranceMemory = pgTable(
  'utterance_memory',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),

    /** Raw text exactly as the user typed/spoke it. */
    text: text('text').notNull(),

    /**
     * SHA-256 hex of the normalised (lowercase, collapsed whitespace) text.
     * Used for exact-match dedup before touching the vector index.
     */
    textHash: varchar('text_hash', { length: 64 }).notNull(),

    /** 1536-dim embedding produced by text-embedding-3-small. */
    embedding: utteranceVector('embedding').notNull(),

    /**
     * The full ParsedExpense result serialised to JSON.
     * Updated in-place whenever a better parse is recorded for this hash.
     */
    parsedResult: jsonb('parsed_result').notNull(),

    /** User explicitly confirmed this parse as correct. */
    confirmCount: integer('confirm_count').notNull().default(0),

    /** User rejected / edited this parse. */
    rejectCount: integer('reject_count').notNull().default(0),

    /**
     * confirmCount / (confirmCount + rejectCount).
     * Null until at least one feedback signal is received.
     */
    lastAccuracy: real('last_accuracy'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('utterance_memory_space_hash_uidx').on(t.spaceId, t.textHash),
    // IVF-Flat cosine index — same pattern as transaction_embeddings.
    index('utterance_memory_embedding_idx').using(
      'ivfflat',
      sql`embedding vector_cosine_ops`,
    ),
    index('utterance_memory_space_idx').on(t.spaceId),
  ],
);

export type UtteranceMemoryRow = typeof utteranceMemory.$inferSelect;
export type NewUtteranceMemoryRow = typeof utteranceMemory.$inferInsert;
