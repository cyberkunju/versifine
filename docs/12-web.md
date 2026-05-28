# 12 · Web App (SvelteKit)

> Status: foundation only — package.json, configs, app shell. Routes/stores/components/omnibar/copilot/PWA all to be written. This doc records the design + the full file plan.

## What's done

```
apps/web/
├── .gitignore
├── package.json                       ✅ all deps locked (svelte 5, kit 2, tailwind v4, bits-ui, etc.)
├── svelte.config.js                   ✅ adapter-node, vitePreprocess, runes:true, $lib alias
├── tsconfig.json                      ✅
├── vite.config.ts                     ✅
└── src/
    ├── app.css                        ✅ tailwind + shadcn-svelte CSS variables
    ├── app.d.ts                       ✅ env type augmentation
    ├── app.html                       ✅ SvelteKit shell
    └── lib/
        ├── config.ts                  ✅ env-driven public config
        └── utils/
            ├── cn.ts                  ✅ classnames merge
            └── format.ts              ✅ currency/date helpers
└── static/
    ├── favicon.svg
    ├── manifest.webmanifest           ✅ PWA shell
    └── models/                        ✅ tokenizer + label_map + manifest fetched
        ├── config.json
        ├── label_map.json
        ├── manifest.json
        ├── special_tokens_map.json
        ├── tokenizer.json
        ├── tokenizer_config.json
        ├── vocab.txt
        └── onnx/
            └── (empty — needs model.onnx export)
```

## What's planned

```
apps/web/src/
├── lib/
│   ├── api/
│   │   ├── client.ts                  ⛔ fetch wrapper with auto-refresh on 401
│   │   ├── ws.ts                      ⛔ WebSocket connector with reconnect
│   │   ├── queries.ts                 ⛔ TanStack Query factory + invalidation
│   │   └── types.ts                   ⛔ envelope unwrap helpers
│   ├── stores/
│   │   ├── auth.svelte.ts             ⛔ rune-based auth store
│   │   ├── settings.svelte.ts         ⛔ language + privacy mode + theme
│   │   └── pendingCaptures.svelte.ts  ⛔ IndexedDB-backed offline queue
│   ├── ai/
│   │   └── minilm-client.ts           ⛔ Transformers.js wrapper for privacy mode
│   ├── components/
│   │   ├── ui/                        ⛔ shadcn-svelte primitives
│   │   ├── layout/
│   │   │   ├── Sidebar.svelte         ⛔ collapsible sidebar
│   │   │   ├── Topbar.svelte          ⛔ search + theme + user menu
│   │   │   └── CommandMenu.svelte     ⛔ ⌘K navigation
│   │   ├── omnibar/
│   │   │   ├── Omnibar.svelte         ⛔ single-input multimodal capture
│   │   │   ├── VoiceCapture.svelte    ⛔ MediaRecorder + waveform
│   │   │   └── ImageDrop.svelte       ⛔ drag-drop receipt
│   │   ├── transactions/              ⛔ table, drawer, edit form
│   │   ├── budgets/                   ⛔ progress bars, allocator
│   │   ├── goals/                     ⛔ cards with projected completion
│   │   ├── forecast/
│   │   │   └── ForecastCard.svelte    ⛔ Layerchart with recurring + variable bands
│   │   ├── copilot/
│   │   │   ├── CopilotPanel.svelte    ⛔ slide-in sheet
│   │   │   └── MessageBubble.svelte   ⛔ markdown + tool result UI
│   │   └── settings/
│   │       └── PrivacyMode.svelte     ⛔ toggle + model download status
│   └── i18n/
│       ├── en.ts                      ⛔ UI shell labels
│       ├── hi.ts                      ⛔
│       ├── ml.ts                      ⛔
│       └── index.ts                   ⛔ getMessages(lang)
├── routes/
│   ├── +layout.svelte                 ⛔ auth gate, theme, sidebar
│   ├── +layout.ts                     ⛔ initial data load
│   ├── +page.svelte                   ⛔ dashboard
│   ├── login/+page.svelte             ⛔
│   ├── register/+page.svelte          ⛔
│   ├── transactions/+page.svelte      ⛔ filter + table + drawer
│   ├── budgets/+page.svelte           ⛔
│   ├── goals/+page.svelte             ⛔
│   ├── forecast/+page.svelte          ⛔
│   ├── reports/+page.svelte           ⛔
│   ├── settings/+page.svelte          ⛔
│   └── api/
│       └── copilot/+server.ts         ⛔ SSE proxy to apps/api /copilot/chat
└── service-worker.ts                  ⛔ PWA + offline capture queue
```

