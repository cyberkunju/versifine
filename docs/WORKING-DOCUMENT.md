# Versifine — Working Document (6-Day Build to Submission)

> A day-by-day account of how Versifine went from a blank repo to a deployed, submitted product.
> Versifine is a frictionless, multimodal personal-finance manager with an AI co-pilot:
> capture spending by text, voice, or photo — from a SvelteKit web dashboard or directly
> in WhatsApp — and get back honest forecasts, grounded insights, and budgets that learn
> from corrections. India-first, multilingual (en/hi/ml/ta/te/kn), single-user MVP on a
> multi-tenant-ready schema.

| | |
| --- | --- |
| **Project** | Versifine (workspace folder: `Finehance`) |
| **Duration** | 6 days (Tue → Sun, submission Sunday) |
| **Architecture** | 3 Bun apps (`api`, `web`, `wa-bot`) + `packages/shared` + a standalone Python ML pipeline (`ModelEngines`) |
| **Datastore** | PostgreSQL 16 + pgvector 0.8.2 (native install, no Docker) |
| **End state** | Full product complete, production-ready, deployed live behind Cloudflare → AWS EC2, and submitted |

## How this was built — tooling & budget reality

This project was built solo with **zero budget for paid AI coding agents**. The whole thing
was assembled by leaning on free tiers and trials, rotating between them as limits hit:

- **Primary driver:** Codex / ChatGPT 5.5 used as the AI coding agent, switching across
  **multiple free-tier accounts** to keep momentum once per-account limits were exhausted.
- **Secondary agents:** Kiro and other free-trial coding agents used in parallel to spread
  the load and parallelize independent work (web pages, bot flows, tests).
- **No paid plan during the build.** No ChatGPT Plus or any paid agent subscription was used
  on days 1–5 — everything ran on free allowances and trials, deliberately, to ship on time
  on no budget.
- **Submission day (Day 6) only:** a **single ChatGPT Plus account** was activated *just for
  the final day* to fine-tune, finish the remaining production-ready work, and submit without
  interruption from free-tier rate limits.

This constraint shaped the workflow: tasks were broken into small, self-contained chunks that
any agent could pick up from the spec docs, and `docs/` was kept as the single source of truth
so a fresh agent (or a fresh free account) could resume with full context at any time.

---

## Day 1 — Planning Phase

**Goal: turn a one-line product idea into a buildable, fully-specified plan. No production code on day 1 — the deliverable is clarity.**

> **Tooling:** planning and spec drafting done with Codex / ChatGPT 5.5 on a free-tier
> account, with Kiro used to structure the `.kiro/specs/` documents. No budget spent.

### 1.1 Product definition

Locked the vision and the win condition before writing anything. The MVP is judged by one end-to-end arc:

1. Clone the repo, bring up Postgres, `bun install && bun run dev`.
2. Register on the web app, immediately see seeded transactions.
3. Type "spent 450 on auto" — it parses, categorizes, persists, and the dashboard updates live.
4. Send the same message via WhatsApp from an allowlisted number — same result, replied in the user's language with text **and** a voice note.
5. Ask the AI copilot "where did my money go this month?" — get a streaming, grounded answer with real numbers.
6. Toggle Privacy Mode and watch categorization keep working without sending text to the server.

### 1.2 Requirements spec

Authored `.kiro/specs/versifine/requirements.md` — every user story with explicit acceptance criteria. The requirement groups that framed the whole build:

- **R1 Authentication & identity** — email/password (bcrypt), JWT access+refresh rotation, WhatsApp phone linking via 6-digit OTP, developer allowlist for demo convenience.
- **R2 Spaces (multi-tenant readiness)** — every owned row carries `space_id`; `space_members` table exists from day one even though MVP only inserts the `owner` row. Zero-migration path to household/business spaces in v2.
- **R3 Wallets** — cash/bank/upi/credit_card/wallet, opening balances, atomic transfers (two rows sharing a `transfer_id`), live balance computation.
- **R4 Transactions** — CRUD, multi-currency with 6h-cached FX, soft delete, filters/pagination, category corrections feeding personalization.
- **R5 Web omnibar capture** — one input for text/voice/image, intent classification, split-bill detection, low-confidence clarification, live WS broadcast.
- **R6 WhatsApp parity** — anything the omnibar does, WhatsApp does, in six languages, with text + voice replies.
- **R7+ Categorization, forecast, copilot, budgets, goals, ledger, reports, realtime** — the rest of the surface.

