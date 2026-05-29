# 15 · Roadmap — Sweep Plan

> The remaining work, broken into focused sweeps with effort estimates and explicit dependencies. Designed so each sweep ends with a verifiably green increment.

## Where we are

Phase 0 → 9 substantially complete. ~111 .ts files in `apps/api`, every route mounted, full schema live, every AI service written. Phases 10–17 remain.

Verified by `tsc --noEmit` clean, API boots, `/health/ready` returns 200, all 16 tables present in Postgres.

## Sweep order rationale

Two viable orderings: web-first or bot-first. **Web-first** is recommended because:
1. The API end is already curl-able. A web dashboard demos faster than a WhatsApp pairing.
2. Web pages are isolated from each other; sub-agents can build them in parallel.
3. The bot needs message packs (en/hi/ml hand-translated copy), which is slow text work better suited to a single focused session.
4. A working web app makes the bot feel like a "second surface" rather than the only surface.

## Sweep 1 — Critical fixes (1–2h)

Before any new work, fix the issues that bite immediately. Listed in order of impact:

| Task | File(s) | Effort |
| --- | --- | --- |
| Add `bunfig.toml` + `tests/setup.ts` so `bun test` loads `.env` | `apps/api/bunfig.toml`, `apps/api/tests/setup.ts` | 15 min |
| Fix `apps/wa-bot` typecheck `bun-types` error | `apps/wa-bot/tsconfig.json` | 5 min |
| Add `summarize` and `totalSpentByCategory` to `services/transactions/query.ts` | `apps/api/src/services/transactions/query.ts` | 30 min |
| Make copilot `compute_total` require `from`/`to` | `apps/api/src/services/ai/copilotTools.ts` | 15 min |
| Convert numeric customTypes to `data: string` and update insert sites | `apps/api/src/db/schema/*.ts` + a few callers | 45 min |

Total: ~2h. After this sweep, every workspace typechecks clean and `bun test` runs the categorize test.

## Sweep 2 — MiniLM ONNX export + seed data (3–4h)

The two pieces of foundation work that aren't code-related but unlock major demo capability.

### 2a. ONNX export (1h)

```bash
# Need Python 3.10+ and pip
pip install optimum[exporters,onnxruntime] transformers

optimum-cli export onnx \
  --model CyberKunju/versifine-categorizer-minilm \
  --task text-classification \
  apps/api/src/ml/model/onnx

# Copy for privacy mode
cp apps/api/src/ml/model/onnx/model.onnx apps/web/static/models/onnx/

# Verify
bun run --cwd apps/api convert:minilm
```

After this, Tier 3 of the categorizer is live. Tested via `apps/api/tests/categorize.test.ts`.

### 2b. Demo seed (2–3h)

Build `apps/api/src/data/seed-fixtures.ts` with:

```ts
export const DEMO_USER = { email: 'demo@versifine.com', password: 'Versifine#2026!', displayName: 'Demo' };

export const DEMO_WALLETS = [
  { name: 'HDFC Bank', type: 'bank', currency: 'INR', openingBalance: 75000 },
  { name: 'Cash', type: 'cash', currency: 'INR', openingBalance: 5000 },
  { name: 'GPay UPI', type: 'upi', currency: 'INR', openingBalance: 12500 },
  { name: 'ICICI Credit Card', type: 'credit_card', currency: 'INR', openingBalance: 0 },
];

export const DEMO_TRANSACTIONS = generate90Days({
  // Subscriptions
  netflix: { day: 12, amount: 649, category: 'Subscriptions' },
  spotify: { day: 8, amount: 119, category: 'Subscriptions' },
  zerodhaSIP: { day: 5, amount: 5000, category: 'Transfers' },
  rent: { day: 1, amount: 18000, category: 'Housing' },
  internet: { day: 14, amount: 999, category: 'Bills & Utilities' },

  // Salary
  salary: { day: 30, amount: 85000, type: 'income', category: 'Income' },

  // Daily variable
  // ...
});

export const DEMO_BUDGETS = [
  { name: 'Monthly food', recurrence: 'monthly', allocations: { Groceries: 8000, Restaurants: 4000, 'Food Delivery': 3000 } },
  { name: 'Monthly transport', recurrence: 'monthly', allocations: { Transportation: 3000, 'Gas & Fuel': 5000, Travel: 2000 } },
];

export const DEMO_GOALS = [
  { name: 'Emergency Fund', targetAmount: 250000, currentAmount: 125000, deadline: '2026-12-31' },
  { name: 'New Macbook', targetAmount: 200000, currentAmount: 40000, deadline: '2026-12-31' },
];
```

