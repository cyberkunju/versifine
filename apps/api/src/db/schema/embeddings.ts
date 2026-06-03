/**
 * Vector embeddings for the copilot RAG retriever.
 *
 * One row per transaction, keyed by transaction id. The embedding is a
 * 1536-dimensional vector from OpenAI's `text-embedding-3-small`. We use an
 * IVF-Flat index because the corpus per user is small (a few thousand rows
 * at most for an MVP) and cosine distance is plenty accurate.
 */
import { sql } from 'drizzle-orm';
import { customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { spaces } from './spaces.ts';
import { transactions } from './transactions.ts';

/** Single source of truth for embedding dimensionality. */
export const VECTOR_DIM = 1536;

const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${VECTOR_DIM})`,
  toDriver: (v) => `[${v.join(',')}]`,
  fromDriver: (v) => JSON.parse(v) as number[],
});

export const transactionEmbeddings = pgTable(
  'transaction_embeddings',
  {
    transactionId: uuid('transaction_id')
      .primaryKey()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    embedding: vector1536('embedding').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // IVF-Flat over cosine distance. The migration replaces this with a
    // tuned `WITH (lists = 100)` variant; this declaration is just so
    // Drizzle generates the bare CREATE INDEX. Tuning lives in
    // 0001_add_cyclic_fk_and_index_tuning.sql.
    index('transaction_embeddings_vector_idx').using('ivfflat', sql`embedding vector_cosine_ops`),
    index('transaction_embeddings_space_idx').on(t.spaceId),
  ],
);

export type TransactionEmbedding = typeof transactionEmbeddings.$inferSelect;
export type NewTransactionEmbedding = typeof transactionEmbeddings.$inferInsert;