### 1.3 Architecture & boundaries

Decided the system shape: **three Bun-runtime apps sharing one Postgres**, with a shared TypeScript package as the single wire contract. Key boundary rules set on day 1:

- **The API is the only writer to the database.** The bot never touches Postgres; every bot action is a typed HTTP call signed with `X-Bot-Secret` + `X-Phone`. Single ingress for auth, validation, FX, categorization, embedding, and event emission.
- **`packages/shared` is the contract.** Zod schemas, enums, event types, category/currency/language constants — imported as `@versifine/shared` by all three apps.
- **SSE for streaming, WebSocket for fan-out.** Copilot answers stream over SSE; live broadcasts (transaction.created, budget.warning) go over WS.
- **In-process everything for hackathon scale.** No Redis, no Docker, no separate ML server. Rate limiting, event bus, AI cache, and the MiniLM model all run in-process.

### 1.4 Tech-stack decisions

Recorded every choice and its rationale (`docs/03-stack.md`):

- **Runtime:** Bun 1.3.x (native TS, `--env-file`, `Bun.serve` HTTP+WS, built-in test runner), TypeScript 5.7 strict.
- **API:** Hono + Drizzle ORM + postgres-js + jose (JWT) + Zod + OpenAI SDK.
- **Web:** SvelteKit (Svelte 5 runes) + Vite 6 + Tailwind v4 + bits-ui/shadcn-svelte + TanStack Query + Vercel AI SDK.
- **Bot:** whatsapp-web.js + Hono internal server + OpenAI (Whisper/TTS/translate).
- **DB:** PostgreSQL 16 native install + pgvector 0.8.2 (Windows binaries copied in manually).
- **Tooling:** Biome (lint+format in one), concurrently for `bun run dev`.

Also captured the explicit "NOT using" list (Docker, Prisma, Express, React, Redux, GraphQL, Telegram, etc.) so defaults didn't creep in later.

### 1.5 Database design

Designed the full 16-table schema on paper before migrations: `users`, `spaces`, `space_members`, `refresh_tokens`, `phone_link_otps`, `wallets`, `transactions` (the 22-column central table), `transaction_embeddings` (pgvector 1536), `category_overrides`, `category_corrections`, `budgets`, `goals`, `ledger_entries`, `ledger_settlements`, `recurring_items`, `fx_rates`. Decided index strategy (IVFFlat cosine for embeddings, GIN trigram for description search) and the application-level invariants (tenant isolation, soft delete, money sign convention, transfer atomicity).

### 1.6 The ML strategy (ModelEngines)

Planned the categorizer as a **separate Python project** that produces an ONNX bundle the TS apps load at runtime. The v2 design: open-vocabulary, retrieve-then-rerank (multilingual e5-small bi-encoder → mDeBERTa-v3 cross-encoder), distilled once from a Gemma teacher so there's **no LLM in the inference loop** — fully local, offline-capable, browser-friendly for Privacy Mode. Target ≥95% top-1 on messy code-mixed Indian text, built for under $30 of compute.

### 1.7 Task breakdown

Closed the day with `.kiro/specs/versifine/tasks.md` — a phased build plan (Phases 0 → 17, ~79 tasks) with a dependency graph, and a sweep plan in `docs/15-roadmap.md` that ordered the work web-first and identified which sweeps could be parallelized across sub-agents.

**Day 1 deliverables:** `requirements.md`, `design.md`, `tasks.md`, stack decisions, schema design, ML strategy. Zero application code, full clarity.

---

## Day 2 — ~40% of the MVP backend

**Goal: stand up the foundation and the data spine so the API boots, authenticates, and persists transactions.**

> **Tooling:** Codex / ChatGPT 5.5 free tier as the main coding agent; rotated to a second
> free account when the first hit its limit mid-afternoon. Kiro used in parallel for the
> Drizzle schema scaffolding. Zero paid usage.

### 2.1 Phase 0 — Repository foundation ✅

- Bun workspaces wiring `apps/api`, `apps/web`, `apps/wa-bot`, `packages/shared`.
- Biome config (single quotes, trailing commas, 100-col, 2-space, LF).
- Zod-validated env (`apps/api/src/env.ts`) as the single source of truth — prints field-level errors on a bad `.env`.
- `.gitignore`, `.npmrc`, root `package.json` scripts, README.
- `scripts/db-init.ts` — idempotent bootstrap that creates `versifine_dev` + `versifine_test`, the `versifine` role, grants, and enables the four extensions (`pgcrypto`, `pg_trgm`, `citext`, `vector`).
- Native PostgreSQL 16 + pgvector 0.8.2 installed and verified (pgvector Windows binaries copied into the Postgres install dirs).

