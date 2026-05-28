# 13 · Issues, Mistakes, and Fixes

> A record of every issue found, every mistake I made along the way, and the resolution status. Severity scaled to whether the issue blocks development, blocks the demo, or is cosmetic.

## Severity ladder

- **🔴 Critical** — Blocks API boot or causes data corruption.
- **🟠 High** — Blocks a feature path or wastes developer time noticeably.
- **🟡 Medium** — Cosmetic-but-real; would surface in code review.
- **🟢 Low** — Future-cleanup item; not worth fixing now.

## Status legend

- ✅ **Fixed** — applied and verified.
- 🟡 **In flight** — work in progress.
- ⛔ **Open** — not yet fixed.
- 📝 **Logged** — accepted as a known limitation, not on the fix list.

---

## Real, currently-open issues

> Live ground truth as of 2026-05-29. Most of the original list is now resolved (see the Resolved section below). Only two items remain open, both non-blocking.

### 🟠 1. MiniLM ONNX model not exported

**Symptom**: Categorizer Tier 3 silently returns null on every call. The categorizer waterfall drops to Tier 4 (default `Other` confidence 0) for any merchant not in `data/merchants.json` or `category_overrides`.

**Cause**: The conversion script `apps/api/scripts/convert-minilm-to-onnx.ts` exists and has been run — it correctly fetches the tokenizer + config from the HuggingFace repo. The repo only ships SafeTensors though, and there's no robust pure-JS converter for SafeTensors → ONNX, so the ONNX siblings remain absent until someone runs the Python toolchain once.

**Fix**:
```bash
# requires Python 3.10+ and pip
pip install --upgrade "optimum[exporters,onnxruntime]" transformers
optimum-cli export onnx \
  --model CyberKunju/finehance-categorizer-minilm \
  apps/api/src/ml/model/onnx
# Then mirror into the web bundle:
bun run --cwd apps/api convert:minilm
```

The same `model.onnx` ends up in both `apps/api/src/ml/model/onnx/` and `apps/web/static/models/onnx/` (the conversion script copies them), enabling Privacy Mode in the browser too.

**Status**: ⛔ Open (artefact-only — the code is wired and tested; the categorizer degrades gracefully without it)

### 🟢 2. Numeric custom types declare `data: number` but inserts pass `.toFixed(2)` strings

**Symptom**: TypeScript currently lets the inserts through because Drizzle's inferred insert type is permissive. But strictly speaking the contract is mismatched: a `numeric(14,2)` column expects a number per the customType declaration, but every caller passes a string.

**Cause**: When I authored the customTypes I set `data: number, fromDriver: (v) => Number(v)` to make SELECT results land as numbers. I didn't add `toDriver`, so inserts go through as-is. postgres-js coerces strings on the way in, so it works at runtime.

**Fix**: Two options:
1. Change the customTypes to `data: string, driverData: string` and have callers pass strings explicitly. Cleaner.
2. Add `toDriver: (v) => v.toString()` to each customType and have callers pass numbers. More TS-pretty.

Option 1 is closer to the underlying SQL semantics; option 2 is closer to JS conventions.

**Status**: ⛔ Open (cosmetic / future cleanup)

---

## Resolved issues

### ✅ 7. `apps/wa-bot` typecheck error: cannot find type definition file for 'bun'

**Symptom (was)**: `bun run --cwd apps/wa-bot typecheck` failed with "TS2688: Cannot find type definition file for 'bun'".

**Resolution**: `tsconfig.base.json` now lists `"types": ["bun"]` — `@types/bun` provides the `bun` named entry, so every workspace inherits it correctly. `bun run typecheck` returns 0 errors across all four workspaces.

**Status**: ✅ Fixed

### ✅ 8. `services/capture/queryStubs.ts` referenced names that didn't exist on `query.ts`

**Symptom (was)**: The capture pipeline's query intent path tried to call `summarize` and `totalSpentByCategory`. Those exports were missing.

**Resolution**: `services/transactions/query.ts` now exports both `summarize` (range-window report data) and `totalSpentByCategory` (per-category total in a window). The dynamic-import wrapper in `queryStubs.ts` resolves them on first call and caches the result; on miss it returns the structured stub envelope.

**Status**: ✅ Fixed

### ✅ 9. `_study/` directory not gitignored on its own line

**Resolution**: `_study/` is now its own first line in `.gitignore` with an explanatory comment ("Reference material — kept locally for design decisions, never committed"). The folder stays out of every commit.

**Status**: ✅ Fixed

### ✅ 10. Copilot's `compute_total` tool defaulted to "this month" when `from`/`to` missing

**Symptom (was)**: The LLM could call `compute_total({"category":"Transportation"})` without dates, and the tool returned a this-month total — the LLM had no way to recover for "last week" queries.

