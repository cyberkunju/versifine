# Implementation Plan: Finehance

## Overview

This implementation plan breaks the Finehance MVP into 79 small, testable tasks across 17 phases plus a stretch list. Each task references the requirements (R) it satisfies. The plan is ordered top-to-bottom for the cleanest dependency order: foundation first, then schema, then API by layer, then bot port, then web, then polish.

## Notes

- Build top-to-bottom unless a task explicitly says otherwise.
- Do not start a phase until the prior phase's foundational tasks are green (typecheck, schema migrations, smoke tests).
- Every file in `apps/`, `packages/`, and the root is written from scratch. No code is copied verbatim from any external source. Patterns and design decisions referenced in the design document are recreated with original implementations and project-native naming.
- Each task is sized to fit in a single focused work session. If a task balloons, split it before continuing.

## Task Dependency Graph

Phases form a directed acyclic graph. The strict dependency edges are:

- Phase 0 (Foundation) → Phase 1 (Schema) → Phase 2 (API foundation, auth) → Phase 3 (MiniLM ONNX + categorize) → Phase 4 (AI services) → Phase 5 (Capture pipeline) → Phase 6 (Budgets, goals, ledger, recurring, forecast) → Phase 7 (Reports, advice) → Phase 8 (Copilot RAG) → Phase 9 (WebSocket).
- Phase 10 (Bot foundation) depends on Phase 5 (capture API exists).
- Phase 11 (Bot conversation engine) depends on Phase 10 plus Phases 6-8 for the flows it dispatches into.
- Phase 12 (Web foundation) depends on Phase 2 (auth) and Phase 9 (WebSocket).
- Phase 13 (Omnibar + Privacy Mode) depends on Phase 12 and Phase 3 (MiniLM).
- Phase 14 (Web pages) depends on Phase 13.
- Phase 15 (Copilot UI) depends on Phase 14 and Phase 8 (Copilot API).
- Phase 16 (PWA + offline) depends on Phase 14.
- Phase 17 (Polish, tests, demo) depends on Phases 11, 14, 15, 16.
- Stretch (Phase 18+) only after Phase 17 is green.

Execution waves group tasks that can run in parallel once their prior wave is green:

```json
{
  "waves": [
    { "wave": 1, "tasks": [1, 2, 3, 4, 5, 6] },
    { "wave": 2, "tasks": [7, 8, 9, 10, 11] },
    { "wave": 3, "tasks": [12, 13, 14, 15, 16, 17] },
    { "wave": 4, "tasks": [18, 19, 20] },
    { "wave": 5, "tasks": [21, 22, 23, 24, 25] },
    { "wave": 6, "tasks": [26, 27, 28, 29] },
    { "wave": 7, "tasks": [30, 31, 32, 33, 34] },
    { "wave": 8, "tasks": [35, 36] },
    { "wave": 9, "tasks": [37, 38] },
    { "wave": 10, "tasks": [39, 40] },
    { "wave": 11, "tasks": [41, 42, 43, 44, 45] },
    { "wave": 12, "tasks": [46, 47, 48, 49, 50, 51, 52, 53] },
    { "wave": 13, "tasks": [54, 55, 56, 57, 58] },
    { "wave": 14, "tasks": [59, 60] },
    { "wave": 15, "tasks": [61, 62, 63, 64, 65, 66, 67] },
    { "wave": 16, "tasks": [68, 69] },
    { "wave": 17, "tasks": [70, 71] },
    { "wave": 18, "tasks": [72, 73, 74, 75, 76, 77, 78, 79] }
  ]
}
```

Visual representation:

```
Phase 0 ─→ 1 ─→ 2 ─→ 3 ─→ 4 ─→ 5 ─→ 6 ─→ 7 ─→ 8 ─→ 9
                                  │              │
                                  ├──────────────┴────────→ 10 ─→ 11
                                                              │
                                  └──→ 12 ─→ 13 ─→ 14 ─→ 15  │
                                              ↑       │       │
                                              3       └→ 16   │
                                                       │      │
                                                       └─→ 17 ←┘
                                                            │
                                                          Stretch
```