### 2.2 Phase 1 — DB schema + migrations ✅

- All **16 Drizzle tables** authored under `apps/api/src/db/schema/`.
- Three migrations applied:
  - `0000_*` — initial 16 tables + all indexes.
  - `0001_*` — cyclic FK `users.active_space_id → spaces.id` (added after both tables exist) + IVFFlat tuning `WITH (lists = 100)`.
  - `0002_*` — unique index `(space_id, merchant_normalized)` so override upsert collapses to a single `ON CONFLICT` statement.
- Custom Drizzle types for `numeric(14,2)` (money) and `vector(1536)` (embeddings) with driver codecs.
- Verified: all 16 tables present, all 4 extensions enabled, IVFFlat + GIN indexes live.

### 2.3 Phase 2 — API foundation + auth ✅

- `Bun.serve` entry (`apps/api/src/index.ts`) mounting Hono + the WebSocket upgrader on one port.
- Middleware stack: `requestId` (x-request-id + child logger), `error` (uniform `{ success, error }` envelope, ZodError → 400), `auth` (`requireUser` JWT, `requireBot` secret+phone), `authEither` (capture path), `rateLimit` (in-memory token bucket).
- Auth service: bcrypt via `Bun.password`, jose JWT with **two distinct secrets** (access + refresh) and refresh-token rotation/replay defense in Postgres, 6-digit OTP for phone linking.
- Routes mounted: `health` (liveness + `/health/ready` DB pong), `auth` (register/login/refresh/logout/me/phone-link).
- Registration does the full atomic bootstrap: create user → personal space → owner `space_member` → default INR wallet → return tokens.
- Smoke test (`smoke-auth.ts`) green; `/health` returns 200.

### 2.4 Foundation of the capture/AI layer (Phases 3–4 begun)

- AI service skeleton (`services/ai/`): OpenAI client singleton, intent classifier, expense parser + regex extractors (currency-aware), embeddings, translate. The full model map wired through env vars.
- Categorizer waterfall scaffolding (`services/categorize/`): the four-tier resolver (overrides → merchants DB → MiniLM ONNX → default) with the ML tier degrading gracefully when the ONNX artifact is absent.
- ModelEngines Python pipeline scaffolded in parallel: `taxonomy/` (groups + leaves + crosswalk), `config.py`, `jobs/` (Gemma generate, train encoders, export, eval), `local/` (harvest, expand, package), and the teacher data `packs/`.

**End of Day 2:** API boots, typechecks clean, auth works end-to-end, schema is fully live, and the categorization/AI plumbing is in place. Roughly **40% of the MVP backend** is done — the spine (foundation, schema, auth, the start of capture) is solid; the domain services and copilot are next.

---

## Day 3 — ~80% backend + ~20% frontend

**Goal: finish the backend domain surface and the AI brain, and stand up the web foundation so there's a visible dashboard.**

> **Tooling:** the heaviest agent day — cycled through several Codex / ChatGPT 5.5 free-tier
> accounts plus a couple of other free-trial coding agents running concurrently on
> independent service modules to beat the rate limits. Kiro handled the web foundation
> scaffolding. Still no paid plan.

### 3.1 Phase 3 — MiniLM ONNX + categorize 🟡 (code complete)

- Tier resolver, overrides, merchant DB, and MiniLM loader all written and tested.
- The ONNX artifact still needs the Python toolchain run once (SafeTensors → ONNX); the categorizer detects its absence and degrades cleanly to merchant DB + default tiers. `categorize.test.ts` passes against both paths.

### 3.2 Phase 4 — AI services ✅

Complete `services/ai/` set: `client`, `transcribe` (gpt-4o-transcribe → whisper-1 fallback), `vision` (receipt parsing), `intent`, `parser` + `parserRegex`, `translate`, `embed`, `advice`, `copilotTools`.

### 3.3 Phase 5 — Capture pipeline ✅

- In-memory drafts with TTL, `persist`, wallet picker, query helpers.
- All four capture routes: `/capture/text`, `/capture/voice`, `/capture/image`, `/capture/confirm`.
- The full lifecycle: intent classify → parse → wallet pick → categorize → FX → insert → emit `transaction.created` → fire-and-forget budget recompute. Low-confidence inputs return a `draftId` for confirmation instead of guessing.

