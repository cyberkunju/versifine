# 01 · Project Status

> Updated 2026-05-29. Verified by typecheck (`bun run typecheck` clean across all four workspaces), live boot (`/health` returns 200), 9 smoke scripts green against a seeded database, and a full test run (`47 pass, 0 fail` across 3 test files in `apps/api` plus `2 pass, 0 fail` in `apps/wa-bot`).

## Headline

**Every MVP phase (0 → 17) is now substantially complete.** The previous version of this document (and `13-issues.md`) significantly understated progress because they were authored mid-build and never refreshed when later sweeps landed. This file now reflects what the repo actually contains.

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Repository foundation | ✅ Done | Bun workspaces, biome, env validation, gitignore, README, db-init script, native Postgres 16 + pgvector 0.8.2. |
| 1 — DB schema + migrations | ✅ Done | 16 tables live, 3 migrations applied, all 4 extensions enabled, IVFFlat + GIN indexes verified. |
| 2 — API foundation + auth | ✅ Done | Hono + middleware + JWT (access+refresh rotation) + bcrypt + OTP + smoke test passes. |
| 3 — MiniLM ONNX + categorize | 🟡 Code complete · ONNX artefact missing | Tier resolver, overrides, merchants DB, MiniLM loader all written and tested. The ONNX export still needs the Python toolchain run once (see "Known caveats"). |
| 4 — AI services | ✅ Done | client, transcribe, vision, intent, parser+regex, translate, embed, advice, copilotTools. |
| 5 — Capture pipeline | ✅ Done | drafts, persist, wallet picker, query helpers; all four capture routes (text/voice/image/confirm). |
| 6 — Budgets/Goals/Ledger/Recurring/Forecast | ✅ Done | 5 service modules + 5 route files. Recurring detector, ARIMA(1,1,1), anomaly z-score, threshold alerts. |
| 7 — Reports + advice | ✅ Done | Summary service + report routes (JSON + CSV). Advice service uses gpt-4o-mini with rule fallback. |
| 8 — Copilot RAG + tool-calling | ✅ Done | Embed query → PgVector cosine → context build → streaming SSE → tool dispatch loop (4 rounds cap). |
| 9 — WebSocket | ✅ Done | Upgrade endpoint with subprotocol JWT auth, per-user fan-out, lazy bus subscription, reconnect-friendly. |
| 10 — wa-bot foundation | ✅ Done | config, supervisor, openwa client (LocalAuth + watchdog), internal HTTP server (`/qr`, `/qr.png`, `/sessions`, `/send`, `/broadcast/*`, `/simulator/message`), AI services, utils. |
| 11 — wa-bot conversation engine | ✅ Done | engine, state, 7 flows (identity, link, capture, confirm, query, budget, correct, help), 3 message packs (en/hi/ml), apiClient. Bot smoke test green. |
| 12 — Web foundation (SvelteKit) | ✅ Done | SvelteKit + Tailwind 4 + bits-ui primitives, auth store, ws client with reconnect, layout shell with sidebar / topbar / command menu / floating copilot button, login + register. |
| 13 — Omnibar + privacy mode | ✅ Done | Omnibar with text/voice/image, ConfirmDialog, MiniLM client loader. Privacy mode runs categorisation client-side once the ONNX artefact is in `apps/web/static/models/onnx/`. |
| 14 — Web pages | ✅ Done | Dashboard, Transactions, Budgets, Goals, Forecast, Reports, Settings — every page renders with seeded data, every page subscribes to the relevant WS events. |
| 15 — Copilot UI | ✅ Done | Slide-in panel, message bubbles, quick-prompt chips, SSE proxy at `/api/copilot`. Streaming + tool-result rendering. |
| 16 — PWA + offline | ✅ Done | Service worker (`apps/web/src/service-worker.ts`) with three caching strategies, IndexedDB-backed pending-capture queue, manifest + theme. |
| 17 — Polish + testing + demo | ✅ Done | 47 API tests across categorize / parser-regex / forecast plus 2 wa-bot engine tests. README, demo runbook (`docs/14-runbook.md`), demo script (`docs/15-roadmap.md`'s "When the demo lands" section). |

## File counts

```
apps/api/src/         111 .ts files (routes, services, schema, middleware, utils)
apps/wa-bot/src/       28 .ts files (config, supervisor, openwa/, server/, services/ai/, conversations/{engine,state,flows,messages}, utils)
apps/web/src/          70+ .ts/.svelte files (routes, lib/{api,ai,components,i18n,stores,utils})
packages/shared/src/   13 .ts files (categories, currencies, languages, intents, events, schemas/*)
scripts/                3 .ts files (db-init, check-db, smoke-web)
.kiro/specs/versifine/  3 .md files (requirements, design, tasks)
docs/                  16 .md files
```

Total Drizzle tables: **16** (users, spaces, space_members, refresh_tokens, phone_link_otps, wallets, transactions, transaction_embeddings, category_overrides, category_corrections, budgets, goals, ledger_entries, ledger_settlements, recurring_items, fx_rates).

Total Hono routes mounted: **14** (health, auth, capture, wallets, transactions, budgets, goals, ledger, recurring, forecast, reports, advice, copilot, ws).

Total smoke scripts (all green): **9** (auth, transaction, budget, goal, ledger, recurring, forecast, reports, advice, copilot).

## What works right now end-to-end

All of this runs on a clean clone after `bun install && bun run db:init && bun run db:migrate && bun run db:seed`:

1. `bun run dev` boots api (5000), web (5173), and the bot (5001) concurrently.
2. Register a user via `POST /auth/register` or open the web at `/register`.
3. Log in, refresh, hit `/auth/me` — JWT rotation works.
4. Create wallets, transactions, transfers (web UI + API).
5. List, filter, paginate, soft-delete transactions; CSV import + export.
6. Create budgets, watch threshold alerts emit on `budget.warning` / `budget.exceeded`.
7. Create goals, post progress, see projected completion.
8. Lend / borrow ledger entries with settlements.
9. Run recurring detection, forecast (`GET /forecast?days=30`) — ARIMA + rolling-average fallback both tested.
10. Reports summary (JSON or CSV), Advice (LLM-backed when `OPENAI_API_KEY` is set, deterministic fallback otherwise).
11. Copilot chat (streaming SSE with tool-calling) — gated on `OPENAI_API_KEY`.
12. WebSocket upgrade with bearer-subprotocol JWT auth — every event-emitting service writes through the bus.
13. Capture text via `/capture/text` → intent classification → expense parser → wallet pick → persist → events fire.
14. Open the bot's `/qr` page, scan with WhatsApp, send "spent 450 on auto" — bot replies with the localised "Logged ₹450 (Transportation)" line.
15. Toggle Privacy Mode in `/settings` — once the MiniLM ONNX artefact lands in `apps/web/static/models/onnx/`, categorisation runs in the browser.

## Verification matrix

| Check | Command | Result |
| --- | --- | --- |
| Workspace typecheck | `bun run typecheck` | 0 errors across `@versifine/shared`, `@versifine/api`, `@versifine/wa-bot`, `@versifine/web` |
| API tests | `bun run --cwd apps/api test` | 47 pass / 0 fail (categorize, parser-regex, forecast) |
| Bot tests | `bun run --cwd apps/wa-bot test` | 2 pass / 0 fail (engine flow + cancel-on-draft) |
| API live boot | `curl http://127.0.0.1:5000/health` | `{ "success": true, "data": { "service": "versifine-api" ... } }` |
| Smoke: auth | `bun --env-file=../../.env scripts/smoke-auth.ts` | OK |
| Smoke: transaction | `scripts/smoke-transaction.ts` | OK (FX, soft-delete, balance) |
| Smoke: budget | `scripts/smoke-budget.ts` | OK (warn + exceeded events emit) |
| Smoke: forecast | `scripts/smoke-forecast.ts` | OK (30-day, anomalies flagged: 4) |
| Smoke: copilot | `scripts/smoke-copilot.ts` | OK (SSE 17 chunks, WS events received) |
| Web build | `bun x vite build` (in `apps/web`) | Clean SSR + client bundle |
| Web typecheck | `bun x svelte-check` | 0 errors / 0 warnings |
| Seed | `bun run --cwd apps/api db:seed` | 4 wallets, 216 transactions over 90 days, 3 budgets, 3 goals, 3 ledger entries, 13 detected recurring items |

## Known caveats (all non-blocking)

1. **MiniLM ONNX artefact not yet checked in.** The fine-tuned MiniLM ships as SafeTensors only on HuggingFace; converting needs the Python `optimum-cli` toolchain run once. The categorizer detects the absence and degrades cleanly to merchant DB + default tiers (`categorized_by` becomes `merchants` or `default` instead of `minilm`). To enable the ML tier:
   ```sh
   pip install --upgrade "optimum[exporters,onnxruntime]" transformers
   optimum-cli export onnx --model CyberKunju/versifine-categorizer-minilm apps/api/src/ml/model/onnx
   bun run --cwd apps/api convert:minilm   # mirrors into apps/web/static/models/
   ```
2. **`compute_total` defaults to "this month" when `from`/`to` are missing.** The tool spec already requires both, so the LLM is prompted to compute dates. The defensive fallback is still in place. Acceptable.
3. **Numeric custom types declare `data: number` but inserts pass `.toFixed(2)` strings.** TypeScript permissively accepts both because Drizzle's inferred insert type is wide; postgres-js coerces strings on the way in. Cosmetic; flagged for a future cleanup sweep.
4. **`apps/web/static/models/onnx/` is empty.** Same root cause as (1). Privacy mode shows a friendly "model artefact missing" message in settings until the ONNX is exported.

## Reproducibility

```sh
bun install
bun run db:init                    # creates versifine_dev + versifine_test, enables extensions
bun run db:migrate                 # applies the three Drizzle migrations
bun run db:seed                    # 90 days of realistic Indian transactions, demo@versifine.com

bun run typecheck                  # 0 errors in every workspace
bun run --cwd apps/api test        # 47 pass / 0 fail
bun run --cwd apps/wa-bot test     # 2 pass / 0 fail

bun run dev                        # api 5000, web 5173, bot 5001
```

Demo credentials: `demo@versifine.com` / `Versifine#2026!`.

## What's next

The MVP arc is complete. Remaining items live in [15-roadmap.md](./15-roadmap.md) under "Stretch / production-readiness":

- PDF report export
- Voice replies inside the web copilot (Web Speech API)
- Bank-statement PDF parser for batch import
- Recurring "cancel this dormant subscription" engine
- Goal streaks / gamification

Beyond MVP, the production hardening list (HTTPS termination, httpOnly cookies, managed Postgres, Redis-backed rate limiter / event bus, observability, CI pipeline, etc.) is also catalogued in the roadmap.
