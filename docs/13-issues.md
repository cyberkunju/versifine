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

### 🟠 1. `bun test` does not auto-load the root `.env`

**Symptom**: `cmd /c "bun test --cwd apps/api"` fails with `DATABASE_URL: Required`. Tests crash before any test body runs.

**Cause**: Bun's test runner ignores the `--env-file` flag in the package script (`"test": "bun test"`). It loads `.env` only from the cwd, and the workspace cwd is `apps/api`, not the repo root.

**Fix**: One of:
1. Update `apps/api/package.json` to `"test": "bun --env-file=../../.env test"` — but Bun ignores `--env-file` for the `test` subcommand.
2. Symlink `apps/api/.env` → `../../.env`.
3. Add `apps/api/bunfig.toml` with `[test] preload = ["./tests/setup.ts"]` and have `setup.ts` call `import { config } from 'dotenv'; config({ path: '../../.env' });`.

The cleanest is option 3. Action: create `apps/api/tests/setup.ts` and `apps/api/bunfig.toml`.

**Status**: ⛔ Open

### 🟠 2. MiniLM ONNX model not exported

**Symptom**: Categorizer Tier 3 silently returns null on every call. The categorizer waterfall drops to Tier 4 (default `Other` confidence 0) for any merchant not in `data/merchants.json` or `category_overrides`.

**Cause**: The conversion script `apps/api/scripts/convert-minilm-to-onnx.ts` exists but hasn't been run. Running it requires Python + `optimum-cli`.

**Fix**: 
```bash
# requires Python 3.10+ and pip
pip install optimum[exporters,onnxruntime] transformers
optimum-cli export onnx \
  --model CyberKunju/finehance-categorizer-minilm \
  --task text-classification \
  apps/api/src/ml/model/onnx
```
Then `bun run --cwd apps/api convert:minilm` to verify the inference works end-to-end and update the manifest. The same `model.onnx` file should be copied to `apps/web/static/models/onnx/` for privacy mode.

**Status**: ⛔ Open

### 🟡 3. WhatsApp bot — conversation engine not yet written

**Symptom**: `apps/wa-bot` has all the AI services and utilities but no `index.ts`, `supervisor.ts`, openwa client, or message packs. `bun run --cwd apps/wa-bot dev` fails because there's no entry file.

**Cause**: This is just remaining work — Phases 10–11 of the implementation plan.

**Fix**: Phases 10–11 of the roadmap. ~28 hours of focused work as estimated in [11-bot.md](./11-bot.md).

**Status**: ⛔ Open (remaining work)

### 🟡 4. Web app — only foundation files

**Symptom**: `apps/web` has package.json, configs, and a basic app shell but no routes, stores, components. `bun run --cwd apps/web dev` boots Vite but renders an empty page.

**Cause**: Phase 12–17 not started.

**Fix**: Phases 12–17 of the roadmap. ~62 hours of focused work as estimated in [12-web.md](./12-web.md).

**Status**: ⛔ Open (remaining work)

### 🟡 5. Demo seed is a stub

**Symptom**: `bun run --cwd apps/api db:seed` prints "stub: real seed lands with task 11" and exits cleanly.

**Cause**: Task 11 in the spec was deferred. The 90-day realistic Indian dataset hasn't been implemented yet.

**Fix**: Build `apps/api/src/data/seed-fixtures.ts` with:
- 1 demo user (`demo@finehance.app` / `Finehance#2026!`)
- 4 wallets (HDFC, Cash, GPay UPI, ICICI Credit Card)
- 90 days of expense + income transactions covering subscriptions, salary, UPI to common merchants, FX scenarios, split bills, anomalies
- 3 budgets, 2 goals, 3 ledger entries, ~5 detected recurring items

**Status**: ⛔ Open

### 🟡 6. Numeric custom types declare `data: number` but inserts pass `.toFixed(2)` strings

**Symptom**: TypeScript currently lets the inserts through because Drizzle's inferred insert type is permissive. But strictly speaking the contract is mismatched: a `numeric(14,2)` column expects a number per the customType declaration, but every caller passes a string.

**Cause**: When I authored the customTypes I set `data: number, fromDriver: (v) => Number(v)` to make SELECT results land as numbers. I didn't add `toDriver`, so inserts go through as-is. postgres-js coerces strings on the way in, so it works at runtime.

**Fix**: Two options:
1. Change the customTypes to `data: string, driverData: string` and have callers pass strings explicitly. Cleaner.
2. Add `toDriver: (v) => v.toString()` to each customType and have callers pass numbers. More TS-pretty.

Option 1 is closer to the underlying SQL semantics; option 2 is closer to JS conventions. I'd pick option 1 but it's not blocking.

**Status**: ⛔ Open (cosmetic / future cleanup)

### 🟡 7. `apps/wa-bot` typecheck error: cannot find type definition file for 'bun'

**Symptom**: `bun run --cwd apps/wa-bot typecheck` fails with "TS2688: Cannot find type definition file for 'bun'".

**Cause**: The wa-bot tsconfig extends `tsconfig.base.json` which has `types: ['bun-types']`. The wa-bot's local node_modules doesn't have `bun-types` because the package only uses `@types/bun`.

**Fix**: One of:
1. Add `bun-types` to wa-bot devDependencies.
2. Override types in wa-bot's tsconfig: `"types": ["@types/bun"]`.

Option 2 is cleaner since `@types/bun` is already a devDep.

**Status**: ⛔ Open (small fix)

### 🟡 8. `services/capture/queryStubs.ts` uses dynamic imports with stale function names

**Symptom**: The capture pipeline's query intent path tries to call `summarize` and `totalSpentByCategory` from `services/transactions/query.ts`. Those exports don't exist in the current query.ts (the file exports `listTransactions`, `getTransactionById`, `serializeTransaction`).

**Cause**: When the modules were rebuilt, the consumer's import names weren't updated. Because they're dynamic imports wrapped in try/catch, the failure is silent — query intents return "service not ready" stub messages instead of real data.

**Fix**: Either add `summarize` and `totalSpentByCategory` to `query.ts` (preferred — the names match the dispatcher tools in `copilotTools.ts`), or rewrite `queryStubs.ts` to use the existing `listTransactions` plus aggregation in JS.

**Status**: ⛔ Open

### 🟢 9. `_study/` directory not gitignored on its own line in `.gitignore`

**Symptom**: `.gitignore` has `_study/` in the list but it's mixed with comment formatting. Easy to read on a closer look but worth a tidy.

**Cause**: I wrote it that way originally; cosmetic.

**Fix**: Reorder for clarity. Trivial.

**Status**: ⛔ Open (cosmetic)

### 🟢 10. Copilot's `compute_total` tool defaults to "this month" when `from`/`to` missing — should match user request

**Symptom**: When the user asks "how much did I spend on transport last week", the LLM may (correctly) call `compute_total({"category":"Transportation"})` without dates, and our tool returns this-month total. The LLM has no way to recover.

**Cause**: The default range is set inside the tool, not handed to the LLM as a parameter.

**Fix**: Make the tool require `from` and `to` (no defaults). The LLM has to compute them from "today" in the system prompt's context block. This forces the model to reason about dates explicitly and removes a class of subtle bugs.

**Status**: ⛔ Open (correctness improvement)

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
