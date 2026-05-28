# Finehance — Design

## Overview

Finehance is built as a Bun-based monorepo with three apps (`web`, `api`, `wa-bot`) and one shared package, all sharing the same Postgres + PgVector database. The API is the single source of truth for parsing, categorization, persistence, and broadcasting. Both the Svelte web dashboard and the WhatsApp bot are dumb capture/render clients that go through the API. The user's fine-tuned MiniLM categorizer (`CyberKunju/finehance-categorizer-minilm`) runs in-process via Transformers.js (ONNX) inside the API for server-side categorization, and is also shipped to the browser for an optional Privacy Mode where categorization happens locally. OpenAI provides the LLM, voice (Whisper / gpt-4o-transcribe), TTS (gpt-4o-mini-tts and gpt-4o-audio-preview), embeddings, and vision capabilities.

This design covers the system architecture, repository layout, database schema, API surface, capture pipeline, categorization tiers, forecast algorithm, copilot RAG, WhatsApp bot internals, web app architecture, real-time flow, AI service contract, auth, error handling, logging, testing, seed strategy, and risk register.

## Architecture

### System overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   ┌──────────────────────────┐         ┌────────────────────────────┐    │
│   │  apps/web                │         │  apps/wa-bot               │    │
│   │  SvelteKit · Svelte 5    │         │  Bun · whatsapp-web.js     │    │
│   │  shadcn-svelte · Layer-  │         │  Hono internal HTTP :5001  │    │
│   │  chart · TanStack Query  │         │  Supervisor + watchdog     │    │
│   │  Vercel AI SDK · WS      │         │  QR pairing page           │    │
│   │  PWA + Privacy Mode      │         │                            │    │
│   └────────────┬─────────────┘         └──────────────┬─────────────┘    │
│                │ HTTPS / WS                            │ HTTP             │
│                ▼                                       ▼                  │
│         ┌──────────────────────────────────────────────────────┐         │
│         │  apps/api                                             │         │
│         │  Bun · Hono · Drizzle · Zod · JWT · WS server         │         │
│         │                                                       │         │
│         │  ┌─────────────────────────────────────────────────┐  │         │
│         │  │  Routes: /auth /capture /transactions /budgets  │  │         │
│         │  │          /goals /forecast /copilot /reports     │  │         │
│         │  │          /wallets /ledger /recurring /ws        │  │         │
│         │  └─────────────────────────────────────────────────┘  │         │
│         │                                                       │         │
│         │  Services: parse · categorize · MiniLM · embed · RAG  │         │
│         │            recurring · forecast · advice · fx · auth  │         │
│         │                                                       │         │
│         │  In-process: Transformers.js (MiniLM ONNX, CPU)       │         │
│         │  External: OpenAI (chat/transcribe/tts/audio/vision)  │         │
│         └─────────┬─────────────────────────────────┬─────────┘          │
│                   │                                 │                     │
│                   ▼                                 ▼                     │
│         ┌─────────────────────┐         ┌─────────────────────┐          │
│         │  Postgres 16        │         │  packages/shared    │          │
│         │  + PgVector         │         │  Zod schemas        │          │
│         │                     │         │  Categories         │          │
│         │  Drizzle migrations │         │  AI service helpers │          │
│         └─────────────────────┘         └─────────────────────┘          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Core invariants

- One brain (`apps/api`) is the single source of truth for parsing, categorization, persistence, and broadcasting.
- Both `apps/web` and `apps/wa-bot` are dumb capture/render clients. The bot never touches the database directly.
- Every owned row has `space_id`. Every query filters by it.
- Every state change broadcasts a typed event over WebSockets.

---

## 2. Repository layout (Bun workspaces)

## Components and Interfaces

The following sections enumerate the components, their boundaries, and the interfaces between them. The repository layout in § 2 maps directly to the architectural components: `packages/shared` is the shared interface contract (Zod schemas, types, event definitions), `apps/api` exposes HTTP + WebSocket interfaces (§ 4), `apps/wa-bot` exposes a small internal HTTP interface for the API to call (§ 9), and `apps/web` consumes the API. The capture pipeline (§ 5) is the cross-component contract that text/voice/image inputs must satisfy regardless of origin.

