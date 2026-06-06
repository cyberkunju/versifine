# Versifine — Documentation

Welcome to the Versifine documentation. This folder is the **single source of truth** for the project as it exists right now: every file written, every decision taken, every bug found and fixed, every gap still open.

The spec in `.kiro/specs/versifine/` (`requirements.md`, `design.md`, `tasks.md`) describes the **target state**. The docs here describe the **current state** plus everything you need to navigate, debug, extend, or hand off the project.

> **Last full audit**: 2026-05-28 (Phase 1 schema + Phase 2 auth + most of Phases 3-9 verified live, API boots and `/health/ready` returns 200).

## What is Versifine?

Versifine is a **personal finance manager with frictionless multimodal capture and an AI co-pilot that actually understands your money**.

- Indian-market-first: INR-native, UPI vocabulary, multilingual to the bone.
- Three apps share one Postgres: a Hono API, a SvelteKit web dashboard, a WhatsApp bot.
- Every transaction can land via web omnibar (text/voice/photo), WhatsApp message (text/voice/photo), or CSV import — all funnel into the same parser → categorizer → persist → broadcast pipeline.
- The AI co-pilot answers in streaming SSE with grounded RAG over the user's own transactions, calling tool functions for any math so it never fabricates numbers.
- Privacy mode runs the fine-tuned MiniLM categorizer in the browser via Transformers.js; transaction text never leaves the device.
- Single-user MVP, but every owned row carries `space_id` so household / business spaces ship in v2 with zero migration.

## Documentation map

| File | Read this when... |
| --- | --- |
| [01-status.md](./01-status.md) | You want the current ground truth: what's done, what's broken, what's next. |
| [02-architecture.md](./02-architecture.md) | You want the system shape — apps, processes, data flow, request lifecycle. |
| [03-stack.md](./03-stack.md) | You want every chosen technology, why it was picked, and what it replaces. |
| [04-database.md](./04-database.md) | You want the schema: tables, columns, indexes, migrations, row-level rules. |
| [05-api.md](./05-api.md) | You want the HTTP surface: routes, request/response shapes, errors, auth. |
| [06-ai-services.md](./06-ai-services.md) | You want the AI design: models picked, prompts, fallbacks, cost map. |
| [07-categorization.md](./07-categorization.md) | You want the four-tier categorizer (overrides → merchants → MiniLM → default). |
| [08-forecast.md](./08-forecast.md) | You want recurring detection + ARIMA + anomaly detection internals. |
| [09-copilot.md](./09-copilot.md) | You want the RAG pipeline, tool-calling loop, SSE protocol, prompts. |
| [10-realtime.md](./10-realtime.md) | You want the WebSocket protocol, event bus, fan-out logic. |
| [11-bot.md](./11-bot.md) | You want the WhatsApp bot design: voice/TTS/multilingual/supervisor. |
| [12-web.md](./12-web.md) | You want the SvelteKit app plan: routes, stores, omnibar, privacy mode. |
| [13-issues.md](./13-issues.md) | You want the audit findings and bug list with severity and fixes. |
| [14-runbook.md](./14-runbook.md) | You want to run the project locally, debug it, or demo it. |
| [15-roadmap.md](./15-roadmap.md) | You want the remaining work broken down into sweeps with effort estimates. |
| [16-deployment.md](./16-deployment.md) | You want the deployment setup: AWS, CI/CD, environments. |
| [17-model-stack.md](./17-model-stack.md) | You want the AI model selection per pipeline stage, the interim bootstrap config, quota requests, and cost map. |

## Quick commands cheat sheet

```bash
# Bring everything up locally
bun install                                    # workspace install
bun run db:init                                # create + reset databases
bun run --cwd apps/api db:migrate              # apply migrations
bun run --cwd apps/api dev                     # start API on :5000
bun run --cwd apps/api typecheck               # tsc --noEmit
curl http://127.0.0.1:5000/health              # liveness
curl http://127.0.0.1:5000/health/ready        # liveness + DB roundtrip
```

The full runbook is in [14-runbook.md](./14-runbook.md).

## Reading order

If you're new: 01 → 02 → 03 → 04 → 05 → 14. After that the topic-specific docs.
If you're picking up where the last session left off: 01 → 13 → 15.
If you're demoing: 14 → 15.