Plus:
- 1 USD lunch (FX scenario)
- 1 GBP hotel (FX)
- 1 split-bill dinner (₹3,200 / 4 people)
- 3 anomalies (one ₹9,300 hospital visit, one ₹4,800 dining, one ₹6,200 shopping)
- 3 ledger entries (lent ₹2,000 to John, borrowed ₹5,000 from Sarah, lent ₹500 to Friend)

Then update `apps/api/scripts/seed.ts` to insert via the same APIs the production code uses (so categorization, FX, and event emission all run normally).

After this sweep, `bun run --cwd apps/api db:reset` populates a fully demo-ready database in ~10 seconds.

## Sweep 3 — WhatsApp bot (Phase 10–11, ~28h split into 3 sub-sweeps)

### 3a. Bot foundation (~10h)

Author in order:

1. `apps/wa-bot/src/index.ts` — entry point, decides supervised vs direct boot
2. `apps/wa-bot/src/supervisor.ts` — crash-loop detection + orphan Chromium cleanup
3. `apps/wa-bot/src/openwa/createClient.ts` — whatsapp-web.js client with LocalAuth
4. `apps/wa-bot/src/openwa/handlers.ts` — message dispatch, allowlist, LID resolution, two-pass send
5. `apps/wa-bot/src/openwa/media.ts` — image/audio download with fallback
6. `apps/wa-bot/src/openwa/sharedClient.ts` — late-bound accessor

Verifies: `bun run --cwd apps/wa-bot dev` shows a QR. Pair with personal WhatsApp. Bot acknowledges allowlisted message.

### 3b. Internal HTTP server + apiClient (~3h)

1. `apps/wa-bot/src/server/internalServer.ts` — Hono :5001 with `/health`, `/qr`, `/qr.png`, `/sessions`, `/send`, `/broadcast/*`, `/simulator/*`
2. `apps/wa-bot/src/services/apiClient.ts` — typed wrapper around `apps/api` with `X-Bot-Secret` + `X-Phone`

Verifies: `curl http://localhost:5001/qr` returns the QR HTML page; `POST /broadcast/budget-alert` from the API reaches the bot.

### 3c. Conversation engine + flows + message packs (~15h)

1. `apps/wa-bot/src/conversations/state.ts` — in-memory session map
2. `apps/wa-bot/src/conversations/engine.ts` — top-level dispatcher
3. `apps/wa-bot/src/conversations/messages/{en,hi,ml,index}.ts` — three hand-translated packs
4. `apps/wa-bot/src/conversations/flows/{identity,link,capture,confirm,query,budget,correct,help}.ts` — 8 flow handlers
5. `apps/wa-bot/tests/flow.test.ts` — simulator-driven engine test

Verifies: greet → language pick → link → capture → confirm flow works end-to-end without a real WhatsApp client (simulator transport).

### Parallelizable

Sub-agents can build flows in parallel (each flow is independent). I'd run 4 sub-agents simultaneously:
- agent A: identity + link
- agent B: capture + confirm
- agent C: query + budget + correct
- agent D: message packs

Then I review and merge.

## Sweep 4 — Web app foundation (Phase 12, ~12h)