## Tasks

### Phase 0 — Repository foundation

- [x] 1. Initialize Bun monorepo
  - Create root `package.json` with workspaces: `apps/*`, `packages/*`
  - Add `bun` as packageManager, set `"type": "module"`, add `"engines": { "bun": ">=1.1.0" }`
  - Create root `.gitignore` (node_modules, .env, .wwebjs_auth, dist, ml/model, .DS_Store, *.local)
  - Create root `README.md` with the 60-second setup recipe (placeholder, fleshed out at end)
  - Create `biome.json` with import sort + format + lint rules
  - Add root `bun run dev` script that starts web + api + bot concurrently
  - _Requirements: R19_

- [x] 2. Set up shared package (`packages/shared`)
  - Create `package.json`, `tsconfig.json` (target ES2022, module ESNext, strict)
  - Create folder skeleton: `src/{schemas,events,ai}/`
  - _Requirements: R1, R2, R4_

- [x] 3. Author shared enums and constants
  - `packages/shared/src/categories.ts` — 23 categories, display name, icon, color (matches MiniLM output classes)
  - `packages/shared/src/currencies.ts` — supported currencies + symbols
  - `packages/shared/src/languages.ts` — 6 languages with display + native names
  - `packages/shared/src/intents.ts` — intent enum + helpers
  - `packages/shared/src/index.ts` re-exports
  - _Requirements: R7, R14, R8_

- [x] 4. Author shared Zod schemas
  - `schemas/auth.ts` — register, login, refresh, phone-link
  - `schemas/transaction.ts` — create, update, query filters
  - `schemas/wallet.ts`, `schemas/budget.ts`, `schemas/goal.ts`, `schemas/ledger.ts`, `schemas/copilot.ts`
  - All schemas exported as types AND parsers
  - _Requirements: R1, R3, R4, R9, R11, R13_

- [x] 5. Author shared event types
  - `events.ts` — discriminated union of all WS event payloads (`transaction.created`, etc.) with `seq`, `entity_id`
  - _Requirements: R15_

- [x] 6. Set up Postgres locally (no Docker)
  - Native install of PostgreSQL 16 + pgvector 0.8.2
  - `scripts/db-init.ts` (run via `bun run db:init`) creates `finehance_dev` and `finehance_test`, role `finehance`, and enables `pgcrypto`, `pg_trgm`, `citext`, `vector`
  - _Requirements: R2, R11_

## Phase 1 — Database schema and migrations

- [x] 7. Initialize Drizzle in `apps/api`
  - Install `drizzle-orm`, `drizzle-kit`, `postgres` (postgres-js driver)
  - Create `apps/api/src/db/client.ts` exporting a typed Drizzle instance
  - Configure `drizzle.config.ts` for migrations folder
  - _Requirements: R2_

- [x] 8. Define core identity tables (`schema/users.ts`, `schema/spaces.ts`)
  - Implement `users`, `spaces`, `space_members`, `phone_link_otps`, `refresh_tokens` tables exactly per design § 3
  - Generate initial migration `001_init`
  - _Requirements: R1, R2_

- [x] 9. Define wallet and transaction tables
  - `schema/wallets.ts`, `schema/transactions.ts` with all indexes
  - `schema/embeddings.ts` (PgVector column, ivfflat index)
  - `schema/overrides.ts` (category_overrides, category_corrections)
  - Generate migration `002_wallets_transactions`
  - _Requirements: R3, R4, R7_

- [x] 10. Define budgets, goals, ledger, recurring, fx tables
  - `schema/budgets.ts`, `schema/goals.ts`, `schema/ledger.ts`, `schema/recurring.ts`, `schema/fx.ts`
  - Generate migration `003_budgets_goals_ledger`
  - _Requirements: R9, R10, R13, R4_

