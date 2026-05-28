# 02 · Architecture

## System shape

Three Bun-runtime apps share one Postgres + pgvector database. One shared TypeScript package supplies Zod schemas, enums, and event types so every wire shape has a single definition.

```
                                          ┌──────────────────────┐
                                          │   packages/shared    │
                                          │  Zod schemas, enums  │
                                          │  events, intents,    │
                                          │  categories, langs   │
                                          └────────┬─────────────┘
                                                   │
              ┌────────────────────┬───────────────┼──────────────────┐
              │                    │               │                  │
              ▼                    ▼               ▼                  ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  (used in tests)
   │   apps/api       │  │   apps/wa-bot    │  │    apps/web      │
   │ Hono · Drizzle   │  │ whatsapp-web.js  │  │  SvelteKit       │
   │ JWT · OpenAI     │  │ Hono internal    │  │ shadcn-svelte    │
   │ MiniLM (Phase 3) │  │ OpenAI · Whisper │  │ TanStack Query   │
   │ pgvector         │  │ TTS · supervisor │  │ Vercel AI SDK    │
   │ WebSocket server │  │ multilingual     │  │ PWA · MiniLM-web │
   └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
            │ HTTP + WS           │ HTTP                │ HTTP + WS
            │                     │ X-Bot-Secret        │
            │                     │ X-Phone             │
            ▼                     ▼                     │
   ┌──────────────────────────────────────────────────────────────┐
   │                  Postgres 16 + pgvector 0.8.2                │
   │  finehance_dev (live)   ·   finehance_test (CI)              │
   └──────────────────────────────────────────────────────────────┘

(There is no Redis, no Docker, no separate ML server. The MiniLM model
runs in-process inside `apps/api` via Transformers.js ONNX runtime.)
```

## Boundary rules

1. **The API is the only writer to the database.** The bot never touches Postgres directly. Every bot action is a typed HTTP call into the API, signed with `X-Bot-Secret` + `X-Phone`. This keeps a single ingress for auth, validation, FX, categorization, embedding, and event emission.
2. **Every owned row carries `space_id`.** Even though the MVP only ever has one personal space per user, every query filters by `space_id`. `space_members` table exists but is empty; v2 will populate it without a migration.
3. **`packages/shared` is the wire contract.** Zod schemas validate every body crossing the network. The web client, the bot, and the API all `import { ... } from '@finehance/shared'`.
4. **Server-Sent Events for streaming, WebSocket for fan-out.** Copilot answers are SSE because they're a one-way response. WS is for live broadcasts (transaction.created, budget.warning, etc.) initiated server-side without a request.
5. **No browser secrets.** The web app holds the access JWT. Refresh tokens live in `localStorage` (acceptable for MVP; v2 should move to httpOnly cookies). The OpenAI key is only on the API server.

## Apps in detail

### `apps/api` — the brain

```
src/
├── index.ts                  Bun.serve entry; mounts Hono + WS upgrader
├── env.ts                    Zod-validated env, single source of truth
├── db/
│   ├── client.ts             postgres-js + Drizzle, pool=10
│   ├── migrations/           0000_init, 0001_cyclic_fk, 0002_unique_overrides
│   └── schema/
│       ├── users.ts          users, phone_link_otps, refresh_tokens
│       ├── spaces.ts         spaces, space_members
│       ├── wallets.ts        wallets
│       ├── transactions.ts   transactions
│       ├── overrides.ts      category_overrides, category_corrections
│       ├── embeddings.ts     transaction_embeddings (pgvector(1536))
│       ├── budgets.ts        budgets
│       ├── goals.ts          goals
│       ├── ledger.ts         ledger_entries, ledger_settlements
│       ├── recurring.ts      recurring_items
│       └── fx.ts             fx_rates
├── middleware/
│   ├── requestId.ts          x-request-id propagation, child logger
│   ├── error.ts              uniform envelope, ZodError → 400
│   ├── auth.ts               requireUser (JWT), requireBot (secret+phone)
│   ├── authEither.ts         either path, used by capture
│   └── rateLimit.ts          in-memory token bucket (auth/capture/copilot)
├── routes/                   14 mounted routers
│   ├── health.ts             /health (liveness), /health/ready (DB pong)
│   ├── auth.ts               register, login, refresh, logout, me, phone-link
│   ├── capture.ts            text, voice, image, confirm
│   ├── transactions.ts       CRUD + CSV import + export + correction
│   ├── wallets.ts            CRUD + transfer
│   ├── budgets.ts            CRUD + progress
│   ├── goals.ts              CRUD + progress
│   ├── ledger.ts             CRUD + settlement
│   ├── recurring.ts          list, run, dismiss
│   ├── forecast.ts           GET /forecast?days=30
│   ├── reports.ts            summary JSON + CSV
│   ├── advice.ts             ranked advice items
│   ├── copilot.ts            POST /copilot/chat (SSE)
│   └── ws.ts                 GET /ws (subprotocol bearer auth)
└── services/                 organized by domain
    ├── auth/                 jwt, password (bcrypt), otp
    ├── ai/                   client, transcribe, vision, intent, parser, parserRegex,
    │                         translate, embed, advice, copilotTools
    ├── categorize/           index (4-tier), minilm (ONNX), merchants, overrides, _safe
    ├── capture/              drafts (in-mem TTL), persist, queryStubs, wallet picker
    ├── transactions/         create, transfer, query, normalize, embed (background)
    ├── budgets/              CRUD + progress + alert recompute
    ├── goals/                CRUD + projection
    ├── ledger/               CRUD + settlement (atomic)
    ├── forecast/             arima, recurring, anomaly, index (orchestrator + cache)
    ├── reports/              summary
    ├── fx/                   client (6h cache), convert
    └── events/               bus (in-process emitter), ws (per-user fan-out)
```

