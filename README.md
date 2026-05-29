<div align="center">

# Versifine

**Frictionless multimodal personal finance, with an AI co-pilot that actually understands your money.**

</div>

Versifine lets you capture every rupee with a sentence, a voice note, or a photo — from a Svelte web dashboard or directly in WhatsApp — and gives you back honest forecasts, grounded insights, and budgets that learn from your corrections. Built India-first, multilingual to the bone, single-user MVP with a multi-tenant-ready schema.

```
                  ┌──────────────────┐
                  │  WhatsApp (you)  │
                  └────────┬─────────┘
                           │  text · voice · receipt photo
                           ▼
┌────────────┐      ┌────────────────┐      ┌────────────────────┐
│  Web app   │ ◄──► │  API (Bun/Hono)│ ◄──► │  Postgres + vector │
│ (SvelteKit)│      │   + MiniLM ONNX│      │                    │
└────────────┘      └────────────────┘      └────────────────────┘
                           │  WebSocket
                           └─► live updates everywhere
```

## What's inside

- `apps/api` — Bun + Hono backend. Categorization, parsing, copilot RAG, ARIMA forecasting, WebSocket events, JWT auth.
- `apps/web` — SvelteKit dashboard. Omnibar capture, copilot chat, budgets/goals/forecast, PWA + privacy mode.
- `apps/wa-bot` — Node/Bun WhatsApp bot. Voice notes, photos, multilingual replies, voice synthesis, supervised reliability.
- `packages/shared` — Zod schemas, event types, language and category constants. Single source of truth for both runtimes.

## 60-second setup

You need: Bun ≥ 1.1, PostgreSQL 16 with `pgvector`, an OpenAI API key, a personal WhatsApp number for the bot.

```bash
# 1. Install deps
bun install

# 2. Bootstrap the database (creates versifine_dev + versifine_test, enables extensions)
bun run db:init

# 3. Configure your env
cp .env.example .env
# Then open .env and set OPENAI_API_KEY and ALLOWED_TEST_NUMBERS (digits only, comma separated)

# 4. Migrate + seed
bun run db:migrate
bun run db:seed

# 5. Run everything
bun run dev
# Web → http://localhost:5173
# API → http://localhost:5000
# Bot → http://localhost:5001/qr  (open in browser, scan with WhatsApp once)
```

Demo credentials after seeding: `demo@versifine.com` / `Versifine#2026!`.

## Documentation

The full spec lives in [`.kiro/specs/versifine/`](.kiro/specs/versifine/):

- [`requirements.md`](.kiro/specs/versifine/requirements.md) — every user story, every acceptance criterion.
- [`design.md`](.kiro/specs/versifine/design.md) — architecture, schema, capture pipeline, copilot RAG, bot internals.
- [`tasks.md`](.kiro/specs/versifine/tasks.md) — phased build plan, 79 tasks, dependency graph.

## License

Proprietary, all rights reserved during the build phase. License decision deferred to first public release.
