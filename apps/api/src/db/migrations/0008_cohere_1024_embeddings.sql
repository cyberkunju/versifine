-- ============================================================
-- 0008 — Switch embeddings to Cohere-embed-v3-multilingual (1024-dim)
--
-- From: OpenAI text-embedding-3-small (1536-dim)
-- To:   Azure AI Foundry Cohere-embed-v3-multilingual (1024-dim)
--
-- Both embedding tables are rebuildable caches (the copilot RAG retriever
-- and the parse "utterance memory" Tier-0 cache). Rather than backfill at
-- the old dimension, we truncate and let them re-populate at the new
-- dimension on the next write/lookup. pgvector cannot ALTER a column's
-- dimension while rows of the old size exist, and ivfflat indexes are
-- dimension-bound, so the order is: drop index -> truncate -> alter -> recreate.
-- ============================================================

DROP INDEX IF EXISTS "transaction_embeddings_vector_idx";
--> statement-breakpoint
TRUNCATE TABLE "transaction_embeddings";
--> statement-breakpoint
ALTER TABLE "transaction_embeddings" ALTER COLUMN "embedding" TYPE vector(1024);
--> statement-breakpoint
CREATE INDEX "transaction_embeddings_vector_idx"
  ON "transaction_embeddings"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
--> statement-breakpoint
DROP INDEX IF EXISTS "utterance_memory_embedding_idx";
--> statement-breakpoint
TRUNCATE TABLE "utterance_memory";
--> statement-breakpoint
ALTER TABLE "utterance_memory" ALTER COLUMN "embedding" TYPE vector(1024);
--> statement-breakpoint
CREATE INDEX "utterance_memory_embedding_idx"
  ON "utterance_memory"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
