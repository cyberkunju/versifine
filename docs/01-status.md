# 01 · Project Status

> Updated 2026-05-28. Verified by typecheck (`tsc --noEmit` clean for `packages/shared`, `apps/api`), live boot of the API (`/health/ready` returns 200), and database round-trip.

## Headline

**Phase 0 → 9 are substantially complete. Phases 10–17 are the remaining work.** The previous audit (delivered to the user a few turns ago) was outdated; it described a much earlier state. This document is the corrected ground truth.

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Repository foundation | ✅ Done | Bun workspaces, biome, env validation, gitignore, README, db-init script, native Postgres 16 + pgvector 0.8.2. |
| 1 — DB schema + migrations | ✅ Done | 16 tables live, 3 migrations applied, all 4 extensions enabled, IVFFlat + GIN indexes verified. |
| 2 — API foundation + auth | ✅ Done | Hono + middleware + JWT (access+refresh rotation) + bcrypt + OTP + smoke test passes. |
| 3 — MiniLM ONNX + categorize | 🟡 Partial | Tier resolver, overrides, merchants DB, MiniLM loader all written. ONNX export not run yet. |
| 4 — AI services | ✅ Done | client, transcribe, vision, intent, parser+regex, translate, embed, advice, copilotTools. |
| 5 — Capture pipeline | ✅ Done | drafts, persist, wallet picker, query stubs; all four capture routes (text/voice/image/confirm). |
| 6 — Budgets/Goals/Ledger/Recurring/Forecast | ✅ Done | 5 service modules + 5 route files. Recurring detector, ARIMA(1,1,1), anomaly z-score, threshold alerts. |
| 7 — Reports + advice | ✅ Done | Summary service + report routes (JSON + CSV). Advice service uses gpt-4o-mini with rule fallback. |
| 8 — Copilot RAG + tool-calling | ✅ Done | Embed query → PgVector cosine → context build → streaming SSE → tool dispatch loop (4 rounds cap). |
| 9 — WebSocket | ✅ Done | Upgrade endpoint with subprotocol JWT auth, per-user fan-out, lazy bus subscription, reconnect-friendly. |
| 10 — wa-bot foundation | 🟡 Partial | config, types, AI services (transcribe/tts/indicSpeech/translate), utils all written. Missing: openwa client, internal server, message packs. |
| 11 — wa-bot conversation engine | ⛔ Not started | engine, state, flows, apiClient still to do. |
| 12 — Web foundation (SvelteKit) | 🟡 Partial | package.json, svelte.config, vite.config, tsconfig, app.html, app.css present. Missing: routes, lib, stores, components. |
| 13 — Omnibar + privacy mode | ⛔ Not started | Tokenizer assets in `apps/web/static/models/` ready; ONNX siblings missing. |
| 14 — Web pages | ⛔ Not started | Dashboard, transactions, budgets, goals, forecast, reports, settings. |
| 15 — Copilot UI | ⛔ Not started | Slide-in panel, message bubbles, quick-prompt chips, tool-result rendering. |
| 16 — PWA + offline | ⛔ Not started | Service worker, IndexedDB queue, manifest icons. |
| 17 — Polish + testing + demo | ⛔ Not started | Tests beyond `categorize.test.ts`, end-to-end Playwright, README/demo script polish. |

## File counts

```
apps/api/src/         111 .ts files (routes, services, schema, middleware, utils)
apps/wa-bot/src/        9 .ts files (config, types, ai/*, utils/*)
apps/web/src/           4 files (.ts/.css/.html/.d.ts) + svelte.config + vite.config
packages/shared/src/   13 .ts files (categories, currencies, languages, intents, events, schemas/*)
scripts/                1 .ts file (db-init)
.kiro/specs/finehance/  3 .md files (requirements, design, tasks)
```

Total Drizzle tables: **16** (users, spaces, space_members, refresh_tokens, phone_link_otps, wallets, transactions, transaction_embeddings, category_overrides, category_corrections, budgets, goals, ledger_entries, ledger_settlements, recurring_items, fx_rates).

Total Hono routes mounted: **14** (health, auth, capture, wallets, transactions, budgets, goals, ledger, recurring, forecast, reports, advice, copilot, ws).