**Resolution**: The tool spec in `apps/api/src/services/ai/copilotTools.ts` now declares `from` and `to` as required parameters (`required: ['from', 'to']`). The implementation also rejects an invalid date range with a structured `unavailable('compute_total', 'invalid date range')` envelope, so the LLM gets clean feedback when it forgets. The system prompt's context block hands the model "today" so it can compute relative ranges directly.

**Status**: ✅ Fixed

---

## Resolved issues (already fixed)

### ✅ Win: TypeScript errors phantom-reported by sub-agent

**Symptom**: A previous audit sub-agent reported 37 TypeScript errors and accused several files of being missing.

**Cause**: Sub-agent had a stale view of the workspace from earlier in the session.

**Resolution**: Re-running `tsc --noEmit` directly returns 0 errors. Files allegedly missing all exist. Lesson: corroborate any LLM audit with direct tool calls before trusting it.

**Status**: ✅ Resolved (no actual code change needed)

### ✅ pgvector Windows install

**Symptom**: pgvector is required but not bundled with the EnterpriseDB Postgres installer.

**Resolution**: Downloaded `vector.v0.8.2-pg16.zip` from `andreiramani/pgvector_pgsql_windows`, ran an elevated PowerShell script to copy DLLs/SQL files into Postgres install dirs.

**Status**: ✅ Done

### ✅ `users.active_space_id` cyclic FK

**Symptom**: Drizzle can't generate a cyclic FK between `users` and `spaces` in the initial CREATE TABLE pass.

**Resolution**: Migration `0001_add_cyclic_fk_and_index_tuning.sql` adds the FK after both tables exist:
```sql
ALTER TABLE "users" ADD CONSTRAINT "users_active_space_id_fk" 
  FOREIGN KEY ("active_space_id") REFERENCES "spaces"("id") ON DELETE SET NULL;
```

**Status**: ✅ Done

### ✅ IVFFlat index tuning

**Symptom**: Drizzle's index DSL can't pass `WITH (lists = N)` to IVFFlat.

**Resolution**: Same migration `0001` drops and recreates the vector index with the tuned parameter.

**Status**: ✅ Done

### ✅ Unique index on category_overrides

**Symptom**: Override upsert needs `INSERT ... ON CONFLICT (space_id, merchant_normalized) DO UPDATE`. Drizzle didn't generate the unique index initially.

**Resolution**: Migration `0002_unique_category_overrides_index.sql` adds the unique index.

**Status**: ✅ Done

### ✅ env validation rejects empty OPENAI_API_KEY

**Symptom**: When `.env` had `OPENAI_API_KEY=` (empty), the Zod schema's `.string().min(10).optional()` failed because `.optional()` only accepts `undefined`, not empty string.

**Resolution**: Replaced with `.transform((v) => (v && v.length > 0 ? v : undefined)).pipe(z.string().min(10).optional()).optional()`.

**Status**: ✅ Done

### ✅ `bun --env-file=...` script flag

**Symptom**: API process couldn't see `.env` because the workspace script ran `bun run scripts/migrate.ts` without telling Bun where the env file is.

**Resolution**: Updated all `apps/api/package.json` scripts to use `bun --env-file=../../.env run scripts/migrate.ts`. Now boots cleanly.

**Status**: ✅ Done

### ✅ Svelte 5 runes mode broke pre-compiled vendor components

**Symptom**: `bun x vite build` failed inside `apps/web` with `Cannot use $$props in runes mode` pointing to `lucide-svelte/dist/Icon.svelte`. Lucide ships its components pre-compiled with the legacy `$$props` API; Svelte 5 won't run them when the rest of the app is in runes mode.

**Cause**: `svelte.config.js` had `compilerOptions.runes = true`, which forces every `.svelte` file (including vendored ones) into runes mode regardless of how they were written.

**Resolution**: Removed the global override. Svelte 5's default is auto-detection per file — any file with `$state`/`$derived`/`$props` flips itself into runes mode while pre-compiled vendor components keep using `$$props`. Build and `svelte-check` both clean.

**Status**: ✅ Fixed

### ✅ `extractDate` matched "yesterday" inside "day before yesterday"

**Symptom**: `extractDate('day before yesterday i paid 800', frozenNow)` returned `frozenNow - 1 day` instead of `frozenNow - 2 days`. Caught by the new `tests/parser-regex.test.ts` suite.

**Cause**: The bare `\byesterday\b` regex matched inside the longer phrase before the "day before yesterday" branch was checked.

**Resolution**: Reordered the branches in `extractDate` so the longer phrase is tested first, with a clarifying comment so a future reader doesn't reorder them back. All 32 parser-regex tests green.

**Status**: ✅ Fixed

### ✅ Service worker registered but the source file didn't exist