```
finehance/
├── package.json                        # root, defines workspaces
├── bun.lockb                           # single lockfile
├── biome.json                          # lint+format
├── docker-compose.yml                  # Postgres only
├── .env.example                        # documented env template
├── README.md                           # 60-second setup
│
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── schemas/                # Zod schemas (one file per domain)
│       │   │   ├── auth.ts
│       │   │   ├── transaction.ts
│       │   │   ├── budget.ts
│       │   │   ├── goal.ts
│       │   │   ├── wallet.ts
│       │   │   ├── ledger.ts
│       │   │   └── copilot.ts
│       │   ├── categories.ts           # 23 model categories + display metadata
│       │   ├── currencies.ts           # supported currencies + symbols
│       │   ├── languages.ts            # the 6 langs + display metadata
│       │   ├── intents.ts              # intent enum + helpers
│       │   ├── events.ts               # WS event types
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts                # Hono app entry
│   │   │   ├── env.ts                  # validated env via Zod
│   │   │   ├── db/
│   │   │   │   ├── client.ts           # Drizzle + Postgres pool
│   │   │   │   ├── schema/             # Drizzle table definitions
│   │   │   │   │   ├── users.ts
│   │   │   │   │   ├── spaces.ts
│   │   │   │   │   ├── wallets.ts
│   │   │   │   │   ├── transactions.ts
│   │   │   │   │   ├── budgets.ts
│   │   │   │   │   ├── goals.ts
│   │   │   │   │   ├── ledger.ts
│   │   │   │   │   ├── recurring.ts
│   │   │   │   │   ├── overrides.ts
│   │   │   │   │   ├── embeddings.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── migrations/
│   │   │   │   └── seed.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── capture.ts
│   │   │   │   ├── transactions.ts
│   │   │   │   ├── wallets.ts
│   │   │   │   ├── budgets.ts
│   │   │   │   ├── goals.ts
│   │   │   │   ├── ledger.ts
│   │   │   │   ├── recurring.ts
│   │   │   │   ├── forecast.ts
│   │   │   │   ├── copilot.ts
│   │   │   │   ├── reports.ts
│   │   │   │   ├── ws.ts
│   │   │   │   ├── settings.ts
│   │   │   │   └── health.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts             # JWT verify + space resolution
│   │   │   │   ├── rateLimit.ts        # in-memory token bucket
│   │   │   │   ├── error.ts            # uniform error envelope
│   │   │   │   └── requestId.ts
│   │   │   ├── services/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── jwt.ts
│   │   │   │   │   ├── password.ts
│   │   │   │   │   └── otp.ts
│   │   │   │   ├── ai/
│   │   │   │   │   ├── client.ts       # shared OpenAI client
│   │   │   │   │   ├── parser.ts       # text/voice/image → structured
│   │   │   │   │   ├── intent.ts       # NLU classifier
│   │   │   │   │   ├── transcribe.ts
│   │   │   │   │   ├── vision.ts       # receipt OCR
│   │   │   │   │   ├── translate.ts
│   │   │   │   │   ├── tts.ts
│   │   │   │   │   ├── indicSpeech.ts  # gpt-4o-audio-preview ta/ml
│   │   │   │   │   ├── embed.ts
│   │   │   │   │   ├── advice.ts
│   │   │   │   │   └── copilotTools.ts # tool functions exposed to LLM
│   │   │   │   ├── categorize/
│   │   │   │   │   ├── minilm.ts       # Transformers.js inference
│   │   │   │   │   ├── overrides.ts
│   │   │   │   │   ├── merchants.ts    # global merchant DB
│   │   │   │   │   └── index.ts        # tier resolver
│   │   │   │   ├── transactions/
│   │   │   │   │   ├── create.ts
│   │   │   │   │   ├── transfer.ts
│   │   │   │   │   ├── query.ts
│   │   │   │   │   └── normalize.ts
│   │   │   │   ├── forecast/
│   │   │   │   │   ├── arima.ts        # in-house ARIMA(1,1,1)
│   │   │   │   │   ├── recurring.ts    # detector
│   │   │   │   │   ├── anomaly.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── budgets/
│   │   │   │   ├── goals/
│   │   │   │   ├── reports/
│   │   │   │   ├── fx/
│   │   │   │   │   ├── client.ts       # exchangerate.host with 6h cache
│   │   │   │   │   └── convert.ts
│   │   │   │   ├── events/
│   │   │   │   │   ├── bus.ts          # local event emitter
│   │   │   │   │   └── ws.ts           # broadcaster
│   │   │   │   └── ledger/
│   │   │   ├── data/
│   │   │   │   ├── merchants.json      # curated India-first merchant DB (~300 entries)
│   │   │   │   └── seed-fixtures.ts    # demo seed
│   │   │   ├── ml/
│   │   │   │   ├── model/              # downloaded ONNX MiniLM
│   │   │   │   └── README.md           # how to fetch/convert
│   │   │   └── utils/
│   │   ├── tests/
│   │   ├── scripts/
│   │   │   ├── convert-minilm-to-onnx.ts
│   │   │   ├── verify-env.ts
│   │   │   └── reset-demo.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── wa-bot/
│   │   ├── src/
│   │   │   ├── index.ts                # entry: spawns supervisor or boots
│   │   │   ├── supervisor.ts           # crash-loop detection + orphan-Chrome cleanup
│   │   │   ├── env.ts
│   │   │   ├── types.ts                # session, conversation states
│   │   │   ├── conversations/
│   │   │   │   ├── engine.ts
│   │   │   │   ├── state.ts            # in-memory session map
│   │   │   │   ├── messages/
│   │   │   │   │   ├── en.ts           # hand-translated pack
│   │   │   │   │   ├── hi.ts
│   │   │   │   │   ├── ml.ts
│   │   │   │   │   └── index.ts
│   │   │   │   └── flows/
│   │   │   │       ├── identity.ts     # greeting → language → link
│   │   │   │       ├── link.ts         # phone↔account linking
│   │   │   │       ├── capture.ts      # text/voice/image dispatch
│   │   │   │       ├── confirm.ts      # transaction confirmation
│   │   │   │       ├── query.ts        # spending/summary/forecast
│   │   │   │       ├── budget.ts       # set/list budgets
│   │   │   │       ├── correct.ts      # category correction
│   │   │   │       └── help.ts
│   │   │   ├── openwa/                 # whatsapp-web.js client + handlers
│   │   │   │   ├── createClient.ts
│   │   │   │   ├── handlers.ts
│   │   │   │   ├── media.ts
│   │   │   │   └── sharedClient.ts
│   │   │   ├── server/
│   │   │   │   └── internalServer.ts   # Hono on :5001
│   │   │   ├── services/
│   │   │   │   ├── apiClient.ts        # talks to apps/api
│   │   │   │   ├── transcribe.ts       # OpenAI Whisper wrapper
│   │   │   │   ├── tts.ts              # OpenAI TTS wrapper
│   │   │   │   ├── indicSpeech.ts      # ta/ml combined audio
│   │   │   │   ├── translate.ts
│   │   │   │   └── intent.ts           # forwards to API or runs locally
│   │   │   └── utils/
│   │   │       ├── logger.ts
│   │   │       ├── phone.ts            # ported
│   │   │       └── text.ts             # ported
│   │   ├── scripts/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/
│       ├── src/
│       │   ├── app.html
│       │   ├── app.css
│       │   ├── service-worker.ts       # PWA
│       │   ├── lib/
│       │   │   ├── api/
│       │   │   │   ├── client.ts       # fetch + JWT
│       │   │   │   ├── ws.ts
│       │   │   │   └── queries.ts      # TanStack Query hooks
│       │   │   ├── stores/
│       │   │   │   ├── auth.svelte.ts
│       │   │   │   ├── settings.svelte.ts
│       │   │   │   └── pendingCaptures.svelte.ts
│       │   │   ├── ai/
│       │   │   │   └── minilm-client.ts # Transformers.js (Privacy Mode)
│       │   │   ├── components/
│       │   │   │   ├── ui/             # shadcn-svelte primitives
│       │   │   │   ├── layout/
│       │   │   │   │   ├── Sidebar.svelte
│       │   │   │   │   ├── Topbar.svelte
│       │   │   │   │   └── CommandMenu.svelte
│       │   │   │   ├── omnibar/
│       │   │   │   │   ├── Omnibar.svelte
│       │   │   │   │   ├── VoiceCapture.svelte
│       │   │   │   │   └── ImageDrop.svelte
│       │   │   │   ├── transactions/
│       │   │   │   ├── budgets/
│       │   │   │   ├── goals/
│       │   │   │   ├── forecast/
│       │   │   │   │   └── ForecastCard.svelte
│       │   │   │   ├── copilot/
│       │   │   │   │   ├── CopilotPanel.svelte
│       │   │   │   │   └── MessageBubble.svelte
│       │   │   │   └── settings/
│       │   │   │       └── PrivacyMode.svelte
│       │   │   └── i18n/
│       │   │       ├── en.ts
│       │   │       ├── hi.ts
│       │   │       ├── ml.ts
│       │   │       └── index.ts
│       │   ├── routes/
│       │   │   ├── +layout.svelte      # auth gate, theme, sidebar
│       │   │   ├── +layout.ts          # initial data load
│       │   │   ├── +page.svelte        # dashboard
│       │   │   ├── login/
│       │   │   ├── register/
│       │   │   ├── transactions/
│       │   │   ├── budgets/
│       │   │   ├── goals/
│       │   │   ├── forecast/
│       │   │   ├── reports/
│       │   │   ├── settings/
│       │   │   └── api/                # SvelteKit BFF for SSR auth
│       │   └── service-worker.ts
│       ├── static/
│       │   ├── icons/
│       │   ├── manifest.webmanifest
│       │   └── models/                  # ONNX MiniLM for privacy mode
│       ├── package.json
│       ├── svelte.config.js
│       ├── tailwind.config.ts
│       ├── vite.config.ts
│       └── tsconfig.json
```