### 3.4 Phase 6 — Budgets / Goals / Ledger / Recurring / Forecast ✅

- Five service modules + five route files.
- Recurring detector, ARIMA(1,1,1) forecast with rolling-average fallback, anomaly z-score detection, budget threshold alerts firing `budget.warning` / `budget.exceeded`.
- Goals with projected completion; ledger lend/borrow with atomic settlements.

### 3.5 Phase 7 — Reports + advice ✅

Summary service + report routes (JSON + CSV export). Advice service uses gpt-4o-mini with a deterministic rule fallback when no API key is present.

### 3.6 Phase 8 — Copilot RAG + tool-calling ✅

The full pipeline: embed query → PgVector cosine retrieval → context build → streaming SSE → tool-dispatch loop (capped at 4 rounds). Tools require explicit date ranges so the LLM never fabricates numbers — all math goes through tool functions.

### 3.7 Phase 9 — WebSocket ✅

Upgrade endpoint with subprotocol bearer-JWT auth, per-user fan-out, lazy bus subscription, reconnect-friendly. Every event-emitting service writes through the in-process bus.

### 3.8 Backend verification

By this point: **14 Hono routes mounted**, **~111 `.ts` files in `apps/api`**, 9 smoke scripts green (auth, transaction, budget, goal, ledger, recurring, forecast, reports, copilot), typecheck clean. That's roughly **80% of the backend** — every domain service and the AI brain are live; only the ONNX artifact, demo seed polish, and final hardening remain.

### 3.9 Phase 12 — Web foundation ✅ (~20% frontend)

- SvelteKit + Tailwind v4 + bits-ui primitives.
- `lib/api/client.ts` (fetch wrapper with auto-refresh), `lib/api/ws.ts` (reconnecting WebSocket), TanStack Query factory.
- Rune stores: `auth.svelte.ts`, `settings.svelte.ts` (language + privacy + theme).
- Layout shell: sidebar, topbar, ⌘K command menu, floating copilot button; `login` and `register` pages.

**End of Day 3:** the backend is feature-complete bar polish, and the web app has its foundation — you can register, log in, and see the authenticated shell wired to live data and WS events. **~80% backend / ~20% frontend.**

---

## Day 4 — MVP done

**Goal: complete the web surface, the bot, the interactive AI features, PWA/offline, tests, and ship it.**

> **Tooling:** parallelized hard across free agents — web pages and bot flows were each
> handed to a separate free-trial coding agent (Codex / ChatGPT 5.5 free accounts + Kiro),
> built from the spec docs, then reviewed and merged by hand. Account-switching whenever a
> free tier ran dry. No budget spent through the entire MVP.

### 4.1 Phase 13 — Omnibar + Privacy Mode ✅

- Omnibar with text / voice (MediaRecorder) / image (drag-drop receipt), `ConfirmDialog` for low-confidence drafts, ⌘L focus shortcut.
- MiniLM client loader (`lib/ai/minilm-client.ts`) via Transformers.js — Privacy Mode runs categorization in the browser once the ONNX artifact is present; transaction text never leaves the device.

### 4.2 Phase 14 — Web pages ✅ (parallelized across sub-agents)

Dashboard, Transactions, Budgets, Goals, Forecast, Reports, Settings — every page renders with seeded data and subscribes to the relevant WS events for live updates. Built in parallel (one sub-agent per page) then reviewed and merged.

### 4.3 Phase 15 — Copilot UI ✅

Slide-in panel, markdown message bubbles with tool-result rendering, quick-prompt chips, SSE proxy at `/api/copilot`. Token-by-token streaming via the Vercel AI SDK.

### 4.4 Phases 10–11 — WhatsApp bot ✅

- **Foundation:** `index.ts`, `supervisor.ts` (crash-loop backoff + orphan Chromium cleanup), `openwa/` client (LocalAuth + watchdog), internal Hono server on :5001 (`/qr`, `/qr.png`, `/sessions`, `/send`, `/broadcast/*`, `/simulator/message`), AI services (transcribe/TTS/indicSpeech/translate), utils.
- **Conversation engine:** dispatcher + in-memory state + **8 flows** (identity, link, capture, confirm, query, budget, correct, help) + **3 hand-translated message packs** (en/hi/ml) + typed `apiClient`. Bot flow test green.
- Two-pass send: instant text bubble, then voice note. Multilingual replies with TTS / Indic audio synthesis.