### `apps/wa-bot` — the WhatsApp bridge (in progress)

```
src/
├── config.ts                 Zod-validated bot env
├── types.ts                  ConversationState, Session, OutgoingReply
├── services/ai/
│   ├── client.ts             lazy OpenAI singleton + withLatency
│   ├── transcribe.ts         gpt-4o-transcribe → whisper-1 fallback
│   ├── tts.ts                gpt-4o-mini-tts (en/hi/kn/te) → tts-1 fallback
│   ├── indicSpeech.ts        gpt-4o-audio-preview for ta/ml combined
│   └── translate.ts          gpt-4o-mini for ta/te/kn with sibling validation
└── utils/
    ├── logger.ts             structured JSON, phone masking
    ├── phone.ts              normalize, allowlist
    ├── retry.ts              exponential backoff
    └── text.ts               universal commands (6 langs), parseLink, chunkText
```

**Still to write**: `index.ts`, `supervisor.ts`, `openwa/{createClient,handlers,media,sharedClient}.ts`, `server/internalServer.ts`, `services/apiClient.ts`, `conversations/{engine,state}.ts`, `conversations/messages/{en,hi,ml,index}.ts`, `conversations/flows/{identity,link,capture,confirm,query,budget,correct,help}.ts`.

### `apps/web` — the SvelteKit dashboard (foundation only)

```
src/
├── app.html                  SvelteKit shell
├── app.css                   Tailwind v4 entry + shadcn-svelte CSS vars
├── app.d.ts                  $env types
└── lib/
    ├── config.ts             env-driven public config (PUBLIC_API_URL, etc.)
    └── utils/
        ├── cn.ts             classnames merge for shadcn variants
        └── format.ts         currency/date/number helpers
static/
├── favicon.svg
├── manifest.webmanifest
└── models/                   tokenizer + label_map + manifest fetched
```

**Still to write**: every route, every store, every component, the omnibar, the copilot panel, the privacy mode loader, the PWA service worker, the IndexedDB offline queue.

## Request lifecycle (web → API)

```
Browser sends:
  POST /capture/text
  Authorization: Bearer eyJ...
  Content-Type: application/json
  { "text": "spent 450 on auto" }

API:
  1. Bun.serve.fetch hits the WS-or-Hono dispatcher in index.ts
  2. Hono pipeline:
     a. requestId middleware: assigns x-request-id, attaches child logger
     b. errorMiddleware: wraps next() in try/catch with envelope
     c. CORS
     d. captureRoutes mounted at /capture
  3. Inside captureRoutes:
     a. requireUserOrBot middleware verifies JWT (bot path skipped — no secret)
     b. captureLimit middleware: token bucket on user id
     c. zValidator parses body via captureTextInput
     d. classifyIntent (gpt-4o-mini, JSON mode, cache 60s)
     e. parseExpense (gpt-5-mini + regex extractors, currency-aware)
     f. listLiveWallets + pickWallet
     g. If confidence ≥ 0.6 + has amount + has description + wallet: persistDraft
     h. persistDraft → createTransaction (services/transactions/create.ts):
        - validate wallet in space
        - normalize merchant
        - categorize (overrides → merchants → MiniLM → default)
        - FX rate (6h cache)
        - insert row
        - emit transaction.created on event bus
        - fire-and-forget budget recompute
     i. If confidence low: storeDraft → return draftId for confirmation
  4. Response shape: { success: true, data: { intent, needsConfirmation,
     queryResult: { transaction }, echo } }
  5. Event bus broadcasts transaction.created to every WS socket for that user

Browser:
  - TanStack Query mutation receives the response, optimistically updates list
  - Existing WS handler also receives transaction.created event, dedupes by entity_id
```