---

## 3. Database schema (Drizzle / Postgres + PgVector)

## Data Models

The data model is described in detail in § 3 below. Summary of entities and ownership:

- **Identity**: `users`, `phone_link_otps`, `refresh_tokens`
- **Tenancy**: `spaces`, `space_members` (every owned row has `space_id`)
- **Money containers**: `wallets`
- **Movements**: `transactions`, `transaction_embeddings` (PgVector for RAG)
- **Personalization**: `category_overrides`, `category_corrections`
- **Plans**: `budgets`, `goals`
- **Relationships**: `ledger_entries`, `ledger_settlements`
- **Detection**: `recurring_items`
- **Reference**: `fx_rates`

### Conventions

- All ids: `uuid` default `gen_random_uuid()`
- All timestamps: `timestamptz`, `created_at` and `updated_at` non-null
- Soft delete: `deleted_at` nullable; queries filter `deleted_at IS NULL` by default
- Money: `numeric(14,2)` always positive; sign comes from `type`
- Currency: `char(3)` ISO 4217
- `space_id` on every owned table

### Tables

```sql
-- Identity
users(
  id uuid pk,
  email citext unique not null,
  password_hash text not null,
  display_name text,
  primary_language text not null default 'en',  -- en | hi | ml | ta | te | kn
  base_currency char(3) not null default 'INR',
  active_space_id uuid references spaces(id),
  whatsapp_phone text,                           -- normalized digits
  whatsapp_phone_verified_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  deleted_at timestamptz
)
unique_index(whatsapp_phone) where whatsapp_phone is not null

phone_link_otps(
  id uuid pk,
  user_id uuid fk users.id on delete cascade,
  code text not null,                            -- 6 digits
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz
)

refresh_tokens(
  id uuid pk,
  user_id uuid fk users.id on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)

-- Spaces
spaces(
  id uuid pk,
  name text not null,
  type text not null check(type in ('personal','household','business')),
  base_currency char(3) not null default 'INR',
  created_by uuid fk users.id,
  created_at timestamptz, updated_at timestamptz
)

space_members(
  space_id uuid fk spaces.id on delete cascade,
  user_id uuid fk users.id on delete cascade,
  role text not null check(role in ('owner','editor','viewer')),
  joined_at timestamptz,
  primary key(space_id, user_id)
)

-- Wallets
wallets(
  id uuid pk,
  space_id uuid fk spaces.id on delete cascade,
  name text not null,
  type text not null check(type in ('cash','bank','upi','credit_card','wallet')),
  currency char(3) not null,
  archived_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
index(space_id, archived_at)

-- Transactions
transactions(
  id uuid pk,
  space_id uuid fk spaces.id on delete cascade,
  wallet_id uuid fk wallets.id,
  type text not null check(type in ('income','expense','transfer','opening_balance')),
  amount numeric(14,2) not null check(amount >= 0),
  currency char(3) not null,
  base_amount numeric(14,2) not null,            -- always in space.base_currency
  fx_rate numeric(18,8),
  description text not null,
  category text,                                  -- one of CATEGORIES
  category_confidence numeric(3,2),
  categorized_by text check(categorized_by in ('user','minilm','overrides','merchants','llm','client','default')),
  date date not null,
  notes text,
  tags text[] default '{}',
  source text not null check(source in ('manual_web','whatsapp_text','whatsapp_voice','whatsapp_image','csv_import','recurring_engine')),
  transfer_id uuid,                              -- non-null on the pair
  needs_fx_resolution boolean default false,
  metadata jsonb default '{}',
  created_at timestamptz, updated_at timestamptz,
  deleted_at timestamptz
)
index(space_id, date desc) where deleted_at is null
index(space_id, category) where deleted_at is null
index(space_id, wallet_id) where deleted_at is null
index using gin (description gin_trgm_ops)

transaction_embeddings(
  transaction_id uuid pk fk transactions.id on delete cascade,
  space_id uuid fk spaces.id,
  embedding vector(1536) not null,               -- text-embedding-3-small
  text text not null,
  created_at timestamptz
)
index using ivfflat (embedding vector_cosine_ops) with (lists = 100)

category_overrides(
  id uuid pk,
  space_id uuid fk spaces.id on delete cascade,
  merchant_normalized text not null,
  category text not null,
  occurrences int default 1,
  created_at timestamptz, updated_at timestamptz,
  unique(space_id, merchant_normalized)
)

category_corrections(
  id uuid pk,
  space_id uuid fk spaces.id,
  transaction_id uuid fk transactions.id,
  from_category text,
  to_category text not null,
  created_at timestamptz
)

-- Budgets / Goals
budgets(
  id uuid pk,
  space_id uuid fk spaces.id,
  name text not null,
  recurrence text not null check(recurrence in ('monthly','custom')),
  period_start date,
  period_end date,
  allocations jsonb not null,                    -- {category: amount}
  alert_thresholds jsonb default '{"warn":80,"exceed":100}',
  created_at timestamptz, updated_at timestamptz
)

goals(
  id uuid pk,
  space_id uuid fk spaces.id,
  name text not null,
  target_amount numeric(14,2) not null,
  current_amount numeric(14,2) not null default 0,
  deadline date,
  linked_category text,
  status text not null default 'active' check(status in ('active','achieved','archived')),
  created_at timestamptz, updated_at timestamptz
)

-- Lend / Borrow ledger
ledger_entries(
  id uuid pk,
  space_id uuid fk spaces.id,
  direction text not null check(direction in ('lent','borrowed')),
  counterparty_name text not null,
  amount numeric(14,2) not null,
  currency char(3) not null,
  base_amount numeric(14,2) not null,
  status text not null default 'open' check(status in ('open','partial','settled')),
  outstanding numeric(14,2) not null,
  date date not null,
  note text,
  linked_transaction_id uuid fk transactions.id,
  created_at timestamptz, updated_at timestamptz
)

ledger_settlements(
  id uuid pk,
  ledger_entry_id uuid fk ledger_entries.id on delete cascade,
  amount numeric(14,2) not null,
  date date not null,
  linked_transaction_id uuid fk transactions.id,
  created_at timestamptz
)

-- Recurring detection
recurring_items(
  id uuid pk,
  space_id uuid fk spaces.id,
  merchant_normalized text not null,
  display_name text not null,
  average_amount numeric(14,2) not null,
  currency char(3) not null,
  frequency_days int not null,
  next_expected_date date,
  occurrences int not null,
  confidence numeric(3,2) not null,
  status text not null default 'active' check(status in ('active','dismissed')),
  detected_at timestamptz,
  updated_at timestamptz,
  unique(space_id, merchant_normalized)
)

-- FX
fx_rates(
  base char(3),
  quote char(3),
  rate numeric(18,8) not null,
  fetched_at timestamptz not null,
  primary key(base, quote)
)
```

