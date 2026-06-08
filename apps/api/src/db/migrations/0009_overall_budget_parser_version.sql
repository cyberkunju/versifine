-- ============================================================
-- 0009 — Overall (no-category) budgets + utterance-cache parser version
--
-- 1. budgets.overall_limit: a single cap across ALL spending for the period,
--    used when the user sets "monthly budget 30000" with no category. The
--    existing per-category `allocations` jsonb stays; a budget now carries
--    EITHER category allocations OR an overall limit (or both).
--
-- 2. utterance_memory.parser_version: stamps the deterministic-parser version
--    that produced each cached parse. Lookups ignore rows older than the
--    current version, so a parser improvement (new scale word, fraction,
--    year fix) auto-invalidates exactly the stale utterances and lets them
--    re-parse once — no full cache wipe, no stale numbers served to users.
-- ============================================================

ALTER TABLE "budgets" ADD COLUMN "overall_limit" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "utterance_memory" ADD COLUMN "parser_version" integer DEFAULT 0 NOT NULL;