## Pages and their contents

### Dashboard (`/`)

The landing view after login. Heavy on at-a-glance numbers, light on tables.

- **Top tiles**: This month income, expense, savings rate, net worth.
- **Recent transactions**: Last 5 with category icons. Click to open detail drawer.
- **This month forecast preview**: Mini Layerchart with the 30-day recurring + variable bands.
- **Top 3 categories**: Donut + names.
- **Budget alerts strip**: Any category in `warn` or `exceeded` state.
- **Copilot quick-prompt cards**: 4 chips for common questions ("Where did my money go?", "Forecast next 30 days", "Where am I overspending?", "Compare to last month").

Subscribes to WS events; animates new transactions in (fade + slide top-down).

### Transactions (`/transactions`)

The full ledger.

- **Filter bar**: date range picker, type chip, category multi-select, wallet select, search input.
- **Virtualized table**: TanStack Virtual + Svelte 5 keyed each. Date / Description / Category / Wallet / Amount columns.
- **Bulk select**: shift-click ranges, checkbox column.
- **Bulk actions**: change category, soft delete, export selected.
- **Detail drawer** (right slide-in): edit form, category correction inline (chip click → category picker), notes, tags, transfer link, delete button.
- **Import button**: opens file picker for CSV.
- **Export button**: triggers `GET /transactions/export?...` with current filters.

### Budgets (`/budgets`)

- **Header card**: Total allocated, total spent, remaining, donut.
- **List**: One row per budget. Each shows progress bars per category, color-coded (green / amber / red) by threshold state.
- **Create / edit form**: Category multi-select + amount input row repeater. Live preview of total.
- **Live recompute**: subscribed to `transaction.created/updated/deleted` and `budget.warning/exceeded` WS events.

### Goals (`/goals`)

- **Cards grid**: One card per goal. Progress ring, name, target, current, deadline, projected completion, atRisk badge.
- **Create / edit form**: name, target, optional deadline, optional category link.
- **Quick contribution**: + button on a card opens an amount input dialog → `POST /goals/:id/progress`.

### Forecast (`/forecast`)

The killer visualization page.

- **Big chart**: Layerchart area chart, x-axis = next 30 days, y-axis = ₹. Two stacked layers: recurring (deterministic, solid color) and variable (probabilistic, lighter shade). Confidence band from `lower`/`upper`.
- **Recurring items list**: Each row shows merchant, amount, frequency, next expected date.
- **Anomalies callout strip**: Recent anomalies with z-score and severity.
- **Last 90 days vs forecast next 30 comparison**: Two bars.

### Reports (`/reports`)

- **Date-range picker**: Quick presets (this month, last month, last quarter, last year, custom).
- **Summary tiles**: Income, Expense, Savings, Savings rate, Top category.
- **Income breakdown**: Donut + table.
- **Expense breakdown**: Donut + table.
- **Top merchants**: List of 10 with amounts.
- **Budget adherence**: Per-budget rows showing allocated vs spent vs %.
- **Export CSV button**: `GET /reports/summary.csv?from=&to=`.

### Settings (`/settings`)

- **Account section**: Email (read-only), display name (editable), change password.
- **Language picker**: 6 radio buttons.
- **Base currency**: 9 options.
- **Privacy mode**: Toggle with download progress on first activation.
- **Phone link section**: "Link WhatsApp" button → starts OTP flow → shows the 6-digit code → instructions to send `LINK 482917` to the bot.
- **Wallets management**: List + create + edit + archive.

## Stores

### `auth.svelte.ts`

```ts
class AuthStore {
  user = $state<UserSummary | null>(null);
  accessToken = $state<string | null>(null);
  refreshToken = $state<string | null>(null);

  async login(email: string, password: string) { /* POST /auth/login */ }
  async register(email: string, password: string, displayName?: string) { /* POST /auth/register */ }
  async logout() { /* POST /auth/logout, clear */ }
  async refresh() { /* POST /auth/refresh, rotate */ }
  async loadProfile() { /* GET /auth/me */ }
}
```

Backed by `localStorage` for refresh token; access token stays in memory only. On 401 from any API call, `client.ts` triggers a refresh; if that fails, redirect to `/login`.

### `settings.svelte.ts`

```ts
class SettingsStore {
  theme = $state<'light' | 'dark' | 'system'>('system');
  language = $state<Language>('en');
  privacyMode = $state(false);

  async setLanguage(lang: Language) { /* PATCH /settings + emit */ }
  async setPrivacyMode(enabled: boolean) { /* triggers model download if true */ }
}
```

