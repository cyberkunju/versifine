-- Cyclic FK: users.active_space_id -> spaces.id
-- Drizzle cannot emit this in the initial CREATE TABLE pass because the
-- creation order would otherwise be ambiguous. We add it once both tables
-- exist.
ALTER TABLE "users"
  ADD CONSTRAINT "users_active_space_id_fk"
  FOREIGN KEY ("active_space_id") REFERENCES "spaces"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- IVFFlat tuning. Drizzle's index DSL can't yet pass `WITH (lists = N)`,
-- so we drop and recreate with the tuned parameter.
DROP INDEX IF EXISTS "transaction_embeddings_vector_idx";
--> statement-breakpoint
CREATE INDEX "transaction_embeddings_vector_idx"
  ON "transaction_embeddings"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