---

## 4. API surface (Hono routes)

All routes return the envelope:

```ts
{ success: boolean, data?: T, error?: { code: string, message: string, details?: any } }
```

### Auth

```
POST   /auth/register             { email, password, displayName }
POST   /auth/login                { email, password }
POST   /auth/refresh              { refreshToken }
POST   /auth/logout
GET    /auth/me
POST   /auth/phone-link/start     -> { otp_id }   (also returns the code in DEV)
POST   /auth/phone-link/confirm   { otp, phone }  (alt path for web-side confirm)
```

### Capture

```
POST   /capture/text              { text, locale?, hint? }
POST   /capture/voice             multipart audio
POST   /capture/image             multipart image
POST   /capture/confirm           { draftId, edits? }   (commits a confirmed draft)
```

Capture responses are uniform:

```ts
{
  intent: 'expense' | 'income' | 'transfer' | 'set_budget' | 'query_spending' | 'chat' | ...,
  draft?: TransactionDraft | TransferDraft,
  draftId?: string,        // present when needs_confirmation
  needs_confirmation: boolean,
  followup_question?: string,
  query_result?: { ... },  // for query_spending intent
  copilot_stream_url?: string  // for chat intent
}
```

### Transactions

```
GET    /transactions              ?from&to&type&category&wallet&search&limit&offset
POST   /transactions              direct create (manual)
GET    /transactions/:id
PATCH  /transactions/:id
DELETE /transactions/:id          soft delete
POST   /transactions/:id/category { category }   triggers correction logic
POST   /transactions/import       multipart csv
GET    /transactions/export       ?from&to&format=csv
```

### Wallets, Budgets, Goals, Ledger, Recurring, Forecast, Reports, Copilot, Settings, WS