**Symptom (was)**: The web layout called `navigator.serviceWorker.register('/service-worker.js', { scope: '/' })`, but no `service-worker.ts` existed under `apps/web/src/`. The registration silently failed in production.

**Resolution**: Authored `apps/web/src/service-worker.ts` with three caching strategies — cache-first for the precache + static models, stale-while-revalidate for everything else. The layout now lets SvelteKit auto-register the worker (it picks up `src/service-worker.ts` when present) and adds a message-channel listener so a `SYNC_PENDING_CAPTURES` ping from the page triggers a `DRAIN_QUEUE` broadcast back to drain the offline omnibar queue.

**Status**: ✅ Fixed

---

## Mistakes I made along the way

### 📝 Spawned a sub-agent that gave a stale audit

I asked a context-gatherer to do a full audit. It returned with a comprehensive but **outdated** view — listing 37 TS errors and missing files that all actually exist. I should have verified the claims with a direct `tsc --noEmit` before formatting them as the truth.

**Lesson**: After any LLM audit, run the tools the audit's claims rest on. Treat the report as a starting hypothesis, not a final answer.

### 📝 Started writing schema before checking existing code

When I started Phase 1, I didn't grep for existing files in `apps/api`. The earlier session in this same workspace had already written ~50 files. Result: I wrote schema modules from scratch and several conflicts ("alertThresholds" vs "warnThreshold", `Db` vs `Database` type) appeared until the stale work was reconciled.

**Lesson**: Always run a `list_directory` deep on the target before generating files. Take 30 seconds upfront to know what already exists.

### 📝 Didn't update `tasks.md` as work landed

The `tasks.md` checkboxes still show Phases 3–9 as unchecked even though most of the work for those phases is done. The status documentation drifted from reality.

**Lesson**: Treat `tasks.md` as a real status board, not a write-once plan. Updating after each phase keeps everyone (including future me) honest.

### 📝 Two duplicate `categoryOverrides` table definitions

Briefly during early Phase 1, both `schema/transactions.ts` and `schema/overrides.ts` defined the same Drizzle table. The duplicate was caught and `transactions.ts` was trimmed, but the audit transcript still reflects that brief drift.

**Lesson**: Schema files should never `export *` the same table from two places. Add a quick `bun run check` step that scans for duplicate exports — biome's import linter catches it.

### 📝 Initially said "no Docker" then almost wrote a `docker-compose.yml`

The user explicitly said no Docker; I almost added a compose file before catching myself. Easy to slip into defaults.

**Lesson**: Re-read the user's constraints at the start of each phase. They don't change just because the task changed.

---

## Things I forgot / didn't do that I should have

- **Update `tasks.md` after each phase landed**. Already noted.
- **Run a real `tsc --noEmit` before claiming Phase X is done**. The earlier audits reflected this.
- **Smoke-test the WS upgrade end-to-end** with `wscat` before declaring Phase 9 done. The endpoint boots; whether real WS frames flow correctly is unverified beyond unit tests.
- **Build the seed dataset alongside Phase 1** instead of deferring to "task 11". A demo without seed data is half a demo.
- **Add a CI workflow** (.github/workflows/ci.yml) that runs typecheck, lint, and tests on every push. Trivial in time, big in confidence.
- **Document the `_study/` rule** more loudly in the README so future contributors don't accidentally commit it.

---

## Diagnostic table — when something breaks

| Symptom | First check | Likely cause |
| --- | --- | --- |
| `bun run --cwd apps/api dev` fails with env validation | `cat .env` | A required key is missing or `JWT_*_SECRET` shorter than 16 chars. |
| `bun run --cwd apps/api db:migrate` fails with "relation X already exists" | psql `\dt` | Tables exist from a prior partial migration. Run `bun run db:init` to wipe. |
| 401 on every request | JWT TTL | `JWT_ACCESS_TTL_SECONDS` too short, or token expired. |
| Capture intent always returns `unknown` | `OPENAI_API_KEY` set? | Without a key, the parser returns regex-only output and the intent classifier returns `unknown`. |
| Categorize always returns `Other` | `apps/api/src/ml/model/onnx/model.onnx` | Run the ONNX export script. |
| Forecast endpoint returns method=`rolling_average` | Insufficient variable history | Need 14+ non-zero days. Build the seed dataset. |
| WS upgrade returns 401 | Subprotocol header | Browser sends `bearer.<jwt>`; verify token isn't expired. |
| Bot fails to pair (no QR) | whatsapp-web.js logs | Likely a Chromium executable issue; install Chrome and set `PUPPETEER_EXECUTABLE_PATH`. |
| Migration error "permission denied for schema public" | role grants | `bun run db:init` re-grants on schema public. |
| `Bun.password.hash` throws | bcrypt cost | Cost 12 is the default; lower if running on very weak hardware. |