- [ ] 11. Build seed data (deferred to Phase 7)
  - `apps/api/src/db/seed.ts` and `data/seed-fixtures.ts` with 90 days of realistic INR transactions (Phase R19 spec)
  - Include subscriptions, salary, UPI merchants, FX scenarios, split bill, anomalies
  - `bun run --cwd apps/api db:seed` runs cleanly twice (idempotent)
  - `bun run --cwd apps/api reset:demo` truncates + reseeds
  - _Requirements: R19_

## Phase 2 — API foundation (Hono + middleware + auth)

- [x] 12. Bootstrap Hono app
  - `apps/api/src/index.ts` — create Hono app, mount `/health`, listen with `Bun.serve`
  - `apps/api/src/env.ts` — Zod-validated env (DATABASE_URL, JWT_SECRET, OPENAI_API_KEY, BOT_SECRET, PORT, NODE_ENV)
  - Add concise structured JSON logger in `utils/logger.ts`
  - _Requirements: R18, R19_

- [x] 13. Implement core middleware
  - `middleware/requestId.ts` — adds `x-request-id` to every request/response
  - `middleware/error.ts` — uniform envelope for thrown errors with codes
  - `middleware/rateLimit.ts` — in-memory token bucket keyed by userId or IP
  - _Requirements: R18_