```
GET/POST/PATCH/DELETE /wallets[/:id]
POST   /wallets/transfer

GET/POST/PATCH/DELETE /budgets[/:id]
GET    /budgets/:id/progress

GET/POST/PATCH/DELETE /goals[/:id]
POST   /goals/:id/progress

GET/POST/PATCH/DELETE /ledger[/:id]
POST   /ledger/:id/settle

GET    /recurring                 detected items
PATCH  /recurring/:id             dismiss / mark
POST   /recurring/run             trigger detector

GET    /forecast?days=30
GET    /reports/summary?from&to
GET    /advice                    3-5 ranked suggestions

POST   /copilot/chat              streams SSE; body: { messages, traceId }

GET    /settings
PATCH  /settings                  primary_language, base_currency, privacy_mode

GET    /ws                        upgrade to WebSocket; auth via JWT in Sec-WebSocket-Protocol
GET    /health
```

### Bot internal endpoints (apps/wa-bot, port 5001)

All require `X-Bot-Secret`.

```
GET    /health
GET    /qr                        HTML page, auto-refreshes
GET    /qr.png                    bare image
POST   /send-message              { phone, text, voice? }
POST   /broadcast/budget-alert    { phone, payload }
GET    /sessions
POST   /demo/run                  scripted demo flow
```

---

## 5. Capture pipeline (the heart of Finehance)

```
   ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
   │  Web omnibar   │     │ WhatsApp bot   │     │   CSV import   │
   │ text/voice/img │     │ text/voice/img │     │     CSV file   │
   └────────┬───────┘     └────────┬───────┘     └────────┬───────┘
            │                       │                       │
            ▼                       ▼                       ▼
   ┌─────────────────────────────────────────────────────────────┐
   │          POST /capture/{text,voice,image,import}            │
   └────────────────────────────┬────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  Pre-process layer    │
                    │  · voice → Whisper    │
                    │  · image → vision     │
                    │  result: raw text     │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  Intent classifier    │  (gpt-4o-mini, JSON)
                    └─────────┬─────────────┘
                              │
                ┌─────────────┼──────────────────────────┐
                ▼             ▼                          ▼
        ┌───────────┐  ┌───────────────┐         ┌──────────────┐
        │  Expense  │  │ Query/summary │         │ Chat/advice  │
        │  parser   │  │ executor      │         │ → Copilot RAG│
        └─────┬─────┘  └───────┬───────┘         └──────────────┘
              │                │
              ▼                ▼
   ┌────────────────────┐ ┌──────────────┐
   │  Categorizer       │ │ Aggregator   │
   │  (overrides →      │ │ returns text │
   │   merchants →      │ │ + numbers    │
   │   MiniLM → fb)     │ └──────────────┘
   └─────────┬──────────┘
             │
             ▼
   ┌────────────────────┐
   │  Confirmation      │  if confidence < 0.6 OR amount missing
   │  (returns draftId) │
   └─────────┬──────────┘
             │
             ▼
   ┌────────────────────┐
   │  Persist           │  → wallet balance, budget progress
   │  Embed async       │  → events bus
   └─────────┬──────────┘
             │
             ▼
   ┌────────────────────┐
   │ Broadcast WS event │
   └────────────────────┘
```

### Parser contract (Zod)

```ts
const ExpenseParse = z.object({
  intent: z.enum(['expense', 'income', 'transfer']),
  amount: z.number().positive(),
  currency: z.string().length(3).default('INR'),
  description: z.string().min(1),
  category_hint: z.string().nullable(),
  wallet_hint: z.string().nullable(),       // "hdfc", "cash", "upi"
  date: z.string().date().nullable(),
  split_people: z.number().int().positive().nullable(),
  original_amount: z.number().positive().nullable(),
  original_currency: z.string().length(3).nullable(),
  confidence: z.number().min(0).max(1),
  needs_confirmation: z.boolean(),
})
```

Strict prompt rule: **null means ask, never default.** The parser is instructed to return `null` for any field the user did not explicitly state. The system asks one clarifying question per missing field instead of guessing.

---

## 6. Categorization tiers

```
   classify(merchantOrText) →
     1. category_overrides[space_id, merchant_normalized] ?  return user-corrected
     2. global merchants.json (regex + alias)             ?  return mapped
     3. MiniLM(text) top-1 if score > 0.5                 ?  return predicted
     4. fallback "Other"
```

`merchant_normalized` rule: lowercase, strip common prefixes/suffixes (e.g., "UPI/", "@oksbi", store numbers, city codes, trailing punctuation), collapse whitespace.

MiniLM ONNX is loaded once at API startup:

```ts
import { pipeline } from '@huggingface/transformers'
const classifier = await pipeline(
  'text-classification',
  './ml/model/finehance-categorizer-minilm-onnx',
  { device: 'cpu', dtype: 'fp32' }
)
```

For Privacy Mode, the same ONNX bundle is served from `apps/web/static/models/` with a `manifest.json` listing artifact hashes for cache busting.

---

## 7. Forecast (recurring-decomposed ARIMA)

```
1. Fetch last 90 days of expenses for space.
2. Get active recurring_items with next_expected_date in [today, today+30].
3. Subtract recurring transactions from daily series (variable component).
4. If variable series has >= 14 non-zero days:
     - Detrend with first-difference
     - Fit ARIMA(1,1,1) (in-house TS implementation, ~120 lines)
     - Forecast 30 steps with 95% confidence interval
   Else:
     - 7-day rolling average + recent slope
5. Reconstruct: daily_total = recurring_due_today + variable_forecast_today
6. Compute anomalies: any historical day where actual > rolling_mean + 2*rolling_stdev
7. Cache 6h, invalidated on transaction.created
```

ARIMA implementation strategy: a small TS port of Hannan-Rissanen estimation for AR(1) coefficients + simple MA(1) iteration. Because the use case is short personal-finance histories, the model degrades gracefully to naive moving average when fit fails.

---

## 8. Copilot RAG and tool-calling

### Context build