### 4.5 Phase 16 — PWA + offline ✅

Service worker with three caching strategies (cache-first precache + models, stale-while-revalidate for the rest), IndexedDB-backed pending-capture queue, background-sync drain on reconnect, manifest + theme. App is installable.

### 4.6 Phase 17 — Polish, tests, demo ✅

- **47 API tests** green across categorize / parser-regex / forecast, plus **2 wa-bot engine tests**.
- Workspace typecheck clean across all four workspaces; web build + `svelte-check` clean.
- 90-day realistic Indian demo seed (4 wallets, 216 transactions, 3 budgets, 3 goals, 3 ledger entries, 13 detected recurring items). Demo credentials: `demo@versifine.com` / `Versifine#2026!`.
- README, runbook (`docs/14-runbook.md`), and demo script finalized.

### 4.7 Deployment ✅

Shipped live to **https://versifine.com** — Cloudflare-proxied to an AWS EC2 box (`ap-south-2`, Fedora):

- systemd services: `versifine-api` (:5100), `versifine-web` (:3100), `versifine-wabot` (:5101).
- Native Postgres 16 + pgvector on the box; nginx vhost routing `/`, `/api/`, `/ws`, `/wa-qr/`, `/healthz`.
- GitHub Actions CI/CD (`.github/workflows/deploy.yml`) — push to `main` SSHes in, builds, syncs, migrates, smart-restarts, and smoke-tests origin + public.
- Origin-direct smoke test returns 200 on `/`, `/healthz`, `/api/health`, `/wa-qr/`, `/wa-qr/qr.png`.

**End of Day 4: MVP done.** All 18 phases substantially complete, full demo arc working end-to-end, deployed and reachable.

---

## Day 5 (Saturday) — Enhanced UI + depth pass

**Goal: take the working-but-functional MVP and make it feel like a real product — polished UI, better UX, and the rough edges sanded off.**

> **Tooling:** still on free tiers — Codex / ChatGPT 5.5 free accounts (rotated as limits
> hit) plus Kiro and other free-trial agents for the UI component work. Deliberately holding
> the single ChatGPT Plus account in reserve for the submission day. No budget spent.

### 5.1 UI overhaul

- Reworked the SvelteKit dashboard visual language: refined spacing, typography scale, and
  the dark/light theme tokens for a consistent, modern look across every page.
- Polished the core surfaces — Dashboard, Transactions, Budgets, Goals, Forecast, Reports,
  Settings — with better empty states, loading skeletons, and responsive layouts down to
  mobile widths.
- Tightened the omnibar and copilot panel interactions: smoother transitions, clearer
  confirm dialogs, and better feedback on voice/image capture.
- Improved data-viz: cleaner charts for the 30-day spend, forecast bands, and budget
  progress bars, with consistent currency/number formatting throughout.

### 5.2 UX + consistency

- Unified toasts, error envelopes, and inline validation messages so every surface speaks
  the same language.
- Refined the command menu (⌘K), keyboard shortcuts, and the floating copilot button.
- Accessibility pass: focus states, aria labels on interactive controls, and color-contrast
  fixes on the new theme.

### 5.3 Stability

- Fixed UI bugs surfaced by real demo data, hardened WS reconnect handling in the client,
  and made the PWA install + offline-queue flow more robust.
- Verified web build + `svelte-check` clean after the overhaul; smoke-tested the full demo
  arc again end-to-end.

**End of Day 5:** the product looks and feels finished — the same capabilities, but with a
polished, cohesive UI ready to put in front of judges.

---

## Day 6 (Sunday) — Submission day: production hardening, Google auth, enhanced WhatsApp flow

**Goal: final fine-tune, production-ready work, ship the remaining headline features, and submit.**

> **Tooling:** this is the one day the **ChatGPT Plus account** was activated — used solely
> for the final push so rate limits couldn't interrupt the fine-tuning and finishing work.
> Everything before today was done on free tiers; Plus was the planned "last mile" tool to
> get across the line and submit.

### 6.1 More UI enhancement

- Final visual polish pass on top of Day 5: micro-interactions, refined component states,
  and a consistent brand treatment across web and the WhatsApp QR/pairing pages.
- Last-mile responsive and accessibility fixes; tuned the login/register screens (incorporated
  the redesigned login flow) for the first-impression surface.

### 6.2 Google authentication ✅