## Request lifecycle (WhatsApp → API)

```
WhatsApp:
  User sends "spent 450 on auto" to the paired bot number

apps/wa-bot:
  1. whatsapp-web.js client emits 'message' event
  2. handlers.ts routes by sender phone, checks allowlist
  3. Voice messages: download audio buffer → transcribe.ts → text
  4. Image messages: download bytes → POST /capture/image
  5. Text messages: POST /capture/text with X-Bot-Secret + X-Phone
  6. API replies with the same envelope shape as the web path
  7. apiClient.ts maps the response to a localized reply string
  8. translate.ts (if ta/te/kn) translates the reply
  9. tts.ts or indicSpeech.ts synthesizes a voice note
  10. Two-pass send: text bubble first (instant), voice note second (await)
  11. WS broadcaster also fires transaction.created — open web tabs update live
```

## Why these boundaries

- **API as sole writer**: prevents the bot from drifting in validation rules; keeps category_corrections and embedding upserts in one place; lets us swap whatsapp-web.js for the official Cloud API later without touching domain logic.
- **`space_id` everywhere**: zero migration cost when household spaces ship.
- **In-process MiniLM**: no extra service, no IPC, ~30 MB resident, sub-millisecond inference. The price is one extra build step (ONNX export) the first time.
- **Postgres for everything**: one engine, one set of operational concerns. Postgres LISTEN/NOTIFY would cover most of WebSocket fan-out's role, but native WS keeps the latency lower and lets us pass typed payloads.
- **Single Bun.serve listening on /ws and /…**: one TCP port, one CORS config, one TLS cert in production.

## Cross-cutting behaviors

- **Logging**: structured JSON, one line per event, request id propagated. Phones and emails are masked in logs at info level; raw values only at debug.
- **Errors**: every thrown error becomes `{ success: false, error: { code, message, details? } }`. Status codes from `AppError`; ZodErrors become 400 + field errors; everything else is 500 + generic message + stack in logs.
- **Rate limits**: in-memory token bucket with three presets (auth, capture, copilot) keyed by user id (or IP for unauth).
- **FX**: 6-hour DB-backed cache (`fx_rates` table). On miss, fetch from `open.er-api.com`, cache, return. On upstream failure, transaction stores `needs_fx_resolution=true` and a background sweeper resolves later.
- **Categorization personalization**: every user-driven category change writes a `category_corrections` row + upserts a `category_overrides` row. Every future transaction with the same normalized merchant gets the corrected label instantly.
- **Forecast invalidation**: any `transaction.*` event triggers `invalidateForecast(spaceId)` so the next /forecast call recomputes.

## Where to look when something breaks

| Symptom | First place to look |
| --- | --- |
| API won't boot | `apps/api/src/env.ts` (Zod validation prints field errors). |
| 401 on every request | JWT_ACCESS_SECRET in `.env` shorter than 16 chars, or token expired. |
| 500 on POST /capture/text | OPENAI_API_KEY unset or quota exhausted. Check `AI_CALL_FAIL` log lines. |
| Capture creates transaction but no WS event | Subscribe in client; check `WS_ATTACH` and `WS_SEND_FAIL` log lines. |
| Categorize returns Other | ONNX siblings missing → MiniLM tier silently drops. Run conversion script. |
| Migration error | `bun run db:reset` (drops + reapplies) or `db:init` (full nuke). |
| Test fails with "DATABASE_URL: Required" | `bun test` doesn't auto-load `.env`. Use `bun --env-file=../../.env test`. |

More: [13-issues.md](./13-issues.md) for the full diagnostic table.