```
1. Embed user question (text-embedding-3-small)
2. PgVector search transaction_embeddings WHERE space_id = $1 ORDER BY embedding <=> $2 LIMIT 20
3. Aggregate this month, last month, top 5 categories, top 5 merchants
4. Fetch active budgets, goals, recurring items
5. Compose system prompt:
   - Role: Vivien, finance copilot
   - Hard rules: never invent numbers; if not in context, say so; use tools for math
   - Available tools: compute_total, compute_category_breakdown, compute_forecast, find_recurring, compare_periods
   - User context block (concise summary + retrieved transactions)
6. Stream gpt-4o-mini response via SSE.
```

### Tool functions

Each is a pure server function exposed via OpenAI function-calling:

```ts
compute_total(filters: { from, to, category?, type? }) -> number
compute_category_breakdown(filters: { from, to }) -> { category: number }[]
compute_forecast(days: 7|14|30) -> { recurring_base, variable_total, total }
find_recurring() -> RecurringItem[]
compare_periods(a: {from,to}, b: {from,to}) -> { delta_total, delta_by_category }
```

Tool calls run inside the API process (same Drizzle connection). The LLM never gets raw amounts unless they came through a tool result, eliminating math hallucinations.

---

## 9. WhatsApp bot internals

### Conversation states (compact, finance-focused)

```
GREETING
AWAITING_LANGUAGE
AWAITING_LINK_CODE
LINKED_MAIN
CAPTURE_CONFIRM           // "Did I hear ₹600 on auto?"
SET_BUDGET_CATEGORY
SET_BUDGET_AMOUNT
QUERY_AWAITING_RANGE      // optional: "this week" / "this month"
COPILOT_THREAD            // multi-turn chat in WA
ERROR
```

### Universal commands (always work)

`MENU` `BACK` `RESET` `HELP` `LANGUAGE` `HUMAN` `STOP` `LINK <code>` `STATUS` `UNDO` (deletes last transaction within 5 min).

### Engine flow

```
processMessage(incoming):
  1. Persist inbound for audit
  2. If audio → transcribe (Whisper)
  3. If image → forward bytes to /capture/image
  4. Resolve session (in-memory map keyed by phone)
  5. If user not linked AND not LINK command → tell to register
  6. Universal command shortcuts (regex+keyword across all 6 langs)
  7. Otherwise: forward to /capture/text on the API
  8. Format API response into 1+ outgoing replies
  9. Translate (if ta/te/kn or ml needed)
 10. TTS (if user voice mode != text)
 11. Two-pass send: text first, voice second
```

### Reply modes (user-settable)

`text` (no voice), `voice` (text + voice), `voice_only` (voice + minimal text fallback for media).

### Reliability

- LocalAuth session in `.wwebjs_auth/` (gitignored).
- Supervisor: orphan-Chrome cleanup, lockfile cleanup, exponential backoff (2s, 5s, 10s, 30s, 60s, 120s), crash-loop detection (5 crashes/60s = give up).
- Watchdog: 90s probe of `getState()` + `getChats()`, 3 failures = exit.
- Keepalive: 60s `getState()` ping.
- Disconnect → `process.exit(2)` for clean restart.

---

## 10. Web app architecture

### Routing (SvelteKit)

```
/                        Dashboard (default)
/login /register         Auth pages
/transactions            Table + filters + bulk actions
/transactions/:id        Detail drawer
/budgets                 List + create + progress bars
/goals                   Cards + projections
/forecast                Big chart + recurring breakdown + anomalies
/reports                 Date-range picker + summary + export
/settings                Account, language, privacy mode, phone link
/copilot                 Full-page chat (overlay also available everywhere)
```

### Layout

- Sidebar (collapsible) on desktop, bottom nav on mobile
- Topbar: breadcrumb · global search omnibar · language pill · theme toggle · user menu
- Floating Copilot trigger (bottom-right) opens slide-in panel
- ⌘K command menu for fast navigation

### State

- TanStack Query for server state (caches per query key, optimistic updates)
- Svelte 5 runes for local UI state
- Single `auth.svelte.ts` store reading JWT from `localStorage`, refreshes on 401
- WebSocket subscription updates query caches via `queryClient.setQueryData`

### Streaming Copilot

Using Vercel AI SDK with custom SvelteKit endpoint:

```ts
// apps/web/src/routes/api/copilot/+server.ts
export async function POST({ request }) {
  const body = await request.json()
  const upstream = await fetch(`${API_URL}/copilot/chat`, {
    method: 'POST', headers: forwardAuth(request), body: JSON.stringify(body)
  })
  return new Response(upstream.body, { headers: { 'Content-Type': 'text/event-stream' } })
}
```

### Privacy Mode

Settings toggle persists to `settings` table AND localStorage. When enabled:

1. App downloads ONNX model + tokenizer to OPFS / IndexedDB on first toggle.
2. Omnibar pipeline diverges: parse intent on-server (no transaction text in result), categorize on-client, send pre-categorized payload to `/transactions` with `categorized_by: 'client'`.
3. Voice and image capture are disabled with explanatory tooltip.

### PWA + offline capture

Service worker strategy:

- App shell: cache-first
- API GET reads: stale-while-revalidate (15s)
- Capture POST: background-sync queue in IndexedDB
- Static assets (icons, fonts, ONNX model): cache-first with version manifest

---

## 11. Real-time event flow

### Server side

```ts
// apps/api/src/services/events/bus.ts
type EventName =
  | 'transaction.created' | 'transaction.updated' | 'transaction.deleted'
  | 'budget.warning' | 'budget.exceeded'
  | 'goal.updated' | 'recurring.detected' | 'forecast.invalidated'

export const emit = (userId: string, e: { type: EventName; data: unknown }) => {
  wsBroadcast(userId, e)
  // Optionally: bot.sendNotification(userId, e) when threshold crossed
}
```