### `pendingCaptures.svelte.ts`

IndexedDB-backed queue for offline omnibar captures.

```ts
class PendingCaptures {
  items = $state<PendingItem[]>([]);

  async add(item: PendingItem) { /* idb put */ }
  async drain() {
    /* foreach pending, POST /capture/text, on success remove from idb */
  }
}
```

The service worker calls `drain()` on `online` event and on background-sync.

## API client

```ts
class ApiClient {
  private base = PUBLIC_API_URL;
  private auth: AuthStore;

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.auth.accessToken;
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 401 && this.auth.refreshToken) {
      await this.auth.refresh();
      return this.request(path, init);  // retry once
    }
    const body = await res.json();
    if (!body.success) throw new ApiError(body.error);
    return body.data;
  }
}
```

## Privacy mode

When the user toggles privacy mode ON for the first time:

1. Show a progress dialog.
2. Fetch `apps/web/static/models/onnx/model.onnx` (~30 MB) into IndexedDB.
3. Load via `@huggingface/transformers` in browser mode.
4. Mark `privacyMode = true` in settings.
5. Subsequent omnibar captures run categorize client-side, then `POST /transactions` with `categorizedBy: 'client'` (skipping the server's categorizer tier).

Voice and image capture are disabled in privacy mode (they need server AI). The Omnibar shows a tooltip explaining why.

The MiniLM ONNX file isn't built yet — see [13-issues.md](./13-issues.md) for the conversion instruction.

## Copilot panel

`CopilotPanel.svelte` is a slide-in sheet (right side, 480px wide on desktop, full-screen on mobile).

- **Trigger**: floating button bottom-right (always visible) + `?` keyboard shortcut.
- **Implementation**: Vercel AI SDK's `useChat` with custom SSE endpoint `/api/copilot` that proxies to `apps/api /copilot/chat`.
- **Message rendering**: markdown + tool-result inline charts.
- **Quick-prompt chips**: shown when message list is empty.

The SvelteKit endpoint `routes/api/copilot/+server.ts`:

```ts
export async function POST({ request, fetch }) {
  const body = await request.json();
  const upstream = await fetch(`${env.PRIVATE_API_URL}/copilot/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': request.headers.get('authorization') ?? '',
    },
    body: JSON.stringify(body),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'text/event-stream' },
  });
}
```

The proxy lets us keep the access token client-side without exposing the API URL to the browser directly (PRIVATE_API_URL stays server-only; the browser hits `/api/copilot`).

## PWA / offline

`service-worker.ts` strategies:

| Resource | Strategy |
| --- | --- |
| App shell (HTML, JS, CSS) | cache-first with network revalidation |
| Static assets (icons, fonts, ONNX model) | cache-first |
| API GET reads (transactions, budgets, etc.) | stale-while-revalidate, 15s freshness |
| API POST writes | network-only with background-sync fallback |
| Capture POST | IndexedDB queue + background-sync drain |

When offline, the app shell loads from cache. The omnibar accepts text input and pushes to the IndexedDB queue with `status: 'pending_sync'`. A small indicator shows "X pending captures". When connectivity returns, the service worker drains the queue.

## ⌘K command menu

`CommandMenu.svelte` (cmdk-style):

- Trigger: ⌘K / Ctrl+K.
- Sections: Navigate (pages), Recent transactions, Quick actions (new transaction, set budget, ask copilot), Settings.
- Keyboard-only: arrow keys to move, enter to confirm, esc to close.

## Theme + language

- **Theme**: `mode-watcher` for system-respecting dark mode without flicker. Toggle in topbar.
- **Language**: dropdown in topbar; persists to settings store + `PATCH /settings`. UI shell uses i18n packs for en/hi/ml; ta/te/kn fall back to English shell with translated dynamic content (responses from the API).

## Effort estimate to finish

- Auth client + stores: ~3h
- API client + WS client: ~2h
- Layout shell (sidebar, topbar, command menu): ~4h
- shadcn-svelte primitives setup: ~1h
- Login + Register pages: ~2h
- Dashboard: ~6h (most-trafficked page, polish matters)
- Transactions table + drawer: ~6h
- Budgets page: ~3h
- Goals page: ~2h
- Forecast page (chart-heavy): ~4h
- Reports page: ~3h
- Settings page: ~3h
- Omnibar component: ~5h
- Privacy mode loader: ~2h
- Copilot panel: ~4h
- Tool result rendering: ~2h
- PWA + offline queue: ~3h
- i18n packs: ~3h
- Polish + accessibility pass: ~4h

Total: ~62 hours. Two-three working days for a focused build.