- [x] 14. Implement auth service
  - `services/auth/password.ts` — bcrypt hash + verify, password policy (R1#1)
  - `services/auth/jwt.ts` — sign + verify access + refresh tokens with rotation
  - `services/auth/otp.ts` — generate 6-digit codes, store in DB, verify
  - _Requirements: R1, R18_

- [x] 15. Implement auth routes
  - `routes/auth.ts` — `POST /auth/register|login|refresh|logout`, `GET /auth/me`, phone-link endpoints
  - On register: create user, personal space, default INR wallet in one transaction
  - Include unit tests for register, login, refresh, password policy violations
  - _Requirements: R1, R2, R3_

- [x] 16. Implement auth middleware (web JWT + bot secret)
  - `middleware/auth.ts` — `requireUser` reads JWT from Authorization header, looks up user, sets context
  - `requireBot` — reads `X-Bot-Secret` and `X-Phone`, looks up user by `whatsapp_phone`
  - Apply globally; whitelist `/auth/*`, `/health`, `/qr*`
  - _Requirements: R1, R6, R18_

- [x] 17. Smoke test auth end-to-end
  - Bun test that registers, logs in, hits `/auth/me`, refreshes, fails on invalid creds
  - _Requirements: R1_

## Phase 3 — MiniLM ONNX + categorization

- [x] 18. Author MiniLM conversion script
  - `apps/api/scripts/convert-minilm-to-onnx.ts` — uses `@huggingface/transformers` to download `CyberKunju/finehance-categorizer-minilm`, exports ONNX, writes to `apps/api/src/ml/model/` AND `apps/web/static/models/`
  - Verify with a sample inference (e.g., "swiggy biryani" → expected category)
  - Document in `apps/api/src/ml/README.md` (how to re-run, what's in the artifact)
  - _Requirements: R7_

- [x] 19. Build server-side categorize service
  - `services/categorize/minilm.ts` — wraps Transformers.js pipeline, lazy-loaded singleton
  - `services/categorize/merchants.ts` — load `data/merchants.json` (curated India-first merchant list, 427 entries) with regex normalizer
  - `services/categorize/overrides.ts` — Drizzle queries against `category_overrides`
  - `services/categorize/index.ts` — tier resolver per design § 6 with merchant normalization helper
  - Unit tests across each tier (5 pass, 14 expect calls)
  - _Requirements: R7_

- [x] 20. Wire categorization into transactions
  - When a transaction is created without category: call categorizer, store category + confidence + categorized_by
  - When a transaction is updated to a different category by the user: insert `category_corrections` row + upsert `category_overrides`
  - _Requirements: R4, R7_

## Phase 4 — AI services

- [x] 21. Implement OpenAI client wrapper
  - `services/ai/client.ts` — single OpenAI instance, error handling, latency logging
  - `services/ai/transcribe.ts` — `gpt-4o-transcribe` primary, `whisper-1` fallback (recreate the file handle on retry — `toFile` consumes its source)
  - `services/ai/vision.ts` — `gpt-4o` for receipts; returns structured draft Zod-validated
  - _Requirements: R5, R6_

- [x] 22. Implement intent classifier
  - `services/ai/intent.ts` — `gpt-4o-mini` JSON mode, temp 0, max 200 tok, 60s in-memory cache
  - Return type matches `IntentResult` Zod schema
  - Tests: 30+ canonical phrases (en/hi/ml mixed)
  - _Requirements: R8_

- [x] 23. Implement expense parser
  - `services/ai/parser.ts` — `gpt-5-mini` JSON mode, strict null-rule prompt (the model returns `null` for any field not explicitly stated; the system never defaults missing fields)
  - Handles split bills, currencies, regional slang
  - Combine with regex extractors (price, quantity, currency, date) — regex is sacrosanct over AI
  - Tests: 50+ parsing cases including Malayalam slang (`Food-inu 200`), Tamil (`Sapadu ku 180`), Hindi (`200 chai pe`)
  - _Requirements: R5, R6, R8_

- [x] 24. Implement translate service
  - `services/ai/translate.ts` — `gpt-4o-mini` temp 0.2, sibling-script validation + one retry, in-memory cache. The validator rejects outputs whose target-script ratio is below 0.5 or whose sibling-script contamination exceeds 5% (e.g., Tamil characters in a Malayalam translation), then retries with a sharper prompt.
  - _Requirements: R14_

- [x] 25. Implement embed service
  - `services/ai/embed.ts` — `text-embedding-3-small`, used on transaction insert
  - `services/transactions/embed.ts` — async background job that upserts `transaction_embeddings`
  - _Requirements: R11_

## Phase 5 — Capture pipeline

- [x] 26. Implement FX service
  - `services/fx/client.ts` — exchangerate.host, 6h DB-backed cache (`fx_rates` table), expo backoff
  - `services/fx/convert.ts` — pure conversion utility used by transactions service
  - _Requirements: R4_

- [x] 27. Implement transaction services
  - `services/transactions/create.ts` — validate, FX-convert, categorize, persist, emit event
  - `services/transactions/transfer.ts` — atomic two-row insert with shared `transfer_id`
  - `services/transactions/query.ts` — filters, pagination, soft-delete handling
  - `services/transactions/normalize.ts` — merchant normalization helper (lowercase, strip UPI prefixes/suffixes like `@oksbi`, store numbers, city codes; collapse whitespace)
  - _Requirements: R3, R4_

- [x] 28. Implement capture routes
  - `routes/capture.ts` —
    - `POST /capture/text` runs full pipeline (intent → parse → confirm-or-create)
    - `POST /capture/voice` accepts multipart, transcribes, then funnels to text path
    - `POST /capture/image` accepts multipart, runs vision, returns draft
    - `POST /capture/confirm` commits a draft by `draftId`
  - Drafts live in a short-lived in-memory cache (ttl 5 min) keyed by ULID
  - When `needs_confirmation=false` and confidence >= 0.6, persist immediately
  - _Requirements: R5, R6, R8_

- [x] 29. Implement transaction CRUD routes
  - `routes/transactions.ts` — list/get/patch/delete + category-correction route
  - CSV import + export (use `papaparse` or hand-rolled parser; tiny enough)
  - _Requirements: R4, R12_

## Phase 6 — Budgets, goals, ledger, recurring, forecast

- [x] 30. Implement budgets service + routes
  - `services/budgets/` + `routes/budgets.ts` — CRUD, progress endpoint, threshold computation
  - On every transaction.created/updated/deleted in a budgeted category, recompute progress and emit warnings/exceeded events when thresholds cross
  - _Requirements: R9, R15_

- [x] 31. Implement goals service + routes
  - `services/goals/` + `routes/goals.ts` — CRUD, progress endpoint, projected-completion math
  - _Requirements: R9_

- [x] 32. Implement ledger service + routes
  - `services/ledger/` + `routes/ledger.ts` — CRUD, settlement endpoint, split-bill helper
  - When parser detects split: create user's transaction + lend ledger entries
  - _Requirements: R13, R5_

- [x] 33. Implement recurring detector
  - `services/forecast/recurring.ts` — algorithm per design § 10; runs on demand and via `bun run` cron-ish script
  - `routes/recurring.ts` — list, dismiss, manual-run endpoint
  - Tests: synthetic 90-day data with known recurring patterns
  - _Requirements: R10_

- [x] 34. Implement ARIMA forecast
  - `services/forecast/arima.ts` — in-house ARIMA(1,1,1) (~190 lines TS) with Hannan-Rissanen-style fit, fallback to trend MA
  - `services/forecast/anomaly.ts` — z-score detection on historical series
  - `services/forecast/index.ts` — orchestrates recurring + ARIMA + anomalies
  - `routes/forecast.ts` — GET endpoint with 6h cache invalidated by transaction events
  - _Requirements: R10_

## Phase 7 — Reports + advice

- [x] 35. Implement reports service + routes
  - `services/reports/` — summary, breakdowns, budget adherence, top merchants
  - `routes/reports.ts` — `/reports/summary` + CSV export
  - PDF export deferred to stretch
  - _Requirements: R12_

- [x] 36. Implement advice service
  - `services/ai/advice.ts` — composes summary context, calls `gpt-4o-mini` temp 0.3, returns 3-5 ranked suggestions with rules-based fallback
  - `routes/advice.ts` — GET endpoint
  - _Requirements: R11_

## Phase 8 — Copilot RAG + tool-calling

- [x] 37. Implement Copilot tool functions
  - `services/ai/copilotTools.ts` — `compute_total`, `compute_category_breakdown`, `compute_forecast`, `find_recurring`, `compare_periods`
  - Each is a pure function the LLM can call
  - _Requirements: R11_

- [x] 38. Implement Copilot route
  - `routes/copilot.ts` — `POST /copilot/chat` accepts message history, runs RAG (embed query, PgVector search top 20, build context), calls `gpt-4o-mini` with tools, streams SSE
  - System prompt enforces "no fabricated numbers, use tools for math, say so when data is missing"
  - _Requirements: R11_

## Phase 9 — Real-time WebSocket

- [x] 39a. Implement event bus (in-process)
  - `services/events/bus.ts` — local event emitter with monotonic seq per user
  - _Requirements: R15_

- [x] 39b. Implement WebSocket server
  - `routes/ws.ts` — Bun WebSocket upgrade with JWT auth via subprotocol header (`bearer.<jwt>`)
  - `services/events/ws.ts` — broadcaster keyed by user id, lazy bus subscription
  - All event-emitting services already wired through `services/events/bus.ts` so the broadcaster picks up everything
  - _Requirements: R15_

- [x] 40. Smoke test events end-to-end
  - `scripts/smoke-copilot.ts` — register → open WS → create transactions → assert WS receives `transaction.created` events → POST /copilot/chat → consume SSE stream
  - _Requirements: R15_

## Phase 10 — WhatsApp bot foundation

- [ ] 41. Bootstrap `apps/wa-bot`
  - `package.json` (Bun), `tsconfig.json`
  - Author `config.ts`, `index.ts`, `supervisor.ts`, `types.ts` from scratch
  - `types.ts` `ConversationState` enum reflects finance states from design § 9
  - _Requirements: R6_

- [ ] 42. Author `openwa/` and `utils/`
  - Author `createClient.ts` (whatsapp-web.js client with LocalAuth, browser path detection, keepalive, watchdog, auto-disconnect-exit), `handlers.ts` (LID resolution, two-pass send), `media.ts` (image/audio download with placeholder fallback), `sharedClient.ts` (late-bound client accessor)
  - Author `utils/logger.ts` (structured JSON logger with phone masking), `utils/phone.ts` (E.164 normalization + allowlist check), `utils/text.ts` (universal command detection across all 6 languages), `utils/retry.ts` (exponential backoff helper)
  - _Requirements: R6_

- [ ] 43. Author internal HTTP server (Hono)
  - `server/internalServer.ts` — Hono on port 5001 with `/health`, `/qr`, `/qr.png`, `/sessions`, `/send-message` (auth via `X-Bot-Secret`)
  - Add finance-specific endpoints: `/broadcast/budget-alert`, `/broadcast/forecast-anomaly`
  - _Requirements: R6, R15_

- [ ] 44. Author AI services (transcription, TTS, indicSpeech, translate, NLU helpers)
  - `services/transcribe.ts` — `gpt-4o-transcribe` with `whisper-1` fallback, language hint passthrough
  - `services/tts.ts` — `gpt-4o-mini-tts` with explicit per-language `instructions` field, `tts-1` fallback
  - `services/indicSpeech.ts` — `gpt-4o-audio-preview` for ta/ml combined translate-and-speak
  - _Requirements: R6, R14_

- [ ] 45. Author finance message packs
  - `conversations/messages/en.ts`, `hi.ts`, `ml.ts` — every user-visible string in three packs
  - Greeting, Help, error messages, confirmation prompts, finance-specific copy: "Logged ₹X under Y", "Budget warning", "What did you spend on?", etc.
  - `messages/index.ts` router with LANGUAGE_META and `getMessages(lang)` helper
  - _Requirements: R14, R6_

## Phase 11 — Bot conversation engine and flows

- [ ] 46. Implement state and engine skeletons
  - `conversations/state.ts` — in-memory session map, getSession/updateSession/resetSession
  - `conversations/engine.ts` — top-level dispatcher: voice transcribe → universal commands → state handlers → translate → TTS → two-pass send
  - _Requirements: R6_

- [ ] 47. Implement identity flow
  - `flows/identity.ts` — GREETING → AWAITING_LANGUAGE → linked check
  - On unlinked phone: instruct to register on web and use `LINK <code>`
  - _Requirements: R6, R1_

- [ ] 48. Implement link flow
  - `flows/link.ts` — handles `LINK 482917` style messages, calls `/auth/phone-link/confirm`
  - On success: persist linked status in session and reply with welcome
  - _Requirements: R1, R6_

- [ ] 49. Implement capture flow
  - `flows/capture.ts` — non-command messages route here: posts to `/capture/text`, `/capture/voice`, or `/capture/image` on the API
  - Handles confirmation pings (`CONFIRM` / `EDIT` / `CANCEL`) before persisting drafts
  - On `query_spending`/`view_summary` intents: render the API result as a 1-2 line bot reply
  - On `chat` intent: stream copilot response (or buffer + chunk if > 1500 chars for WhatsApp)
  - _Requirements: R5, R6, R8_

- [ ] 50. Implement query, budget, correct, help flows
  - `flows/query.ts` — handle "how much on X this month" without going through API parser when fast pattern matches
  - `flows/budget.ts` — multi-step "set budget for groceries 5000"
  - `flows/correct.ts` — "that should be Transport not Food" → posts category correction to API
  - `flows/help.ts` — universal HELP command renders localized help card
  - _Requirements: R6, R7, R8, R9_

- [ ] 51. Implement bot apiClient
  - `services/apiClient.ts` — typed wrapper around `apps/api` calls with `X-Bot-Secret` and `X-Phone` headers
  - All flow files use this wrapper exclusively
  - _Requirements: R6_

- [ ] 52. Wire QR pairing UI
  - Verify `/qr` (HTML auto-refresh) + `/qr.png` work; first run prints QR to terminal AND serves it
  - _Requirements: R6, R19_

- [ ] 53. End-to-end bot smoke test
  - From simulator (`POST /simulator/message`): send "spent 450 on auto" as an allowlisted phone, assert reply contains confirmation, assert API created the transaction
  - _Requirements: R5, R6_

## Phase 12 — Web app foundation

- [ ] 54. Bootstrap SvelteKit
  - `apps/web` with Svelte 5, TypeScript strict, Tailwind v4, Vite
  - `svelte.config.js` with adapter-static or adapter-node (pick adapter-node for SSR convenience)
  - `tailwind.config.ts` with content paths and shadcn-svelte palette
  - Theme tokens in `app.css`
  - _Requirements: R19_

- [ ] 55. Install shadcn-svelte primitives
  - Initialize shadcn-svelte CLI with chosen theme
  - Add: button, input, card, dialog, drawer, sheet, dropdown-menu, command, toast, tooltip, table, tabs, badge, avatar, switch, slider, popover, scroll-area, skeleton
  - _Requirements: R19_

- [ ] 56. Implement auth client
  - `lib/api/client.ts` — fetch wrapper with auto-refresh on 401, attaches access JWT, base URL from env
  - `lib/stores/auth.svelte.ts` — login/logout/refresh logic, exposes `user` rune
  - Login + Register pages with form validation against shared Zod schemas
  - Auth guard in `+layout.ts` redirects unauthenticated to `/login`
  - _Requirements: R1, R18_

- [ ] 57. Implement WebSocket client
  - `lib/api/ws.ts` — connect on auth, exponential backoff reconnect, polling fallback, dispatch into TanStack Query cache
  - _Requirements: R15_

- [ ] 58. Implement layout shell
  - `routes/+layout.svelte` — sidebar + topbar + content + slide-in copilot panel
  - Sidebar items: Dashboard, Transactions, Budgets, Goals, Forecast, Reports, Settings
  - Theme toggle, language pill, user menu
  - Floating copilot trigger button (bottom-right)
  - ⌘K command menu (cmdk via shadcn-svelte command)
  - _Requirements: R19_

## Phase 13 — Omnibar, Privacy Mode, and capture flows

- [ ] 59. Implement omnibar component
  - `components/omnibar/Omnibar.svelte` — single input with hotkey `⌘L` global focus
  - Voice button uses MediaRecorder, posts to `/capture/voice`
  - Image drop / paste uses `/capture/image`
  - On submit: posts to `/capture/text`, handles intent variants (transaction, query, chat, set_budget) with appropriate UI
  - When `needs_confirmation`: opens confirmation dialog with editable fields, submits to `/capture/confirm`
  - _Requirements: R5, R8_

- [ ] 60. Implement Privacy Mode
  - `lib/ai/minilm-client.ts` — Transformers.js loader using `apps/web/static/models/`
  - First-toggle UX: progress bar showing model download to IndexedDB
  - When ON: omnibar runs categorize client-side, posts pre-categorized transaction to `/transactions` endpoint with `categorized_by='client'`
  - When ON: voice and image capture disabled with tooltip explanation
  - Settings panel toggle persists to `/settings` and localStorage
  - _Requirements: R17, R7_

## Phase 14 — Web pages

- [ ] 61. Build dashboard page
  - `routes/+page.svelte` — top tiles (this month income, expense, savings rate, net worth), recent transactions, this month forecast preview, top 3 categories, budget alerts strip, copilot quick-prompt cards
  - Subscribe to WS events; animate new transactions in
  - _Requirements: R4, R9, R10, R11, R15_

- [ ] 62. Build transactions page
  - Filter bar (date range, type, category, wallet, search)
  - Virtualized table (use TanStack Virtual)
  - Bulk select + bulk category change + bulk delete
  - Detail drawer with edit form, category correction inline
  - Import CSV button + Export CSV button
  - _Requirements: R4, R7, R12_

- [ ] 63. Build budgets page
  - List with progress bars per category, color-coded thresholds
  - Create/edit form with `{category: amount}` builder
  - Live recompute on transaction events
  - _Requirements: R9, R15_

- [ ] 64. Build goals page
  - Cards with progress + projected completion
  - Create/edit form with optional category link
  - Update progress action (manual contribution)
  - _Requirements: R9_

- [ ] 65. Build forecast page
  - Big chart using Layerchart: actuals + recurring base + variable forecast band
  - Recurring items list with amounts and next dates
  - Anomalies callout strip
  - Last 90 days vs forecast next 30 comparison
  - _Requirements: R10, R15_

- [ ] 66. Build reports page
  - Date-range picker
  - Summary tiles, income/expense breakdowns (donut + table)
  - Budget adherence list
  - Export CSV button
  - _Requirements: R12_

- [ ] 67. Build settings page
  - Account: change password, change display name
  - Language picker (6 langs)
  - Base currency
  - Privacy Mode toggle (with download status)
  - Phone link section (start, show OTP, status)
  - Wallets management (CRUD)
  - _Requirements: R1, R3, R14, R17_

## Phase 15 — Copilot panel

- [ ] 68. Build copilot panel
  - `components/copilot/CopilotPanel.svelte` — slide-in sheet with message list + input
  - Use Vercel AI SDK with custom SSE endpoint at `routes/api/copilot/+server.ts` (proxies to API `/copilot/chat`)
  - Render markdown + streaming tokens via `MessageBubble.svelte`
  - Quick-prompt chips: "How much did I spend on food this month?", "Forecast next 30 days", "Where am I overspending?"
  - _Requirements: R11_

- [ ] 69. Build copilot tool-result UI
  - When the model returns tool results (compute_total, breakdown), render them as inline charts/tables instead of plain text
  - _Requirements: R11_

## Phase 16 — PWA + offline

- [ ] 70. Configure PWA
  - `manifest.webmanifest`, icons, theme color
  - Register service worker
  - App shell cached cache-first; static models cache-first
  - _Requirements: R16_

- [ ] 71. Implement offline capture queue
  - `lib/stores/pendingCaptures.svelte.ts` — IndexedDB-backed queue
  - Service worker background-sync drains the queue when online
  - "Pending captures" UI surfaces queue + sync errors
  - _Requirements: R16_

## Phase 17 — Polish, testing, demo

- [ ] 72. Write parser unit tests
  - 50+ phrases across en/hi/ml mixed, including Malayalam, Tamil, Telugu, and Kannada slang
  - _Requirements: R5, R8_

- [ ] 73. Write categorize unit tests
  - Override priority, merchant DB hits, MiniLM fallback
  - _Requirements: R7_

- [ ] 74. Write forecast unit tests
  - Synthetic series with known recurring + known variable + known anomaly
  - _Requirements: R10_

- [ ] 75. Write end-to-end happy path test (Playwright)
  - Login → omnibar capture → transaction visible → budget progress updated → copilot answers
  - _Requirements: R5, R9, R11, R15, R19_

- [ ] 76. Write bot conversation engine test
  - Headless `bun run test:flow` walks: greet → link → capture text → capture voice (mock) → query → set budget → correct
  - _Requirements: R6_

- [ ] 77. Write final README
  - Replace placeholder with full setup recipe (R19), demo credentials, architecture diagram link, screenshots, demo URL placeholder
  - Document the demo phone setup (using personal WhatsApp + allowlisted second number)
  - Document `bun run reset:demo` for re-running demo cleanly
  - _Requirements: R19_

- [ ] 78. Prepare demo script
  - Step-by-step demo flow document for the hackathon presentation
  - Includes the "wow" sequence: WhatsApp voice in Malayalam → web dashboard updates live → copilot answers → privacy mode toggled and demonstrated
  - _Requirements: R19_

- [ ] 79. Final pass: lint, typecheck, dead code removal
  - `bun run check` across all workspaces returns clean
  - All env vars documented in `.env.example`
  - All TODO/FIXME comments resolved or moved to issues
  - _Requirements: all_

## Stretch (only if time)

- [ ] 80. PDF report export
- [ ] 81. Voice replies in copilot (web reads back via Web Speech API)
- [ ] 82. Bank-statement PDF parser for batch import
- [ ] 83. Recurring suggestion engine ("cancel this subscription, you haven't streamed in 60d")
- [ ] 84. Goal challenges and streaks (gamified savings progress)