- Added **Google Sign-In** alongside email/password — OAuth flow wired into the auth service,
  with account linking so a Google identity maps to the same user/space model.
- On first Google login the same atomic bootstrap runs (personal space → owner member →
  default INR wallet → tokens), so OAuth users get a fully provisioned account.
- Login and register screens updated with the Google button and the existing JWT
  access+refresh rotation preserved behind it.

### 6.3 Enhanced WhatsApp flow ✅

- Reworked the conversation engine for a smoother end-to-end experience: clearer onboarding
  and linking, more natural multilingual replies, and tighter capture → confirm → logged
  loops.
- Improved the two-pass send (instant text, then voice note), better handling of
  voice/image messages, and more resilient session/supervisor behavior.
- Polished the localized message packs and the help/query/budget/correct flows so the bot
  feels like a first-class surface, at parity with the web omnibar.

### 6.4 Production-ready work ✅

- Final deployment hardening on the live Cloudflare → AWS EC2 stack: verified all three
  systemd services (`versifine-api`, `versifine-web`, `versifine-wabot`), nginx routing, and
  the CI/CD pipeline (push-to-`main` → build → migrate → smart-restart → smoke-test).
- Tightened env/secret handling, confirmed health endpoints return 200 origin-direct and via
  Cloudflare, and validated the WhatsApp QR pairing path end-to-end on the deployed box.
- Ran the full verification matrix one last time: workspace typecheck clean, API + bot tests
  green, web build clean, demo seed populating correctly.

### 6.5 Submission ✅

Fine-tuned, finished, and **submitted**. The complete product — multimodal capture, AI copilot,
WhatsApp bot, forecasting, budgets/goals/ledger, Google + email auth, PWA/offline, and a
polished UI — is done and live at **https://versifine.com**.

**End of Day 6: project complete and submitted.**

---

## Status snapshot at submission

| Phase | Status |
| --- | --- |
| 0 Repo foundation | ✅ |
| 1 DB schema + migrations | ✅ |
| 2 API foundation + auth | ✅ |
| 3 MiniLM ONNX + categorize | 🟡 code complete, ONNX artifact pending |
| 4 AI services | ✅ |
| 5 Capture pipeline | ✅ |
| 6 Budgets/Goals/Ledger/Recurring/Forecast | ✅ |
| 7 Reports + advice | ✅ |
| 8 Copilot RAG + tool-calling | ✅ |
| 9 WebSocket | ✅ |
| 10 wa-bot foundation | ✅ |
| 11 wa-bot conversation engine | ✅ |
| 12 Web foundation | ✅ |
| 13 Omnibar + Privacy Mode | ✅ |
| 14 Web pages | ✅ |
| 15 Copilot UI | ✅ |
| 16 PWA + offline | ✅ |
| 17 Polish + testing + demo | ✅ |
| 18 UI overhaul (Day 5) | ✅ |
| 19 Google authentication (Day 6) | ✅ |
| 20 Enhanced WhatsApp flow (Day 6) | ✅ |
| 21 Production hardening + submission (Day 6) | ✅ |

### Known caveats (non-blocking)

1. **MiniLM ONNX artifact not yet checked in** — the categorizer degrades cleanly to merchant DB + default tiers until the Python `optimum-cli` export is run once.
2. **`apps/web/static/models/onnx/` empty** — same root cause; Privacy Mode shows a friendly "model artefact missing" message until the export lands.
3. Minor cosmetic numeric-customType string/number mismatch flagged for a future cleanup sweep.

### What's next (post-submission / stretch)

PDF report export, voice replies inside the web copilot, bank-statement PDF parser, dormant-subscription cancellation engine, goal streaks. Further production hardening: httpOnly cookies for refresh tokens, WhatsApp Business Cloud API migration, managed Postgres, Redis-backed rate limiter/bus/cache, observability, full CI test gates.

---

## How to reproduce the build locally

```bash
bun install                                # workspace install
bun run db:init                            # create + reset databases, enable extensions
bun run --cwd apps/api db:migrate          # apply the three migrations
bun run --cwd apps/api db:seed             # 90-day Indian demo dataset

bun run typecheck                          # 0 errors across all four workspaces
bun run --cwd apps/api test                # 47 pass / 0 fail
bun run --cwd apps/wa-bot test             # 2 pass / 0 fail

bun run dev                                # api :5000, web :5173, bot :5001
```

Demo credentials: `demo@versifine.com` / `Versifine#2026!`.