Total smoke scripts: **9** (auth, transaction, budget, goal, ledger, recurring, forecast, reports, advice, copilot).

## What works right now end-to-end

You can run all of this on the laptop today:

1. Register a user via `POST /auth/register`
2. Log in, refresh, hit `/auth/me`
3. Create a wallet
4. Create a transaction (manual)
5. List, filter, paginate, soft-delete transactions
6. Import + export CSV
7. Create a budget, get progress, watch threshold alerts emit on `budget.warning` / `budget.exceeded`
8. Create goals, post progress, see projected completion
9. Lend / borrow ledger entries with settlements
10. Run recurring detection, get a forecast (`GET /forecast?days=30`)
11. Reports summary (JSON or CSV)
12. Advice (LLM-backed if `OPENAI_API_KEY` set, deterministic fallback otherwise)
13. Copilot chat (streaming SSE with tool-calling) — gated on `OPENAI_API_KEY`
14. WebSocket upgrade with bearer-subprotocol JWT auth — connect from a websocket client and listen
15. Capture text via `/capture/text` → intent classification → expense parser → wallet pick → persist → events fire

## What's outright missing (the remaining work)

1. **WhatsApp bot openwa client + handlers + media + sharedClient** — the conversation engine, state, flows, message packs, and supervisor.
2. **Web app**: every route under `apps/web/src/routes/`, every store, every component, every shadcn-svelte primitive, the omnibar, the copilot panel, the privacy-mode loader, the PWA service worker.
3. **MiniLM ONNX siblings** — the `.onnx` weight file under `apps/api/src/ml/model/onnx/` and `apps/web/static/models/onnx/`. The conversion script `convert-minilm-to-onnx.ts` exists but the artifact hasn't been generated and uploaded yet.
4. **Comprehensive test coverage** — only `apps/api/tests/categorize.test.ts` exists. The plan calls for parser, forecast, end-to-end Playwright, and bot-engine tests.
5. **Demo seed data** — `scripts/seed.ts` is a stub. The 90-day realistic Indian dataset (R19) needs to land before a judge clones the repo.

## Known issues right now

Detailed list with severity and one-line fixes lives in [13-issues.md](./13-issues.md). Highlights:

- **Test runner doesn't load `.env`** — `bun test` skips Bun's `--env-file` flag automatically. `tests/categorize.test.ts` fails on env validation. Fix: add a `bunfig.toml` with `[test] preload = ["./tests/setup.ts"]` that calls `dotenv.config({ path: '../../.env' })`, or run tests via the `bun test --env-file=../../.env` invocation from a `package.json` script.
- **`apps/web/static/models/onnx/` is empty** — privacy mode can't run client-side categorization until the ONNX is in place.
- **Most schema customTypes declare `data: number` but inserts pass strings** — typechecks pass currently because Drizzle's inferred insert type is permissive enough; long-term we should align by either changing the customType to `data: string` or adding `toDriver` so callers pass numbers.

## What the previous audit got wrong

For the record: the sub-agent I ran first incorrectly reported 37 typescript errors and accused several files of being missing. Re-running `tsc --noEmit` directly returns **0 errors** for both `packages/shared` and `apps/api`. The files the audit said were missing (`apps/api/src/services/categorize/index.ts`, `minilm.ts`, `merchants.ts`, `overrides.ts`; the entire `services/{forecast,goals,ledger,reports}/`; routes `goals/ledger/recurring/forecast/reports/copilot/advice/ws`; `apps/wa-bot` directory; `apps/web` directory) **all exist**.

Likely cause: the sub-agent had a stale view of the workspace from earlier in the session. Lesson: always corroborate with a live tool call (`tsc`, `psql \dt`, `curl /health`) before trusting an LLM-generated audit.

## Next decision point

Two viable paths from here:

1. **Finish wa-bot first** (Phases 10–11). Then web. Then polish. This delivers the WhatsApp killer feature earliest and lets us demo "voice note in Malayalam → transaction logged" without a web app.
2. **Finish web first** (Phases 12–17). Then wa-bot. This delivers the dashboard / copilot UI that judges will actually click during the demo.

The roadmap in [15-roadmap.md](./15-roadmap.md) recommends path 2 (web first) because the API end-to-end is already curl-able and the wow factor for a hackathon judge is more visual than audible.
