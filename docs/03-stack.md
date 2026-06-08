# 03 · Tech Stack

> Every choice has a reason. This document records what's installed, why it beat the alternatives, and what it replaces from the reference repos.

## Runtime

### Bun 1.3.14

The whole TypeScript universe runs on Bun.

- **Why Bun over Node**: native TypeScript (no `ts-node`), built-in `--watch`, `--env-file`, `Bun.serve` HTTP + WebSocket, `Bun.password.hash` (bcrypt), `Bun.CryptoHasher`, native test runner. Startup time is roughly half of Node + ts-node. The lockfile (`bun.lock`) is cross-platform-stable.
- **Why Bun over Deno**: ecosystem maturity for the libraries we depend on (whatsapp-web.js still has rough edges on Deno; OpenAI SDK is happiest on Node-flavored runtimes).
- **What it replaces**: `ts-node`, `dotenv-cli` (we use `bun --env-file=...`), and Node's `crypto` for password hashing.

### TypeScript 5.7.3

Strict mode, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` on. `allowImportingTsExtensions` so internal imports use `.ts` (Bun handles them natively, `tsc --noEmit` is happy).

### PostgreSQL 16.14 (native install on Windows)

Single database engine for everything: relational data, JSONB metadata, vector search.

- **Why no Docker**: the user's brief said no Docker for now. Native install via winget; the service runs on boot.
- **Extensions enabled**: `pgcrypto` (for `gen_random_uuid()`), `pg_trgm` (GIN trigram index for description search), `citext` (case-insensitive email column), `vector` (pgvector, IVFFlat index for embeddings).
- **pgvector 0.8.2** — Windows binaries built by community contributor; manually copied into `C:\Program Files\PostgreSQL\16\{lib,share/extension,include/server/extension}`.

### Why no Redis

For solo-laptop hackathon scale, in-process state is plenty:
- Rate limit token bucket in `Map<string, Bucket>`.
- Refresh-token replay defense in Postgres (revoke + rotate columns).
- WebSocket fan-out via in-process bus (no horizontal scaling needed).
- AI response cache via `Map` with TTL.

When this needs to scale, we add Redis without changing call sites — the public surfaces of `rateLimit`, `bus`, `ws-broadcaster` stay the same.

## API stack

### Hono 4.6.16

Lightweight, fast, edge-ready, type-safe routing.

- Beat Express on bundle size and TypeScript ergonomics.
- Beat Fastify because Hono's middleware model is simpler and `c.set('user', ...)` plus `declare module 'hono' { interface ContextVariableMap { user: AuthedUser } }` gives full type safety on context vars.
- Mounting routers (`app.route('/auth', authRoutes)`) keeps `index.ts` to ~110 lines even with 14 sub-routers.

### Drizzle ORM 0.38.4 + drizzle-kit 0.30.2

Type-safe SQL with a Drizzle-shaped DSL.

- Beat Prisma on Bun startup time and on the ability to cleanly express composite indexes, partial indexes, and `gin` / `ivfflat` index types via `index().using('gin', sql`...`)` plus a hand-written migration line for the parts Drizzle can't yet emit.
- The `customType` API lets us declare `numeric(14,2)` with `data: number` so amounts surface as JS numbers, while pgvector becomes `vector(1536)` with `toDriver`/`fromDriver` codecs.
- Migrations are SQL files we read and edit by hand when needed (cyclic FK fix in `0001`, unique index in `0002`).

### postgres-js 3.4.5

Connection pool driver. `prepare: false` because we use Drizzle's parameterised query path. `onnotice: () => undefined` to silence pgvector's verbose extension load chatter.

### jose 5.9.6

JWT signing/verifying. HS256, two distinct secrets (`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`) so a leak of one can't mint the other.

### Zod 3.24.1

Runtime validation. Used in three places:
1. `apps/api/src/env.ts` — strict env schema with helpful error messages.
2. `packages/shared/src/schemas/*.ts` — every wire shape (auth, transaction, wallet, budget, goal, ledger, copilot).
3. `@hono/zod-validator` middleware — `zValidator('json', schema)` parses bodies and produces the typed `c.req.valid('json')` accessor.

### OpenAI Node SDK 4.77.0

The complete model map (mirrors the design doc):

| Job | Model env var | Live (Azure deployment) |
| --- | --- | --- |
| Voice transcription | `OPENAI_TRANSCRIPTION_MODEL` | MAI-Transcribe-1.5 (en) / Sarvam `saaras:v3` (Indic); `gpt-4o-transcribe` fallback |
| Receipt vision | `OPENAI_VISION_MODEL` | `gpt-5.4-nano` |
| Expense parser | `OPENAI_PARSE_MODEL` | `gpt-5.4-nano` |
| Intent NLU | `OPENAI_NLU_MODEL` | `gpt-5.4-nano` |
| Copilot chat | `OPENAI_CHAT_MODEL` | `gpt-5.4-nano` |
| Translate | `OPENAI_TRANSLATE_MODEL` | `gpt-5.4-nano` (Sarvam Mayura primary in bot) |
| Embeddings | `OPENAI_EMBED_MODEL` | `Cohere-embed-v3-multilingual` (1024-dim) |
| TTS (all languages) | `SARVAM_TTS_MODEL` | Sarvam `bulbul:v3` (speaker `kabir`) |
| TTS fallback | `OPENAI_TTS_MODEL` / `OPENAI_AUDIO_MODEL` | `gpt-4o-mini-tts` / `gpt-4o-audio-preview` |

### `@huggingface/transformers` 3.3.3

In-process ONNX runtime for the fine-tuned MiniLM categorizer. CPU inference, ~30 MB resident when loaded. Lazy-loaded on first call; sticky-null on failure (we don't retry on every transaction insert).

## Web stack (planned, foundation in place)

### SvelteKit (Svelte 5 + runes) on Vite 6

- Beat React because Svelte 5 runes deliver smaller bundles, the SvelteKit file-based router is simpler than Next.js or React Router 7, and the `svelte-kit sync` step gives us first-class typed routes for free.
- Adapter: `@sveltejs/adapter-node` so we can host on Bun later (and on any Node-compatible PaaS in between).

### Tailwind v4 (beta) + shadcn-svelte

- Tailwind v4 collapses the PostCSS pipeline. `@tailwindcss/vite` plugin, no `tailwind.config.js` required at minimum.
- `bits-ui` powers the shadcn-svelte primitives (Button, Dialog, Drawer, Sheet, Command, Popover, Select, Tabs, Toast, Tooltip).
- `tailwind-variants` for component variants, `class-variance-authority`-style API.
- `lucide-svelte` for icons.
- `mode-watcher` for system-respecting dark mode without flicker.

### Vercel AI SDK (planned)

For the copilot panel: streams the API's `/copilot/chat` SSE response into a Svelte component with token-by-token rendering. Beat raw `EventSource` because the SDK handles retries, abort, and tool-result UI primitives.

### `@huggingface/transformers` 3.3.3 (also in web)

For privacy mode. Same package as the API, runs in the browser via WebAssembly. Tokenizer + model live under `apps/web/static/models/`; downloaded to IndexedDB on first toggle.

## WhatsApp bot stack

### whatsapp-web.js 1.34.7

Browser automation against WhatsApp Web. Demo-grade only; production would swap to the official WhatsApp Cloud API.

- Persists session in `.wwebjs_auth/` so restarts skip the QR scan.
- Pairs by scanning a QR shown both in the terminal and on a `/qr` HTML page (auto-refreshes every 5s).
- Supports `LocalAuth`, voice notes, images, group skipping, allowlist gating.

### Hono 4.6.16 (also in bot)

The bot exposes a small internal HTTP server (port 5001) for the API to call back into:
- `/health` — liveness
- `/qr`, `/qr.png` — QR pairing UI
- `/send` — push messages from API (e.g., budget alerts)
- `/broadcast/*` — fan-out endpoints
- `/simulator/*` — drive the conversation engine without a real WhatsApp client (for tests)

### qrcode + qrcode-terminal

Two QR renderers: terminal (ASCII) for CLI, PNG for the web page.

### Why a custom supervisor (planned)

- whatsapp-web.js sometimes leaves orphan Chromium processes after a crash.
- Restart loop with exponential backoff (1s, 5s, 30s, 5m caps).
- Health probe + PID cleanup before respawn.

## Shared package

### `packages/shared` workspace dep

Imported as `@versifine/shared` from all three apps via Bun workspace symlinks. Exports:
- `categories` (23 expense categories with display metadata)
- `currencies` (9 currencies with symbols and aliases)
- `languages` (6 languages with native names, BCP-47 tags, script regexes, sibling-script lists)
- `intents` (the 15-item intent enum)
- `events` (discriminated union for WS payloads with `seq`/`entityId`/`ts`)
- `schemas/*` (Zod parsers for every wire shape: auth, transaction, wallet, budget, goal, ledger, copilot)

Single source of truth means a schema change is one PR that propagates everywhere.

## Tooling

### Biome 1.9.4

Replaces ESLint + Prettier in one binary. Faster, simpler config, identical formatting rules in this project (single quotes, trailing commas, 100-col line width, 2-space indent, LF endings).

### concurrently 9.1.2

Drives `bun run dev` from the repo root: runs `apps/api/dev`, `apps/web/dev`, `apps/wa-bot/dev` in parallel with named, color-coded log streams. `--kill-others` so a crash in one stops everything.

### winget (Windows)

Installed PostgreSQL 16 silently. Fully scriptable.

## Versions locked

```
runtime:
  bun: 1.3.14
  typescript: 5.7.3
  postgresql: 16.14
  pgvector: 0.8.2

api:
  hono: 4.6.16
  drizzle-orm: 0.38.4
  drizzle-kit: 0.30.2
  postgres: 3.4.5
  jose: 5.9.6
  zod: 3.24.1
  openai: 4.77.0
  @huggingface/transformers: 3.3.3
  @hono/zod-validator: 0.4.2
  @scalar/hono-api-reference: 0.5.166

web (foundation):
  svelte: 5.16+
  @sveltejs/kit: 2.15+
  @sveltejs/adapter-node: 5.2+
  vite: 6.0+
  tailwindcss: 4.0.0-beta
  bits-ui: 1.0+
  tailwind-variants: 0.3+
  lucide-svelte: 0.469+
  mode-watcher: 0.5+

wa-bot:
  whatsapp-web.js: 1.34.7
  hono: 4.6.16
  openai: 4.77.0
  qrcode: 1.5.4
  qrcode-terminal: 0.12.0
  zod: 3.24.1

dev:
  @biomejs/biome: 1.9.4
  concurrently: 9.1.2
```

## What we deliberately are NOT using

| Tech | Why not |
| --- | --- |
| **Docker / docker-compose** | User explicitly said no Docker for now. Native Postgres install via winget. |
| **Prisma** | Drizzle is faster on Bun, supports our index types more cleanly, and avoids the Prisma engine binary. |
| **Express** | Hono is faster, smaller, type-safer, and ships the same middleware ergonomics. |
| **Fastify** | Hono's plugin model is more direct; we don't need Fastify's logger/serializer features. |
| **NextAuth / Auth.js** | Hand-rolled JWT in 200 lines is cleaner than dragging in a framework that doesn't fit a Hono stack. |
| **TanStack Start / Next.js** | SvelteKit on Bun is the better story for this team. |
| **React** | Svelte 5 with runes is smaller, simpler, and the bundle is half the size for this UI. |
| **Redux / Zustand / Jotai** | Svelte 5 runes provide the same reactivity primitives natively. TanStack Query handles server state. |
| **Mocha / Jest / Vitest** | Bun's built-in test runner is faster and zero-config for TypeScript. |
| **GraphQL** | All clients are first-party and benefit more from Zod-typed REST + WS than from a query layer. |
| **Sentry, Datadog, OpenTelemetry** | Hackathon scope. Structured JSON logs with request_id are enough for now. |
| **Bullmq / Inngest / Trigger.dev** | Background jobs are tiny (embedding queue is a Promise chain). When it grows, we add Bullmq. |
| **Telegram bot** | Repo 2's killer feature, dropped because the user explicitly chose WhatsApp. |
| **Sarvam AI** | OpenAI's audio model handles ta/ml well enough; one less integration. |

## Why this stack wins for a hackathon

- **One language end-to-end (TypeScript).** No Python/Node split. Same Zod schemas in every workspace.
- **Native Postgres** + native Bun = faster cold starts, no Docker daemon to fight on demo day.
- **MiniLM in-process** = the killer "AI runs on your laptop" demo line, no separate inference server.
- **Single binary, single port per app**: `bun src/index.ts` boots the API on `:5000` with HTTP + WS together. The bot is similarly self-contained.
- **No container orchestration, no service mesh, no message bus** — every cross-process channel is one HTTP call or a typed WS event. Easy to reason about, easy to demo.