### 4a. Stores + clients (~5h)

1. `apps/web/src/lib/api/client.ts` — fetch wrapper with auto-refresh
2. `apps/web/src/lib/api/ws.ts` — WebSocket connector with reconnect
3. `apps/web/src/lib/api/queries.ts` — TanStack Query factory
4. `apps/web/src/lib/stores/auth.svelte.ts` — auth rune store
5. `apps/web/src/lib/stores/settings.svelte.ts` — language + privacy + theme

### 4b. Layout shell (~7h)

1. `apps/web/src/routes/+layout.svelte` — auth gate + sidebar + topbar + content slot
2. `apps/web/src/routes/+layout.ts` — initial data load
3. `apps/web/src/routes/login/+page.svelte`
4. `apps/web/src/routes/register/+page.svelte`
5. `apps/web/src/lib/components/layout/Sidebar.svelte`
6. `apps/web/src/lib/components/layout/Topbar.svelte`
7. `apps/web/src/lib/components/layout/CommandMenu.svelte` (⌘K)
8. shadcn-svelte primitives setup (Button, Dialog, Drawer, Sheet, Command, Popover, Select, Tabs, Toast, Tooltip)

Verifies: navigate to localhost:5173, register, see authenticated shell with empty pages.

## Sweep 5 — Web pages (Phase 14, ~25h, parallelizable)

Each page is independent. Spawn ~7 sub-agents:

1. **Dashboard** (`/`) — agent 1, 6h
2. **Transactions** (`/transactions`) — agent 2, 6h (most complex)
3. **Budgets** (`/budgets`) — agent 3, 3h
4. **Goals** (`/goals`) — agent 4, 2h
5. **Forecast** (`/forecast`) — agent 5, 4h (Layerchart)
6. **Reports** (`/reports`) — agent 6, 3h
7. **Settings** (`/settings`) — agent 7, 3h (wallet CRUD, privacy mode, phone link)

Each sub-agent gets:
- The page's design from [12-web.md](./12-web.md)
- The relevant API endpoints from [05-api.md](./05-api.md)
- The shared schema imports
- Instruction to use TanStack Query for data and `bits-ui` for primitives
- Instruction to subscribe to relevant WS events

I review each before merging.

## Sweep 6 — Omnibar + Copilot (Phase 13 + 15, ~12h)

The two interactive surfaces that make the demo land.

### 6a. Omnibar (~5h)

1. `apps/web/src/lib/components/omnibar/Omnibar.svelte` — single input
2. `apps/web/src/lib/components/omnibar/VoiceCapture.svelte` — MediaRecorder + waveform
3. `apps/web/src/lib/components/omnibar/ImageDrop.svelte` — drag-drop receipt
4. `apps/web/src/lib/components/omnibar/ConfirmDialog.svelte` — draft confirmation
5. Wire ⌘L global focus shortcut

### 6b. Copilot panel (~5h)

1. `apps/web/src/lib/components/copilot/CopilotPanel.svelte` — slide-in sheet
2. `apps/web/src/lib/components/copilot/MessageBubble.svelte` — markdown + tool result
3. `apps/web/src/routes/api/copilot/+server.ts` — SSE proxy
4. Vercel AI SDK integration with custom SSE reader
5. Quick-prompt chips

### 6c. Privacy mode (~2h)

1. `apps/web/src/lib/ai/minilm-client.ts` — Transformers.js wrapper
2. `apps/web/src/lib/components/settings/PrivacyMode.svelte` — toggle + download progress
3. Wire into omnibar to short-circuit categorize when active

## Sweep 7 — PWA + offline (Phase 16, ~3h)

1. `apps/web/src/service-worker.ts` — caching strategies
2. `apps/web/src/lib/stores/pendingCaptures.svelte.ts` — IndexedDB queue
3. PWA manifest icons (favicon variants)
4. Background-sync drain on reconnect