### Client side

```ts
// apps/web/src/lib/api/ws.ts
ws.onmessage = (e) => {
  const evt = JSON.parse(e.data)
  switch (evt.type) {
    case 'transaction.created':
      queryClient.setQueryData(['transactions'], prepend(evt.data))
      queryClient.invalidateQueries(['budgets', 'progress'])
      break
    // ...
  }
}
```

### Event ordering & idempotency

Each event carries a `seq` (monotonic per user) and `entity_id`. Client reconciles by `entity_id` to avoid double-applying retries.

---

## 12. AI service contract (shared across api + bot)

`packages/shared/src/ai/` exports typed wrappers. `apps/api` provides the implementations (since secrets live there). The bot calls the API for any AI work that requires the database; only voice transcription and TTS happen in-process at the bot for latency.

| Job | Where it runs | Model | Notes |
|---|---|---|---|
| Voice transcription | Bot (latency) | `gpt-4o-transcribe` → `whisper-1` fb | Pass user language hint |
| Receipt vision | API | `gpt-4o` | Returns structured draft |
| Intent classify | API | `gpt-4o-mini` JSON | temp 0, max 200 tok |
| Expense parse | API | `gpt-5-mini` JSON | strict null rule |
| Translate text | API or bot | `gpt-4o-mini` temp 0.2 | sibling-script validation |
| TTS en/hi/kn/te | Bot | `gpt-4o-mini-tts` | per-lang `instructions` |
| TTS ta/ml combined | Bot | `gpt-4o-audio-preview` | one-call translate+speak |
| Embeddings | API | `text-embedding-3-small` | 1536 dim |
| Copilot chat | API | `gpt-4o-mini` streaming | tools for math |
| Advice | API | `gpt-4o-mini` temp 0.3 | grounded in summary |

---

## 13. Auth flow detail

### Web register/login

```
client → POST /auth/register
  server: hash, insert user, create personal space, default INR wallet
  return { access (1h), refresh (30d), user }
client stores access in memory + refresh in localStorage; sends access on every request
```

### Refresh

```
client receives 401 → POST /auth/refresh { refreshToken }
  server: verify token hash, mark old as rotated, issue new pair
client retries original request with new access
```

### Phone link

```
1. Web: POST /auth/phone-link/start → { otp_id, code (DEV only), expires_at }
   server inserts phone_link_otps row, valid 10 min
2. Web shows: "Send 'LINK 482917' to the bot from your WhatsApp."
3. Bot receives 'LINK 482917' from phone X:
   - Look up unconsumed phone_link_otps by code
   - If found and not expired: set users.whatsapp_phone = X, mark consumed
   - Reply "Linked ✅ welcome <name>"
4. Web settings page polls /auth/me; shows linked phone.
```

### WhatsApp request → API

Bot calls:

```
POST /capture/text
Headers:
  X-Bot-Secret: <shared>
  X-Phone: 919876543210
```

API middleware: verify `X-Bot-Secret`, look up user by `whatsapp_phone`, set `req.user` accordingly. No JWT for bot-originated calls because the bot is trusted infrastructure.

---

## 14. Error handling

## Correctness Properties

### Property 1: Tenant isolation

Every query against an owned table filters by `space_id` derived from the authenticated user's active space; no cross-space reads are possible via the public API.

**Validates: Requirements 2.3**

### Property 2: Soft delete semantics

Queries that read user-visible state filter `deleted_at IS NULL` by default; audit queries can opt in to deleted rows.

**Validates: Requirements 4.8**

### Property 3: Transfer atomicity

A transfer creates exactly two transactions sharing a `transfer_id`, or no transactions at all (DB transaction).

**Validates: Requirements 3.4, 3.5**

### Property 4: FX consistency

Every transaction stores both `original_amount`/`original_currency` and a `base_amount` in the space's base currency; reports never mix currencies inadvertently.

**Validates: Requirements 4.2, 4.3**

### Property 5: Money sign convention

Amounts are always positive; sign is derived from `type`. No negative amounts in storage.

**Validates: Requirements 4.1**

### Property 6: Categorization personalization

A user correction creates a `category_corrections` row AND upserts `category_overrides`; future identical merchants get the corrected category instantly.

**Validates: Requirements 7.3, 4.7**

### Property 7: No fabricated numbers in copilot

The LLM never returns precomputed totals; it must call tool functions for math. The system prompt enforces "if the data does not contain the answer, say so honestly."

**Validates: Requirements 11.3, 11.4**

### Property 8: Idempotent events

Every WS event carries a monotonic `seq` and `entity_id`; clients reconcile by `entity_id` so retries do not double-apply.

**Validates: Requirements 15.2, 15.3**

### Property 9: Bot trust boundary

Bot-originated requests prove identity via `X-Bot-Secret` + `X-Phone`; the user is resolved server-side by `whatsapp_phone`. The bot never carries a user JWT.

**Validates: Requirements 6.3, 18.3**

### Property 10: Privacy Mode honesty

When Privacy Mode is on, transaction descriptions never reach OpenAI; the server records `categorized_by='client'` so the audit trail is truthful.

**Validates: Requirements 17.2, 17.4**

## Error handling

### Uniform envelope

```ts
{ success: false, error: { code: 'VALIDATION', message: '...', details: { ... } } }
```

Error codes (subset): `VALIDATION`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `CONFLICT`, `UPSTREAM_AI`, `INTERNAL`.

### Frontend

Top-level `<ErrorBoundary>` per route. Toast on transient errors. Empty-state components for known empty cases (no transactions, no budgets).

### Bot

Wrap each handler in try/catch. On error, reply with localized "Something went wrong. Reply RESET to start over." in user's language.

