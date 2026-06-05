-- ============================================================
-- 0006 — Adaptive Intelligence Engine (AIE)
-- Adds: utterance_memory, spending_dna, prompt_examples
-- Alters: learned_patterns (reinforcement + lifecycle columns)
-- ============================================================

-- Enable pgvector if not already enabled (idempotent).
CREATE EXTENSION IF NOT EXISTS vector;

--> statement-breakpoint
-- ────────────────────────────────────────────────────────────
-- utterance_memory
-- Semantic nearest-neighbour cache. One row per unique
-- (space, normalised-text) pair. Embedding column uses
-- the same 1536-dim vector type as transaction_embeddings.
-- ────────────────────────────────────────────────────────────
CREATE TABLE "utterance_memory" (
    "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "space_id"      uuid NOT NULL,
    "text"          text NOT NULL,
    "text_hash"     varchar(64) NOT NULL,
    "embedding"     vector(1536) NOT NULL,
    "parsed_result" jsonb NOT NULL,
    "confirm_count" integer NOT NULL DEFAULT 0,
    "reject_count"  integer NOT NULL DEFAULT 0,
    "last_accuracy" real,
    "created_at"    timestamp with time zone DEFAULT now() NOT NULL,
    "last_used_at"  timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "utterance_memory"
    ADD CONSTRAINT "utterance_memory_space_id_spaces_id_fk"
    FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id")
    ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "utterance_memory_space_hash_uidx"
    ON "utterance_memory" USING btree ("space_id", "text_hash");
--> statement-breakpoint
-- IVF-Flat cosine index (same tuning pattern as transaction_embeddings).
CREATE INDEX "utterance_memory_embedding_idx"
    ON "utterance_memory" USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
--> statement-breakpoint
CREATE INDEX "utterance_memory_space_idx"
    ON "utterance_memory" USING btree ("space_id");

--> statement-breakpoint
-- ────────────────────────────────────────────────────────────
-- spending_dna
-- Per-space behavioural profile (one row per space).
-- ────────────────────────────────────────────────────────────
CREATE TABLE "spending_dna" (
    "space_id"           uuid PRIMARY KEY NOT NULL,
    "preferred_wallets"  jsonb NOT NULL DEFAULT '[]',
    "top_categories"     jsonb NOT NULL DEFAULT '[]',
    "avg_amounts"        jsonb NOT NULL DEFAULT '{}',
    "common_merchants"   jsonb NOT NULL DEFAULT '[]',
    "transaction_count"  integer NOT NULL DEFAULT 0,
    "last_updated_at"    timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spending_dna"
    ADD CONSTRAINT "spending_dna_space_id_spaces_id_fk"
    FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id")
    ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint
-- ────────────────────────────────────────────────────────────
-- prompt_examples
-- Space-specific few-shot examples for dynamic LLM prompts.
-- ────────────────────────────────────────────────────────────
CREATE TABLE "prompt_examples" (
    "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "space_id"         uuid NOT NULL,
    "utterance"        text NOT NULL,
    "parsed_json"      jsonb NOT NULL,
    "difficulty_score" real NOT NULL DEFAULT 0.5,
    "use_count"        integer NOT NULL DEFAULT 0,
    "created_at"       timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_examples"
    ADD CONSTRAINT "prompt_examples_space_id_spaces_id_fk"
    FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id")
    ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_examples_space_utterance_uidx"
    ON "prompt_examples" USING btree ("space_id", "utterance");
--> statement-breakpoint
CREATE INDEX "prompt_examples_difficulty_idx"
    ON "prompt_examples" USING btree ("space_id", "difficulty_score" DESC);
--> statement-breakpoint
CREATE INDEX "prompt_examples_space_idx"
    ON "prompt_examples" USING btree ("space_id");

--> statement-breakpoint
-- ────────────────────────────────────────────────────────────
-- learned_patterns — alter: add reinforcement + lifecycle cols
-- ────────────────────────────────────────────────────────────
ALTER TABLE "learned_patterns"
    ADD COLUMN "confirm_count" integer NOT NULL DEFAULT 0,
    ADD COLUMN "reject_count"  integer NOT NULL DEFAULT 0,
    ADD COLUMN "last_accuracy" real,
    ADD COLUMN "status"        varchar(16) NOT NULL DEFAULT 'active',
    ADD COLUMN "promoted_at"   timestamp with time zone;
--> statement-breakpoint
-- Index to quickly fetch all active/gold patterns for a space.
CREATE INDEX "learned_patterns_status_idx"
    ON "learned_patterns" USING btree ("space_id", "status");