## Sweep 8 — Polish + tests + demo (Phase 17, ~10h)

1. `apps/api/tests/parser.test.ts` — 50+ phrases across en/hi/ml/ta/te/kn
2. `apps/api/tests/forecast.test.ts` — synthetic series with known recurring + variable + anomaly
3. `apps/api/tests/copilot.test.ts` — tool dispatch happy path
4. `apps/api/tests/smoke-ws.ts` — WS subscribe → POST txn → assert event arrives
5. `apps/web/playwright.config.ts` + e2e happy path test
6. `apps/wa-bot/tests/flow.test.ts` (already in sweep 3c)
7. README polish (full setup recipe, demo flow, screenshots placeholders)
8. Demo script (step-by-step for the hackathon presentation)
9. Final lint + dead-code pass

## Total effort estimate

| Sweep | Effort |
| --- | --- |
| 1 — Critical fixes | 2h |
| 2 — ONNX + seed | 4h |
| 3 — WhatsApp bot | 28h |
| 4 — Web foundation | 12h |
| 5 — Web pages (parallel) | 25h calendar / ~10h with 4 sub-agents |
| 6 — Omnibar + Copilot | 12h |
| 7 — PWA + offline | 3h |
| 8 — Polish + tests | 10h |
| **Total** | **~96 calendar hours / ~70h with parallelism** |

## Sub-agent strategy

Where I'd actually spawn sub-agents (saves ~25h):

- **Sweep 3c**: 4 agents in parallel (~15h compressed to ~6h)
- **Sweep 5**: 7 agents in parallel (~25h compressed to ~6h)
- **Sweep 8 tests**: 3 agents in parallel (~5h compressed to ~2h)

Sub-agent prompts include the relevant doc files so each agent has the same source of truth I do.

## Done-criteria for each sweep

| Sweep | Done means... |
| --- | --- |
| 1 | `bun run --filter '*' typecheck` clean, `bun test` green for the existing test |
| 2 | Categorize test passes against real ONNX, `db:reset` populates demo data |
| 3 | Bot pairs with WhatsApp, simulator e2e test passes, "spent 200 on coffee" works end-to-end |
| 4 | localhost:5173 → register → see authenticated shell |
| 5 | Every page renders with seeded data, WS events update views live |
| 6 | Omnibar captures (text/voice/image), copilot streams answers with tool calls, privacy mode toggleable |
| 7 | App installable as PWA, offline omnibar queues captures, sync drains on reconnect |
| 8 | All tests green, README + demo script ready, repo cleanly clonable |

## Stretch / production-readiness (post-demo)

Listed but explicitly out of scope for the hackathon:

- HTTPS termination (nginx / Caddy)
- httpOnly cookies for refresh tokens
- WhatsApp Business Cloud API migration
- Managed Postgres (Neon, RDS, Supabase)
- Redis for rate limiter + event bus + cache
- Sentry / OpenTelemetry observability
- CI pipeline (typecheck + lint + tests on push)
- Backup strategy with point-in-time recovery
- Webhook signing for inbound bot messages
- WebSocket presence + typing indicators
- Multi-region deployment

## When the demo lands

The win condition for the hackathon:

1. Judge clones the repo.
2. `bun install && bun run db:init && bun run --cwd apps/api db:migrate && bun run --cwd apps/api db:seed`.
3. `bun run dev` starts all three apps.
4. Open localhost:5173 → log in as demo user → see populated dashboard.
5. Type "spent 450 on auto" in the omnibar → category filled, transaction appears, budget bar shifts.
6. Open Copilot → "where am I overspending?" → grounded answer with tool calls visible.
7. Open localhost:5001/qr → scan with personal WhatsApp number.
8. Send a voice note in Malayalam from the second phone → bot replies in Malayalam text + voice → web dashboard updates live.
9. Toggle Privacy Mode → next capture runs locally → dashboard still updates.
10. Show the docs.

That's the whole arc.