---

## 15. Logging and observability

- Logger: tiny custom JSON logger (no Pino dep needed for hackathon)
- Log fields: `ts`, `level`, `event`, `request_id`, `user_id?`, `space_id?`, plus event-specific
- Request id middleware adds `x-request-id` to responses
- DEBUG level can be enabled per-package via `LOG_LEVEL`
- The bot masks phone numbers in logs (`919876****210`)

---

## 16. Testing strategy

## Testing Strategy

Testing is layered to match the architecture:

- **Unit (Bun's built-in test runner)** for pure functions: parser, categorizer (each tier), forecast components, FX conversion, phone normalization, splits.
- **Integration** for HTTP routes and event flow: auth lifecycle, end-to-end capture, budget alerts crossing thresholds, recurring detection on seed data, WS broadcasts on transaction creation.
- **Bot conversation engine** harness using the simulator transport: drives the engine like real WhatsApp; headless `bun run test:flow` walks a 10-step demo.
- **Visual** with Playwright: one happy-path test (login → capture → see transaction in dashboard) so we catch frontend regressions without overinvesting in UI tests during a hackathon.

Test data lives alongside the seed in `apps/api/src/data/seed-fixtures.ts`. Tests use a separate database via `DATABASE_URL_TEST` and reset between runs.

### Unit (Bun's built-in test)

- Parser: 30+ canonical Indian expense phrases (en/hi/ml mix)
- Categorizer: known merchants → expected categories; override priority
- Forecast: synthetic series with known recurring + variable
- Splits: "dinner 3000 split with 4 people" → 750 + lend 2250
- FX conversion: USD 50 → INR @ rate
- Phone normalization

### Integration

- Auth lifecycle (register → login → refresh → logout)
- End-to-end capture (text → categorize → persist → list)
- Budget alert fires at 80% / 100%
- Recurring detection across 90 days of seed data
- WebSocket broadcasts on transaction.created

### Bot

- Conversation engine harness: simulator drives the bot like real WhatsApp
- Headless `bun run test:flow` walks a 10-step demo

### Visual

- One Playwright happy path: login → capture → see transaction in dashboard

---

## 17. Demo / seed strategy

`apps/api/src/db/seed.ts` creates:

- User: `demo@finehance.app` / `Finehance#2026!`, language `en`, base INR
- Wallets: HDFC Bank, Cash, GPay UPI, ICICI Credit Card
- 90 days of transactions:
  - Salary credit on the 1st (₹85,000)
  - Recurring: Netflix (₹649), Spotify (₹119), Zerodha SIP (₹5,000), Rent (₹18,000), Internet (₹999)
  - Daily expenses across Food/Transport/Groceries/Coffee/Shopping
  - One USD 25 lunch (FX scenario)
  - One split bill (dinner ₹3,200, 4 people)
  - One GBP 80 hotel
  - 3-4 anomalies (one massive AWS bill, one ER hospital visit)
- Budgets for 3 categories
- 2 goals (Emergency fund 50% done, Macbook 20% done)
- 3 ledger entries

`bun run reset:demo` wipes and reseeds.

---

## 18. Local dev runbook

```bash
# 1. Postgres
docker compose up -d postgres

# 2. Install
bun install                          # workspace install

# 3. Convert MiniLM (one-time)
bun run --cwd apps/api convert:minilm
# Downloads CyberKunju/finehance-categorizer-minilm, exports to ONNX,
# writes to apps/api/src/ml/model/ AND apps/web/static/models/

# 4. Migrate + seed
bun run --cwd apps/api db:migrate
bun run --cwd apps/api db:seed

# 5. Run all
bun run dev                          # concurrently: web 5173, api 5000, bot 5001

# 6. Pair WhatsApp (one-time)
# Open http://localhost:5001/qr in your browser
# Scan with the personal WhatsApp number that will be the bot
# Session persists in apps/wa-bot/.wwebjs_auth/

# 7. Test from another phone (allowlisted in apps/wa-bot/.env)
# Send: "spent 450 on auto"
# Expect: bot confirms, transaction appears in web app instantly
```

---

## 19. Risk register and mitigations

| Risk | Mitigation |
|---|---|
| WhatsApp Web breaks during demo | Same engine drives a browser simulator at `:5001/simulator/`; identical replies |
| OpenAI quota exhaustion | All AI calls have try/catch + graceful degradation; categorizer still works (MiniLM in-process); parser falls back to regex extractor |
| MiniLM ONNX conversion fails | Pre-converted artifact hosted; conversion script verifies hash |
| Bun + whatsapp-web.js incompatibility | If a Bun-specific bug appears, the bot can run on Node via a flag; whatsapp-web.js does not depend on Bun-specific APIs |
| Indic translation contamination | Sibling-script validator (rejects target output containing > 5% of a sibling-script's letters) plus one-retry policy with a sharper prompt |
| WS connection drops during demo | Auto-reconnect + 15s polling fallback |
| Single-user MVP painted into a corner | Schema has `space_id` everywhere; `space_members` table exists; switching to multi-user is UI work, not data work |
| Privacy Mode model load slow on first toggle | Show progress bar + size; cache in IndexedDB; subsequent loads instant |
| FX API rate-limited | 6h cache + exponential backoff + manual override field |

---

## 20. Stretch goals (build only if time)

1. **Receipt PDF parser** — accept multi-page PDFs (bank statements) for batch import
2. **Voice replies in copilot** — answer reads back as a voice note in WhatsApp
3. **Telegram bridge** — same engine, Telegram transport
4. **iOS share sheet** — paste a UPI confirmation SMS, instant capture
5. **Recurring suggestions** — "Cancel Netflix? You haven't streamed in 60 days based on transaction-derived metadata"
6. **Goal challenges** — gamified savings streaks and badges
