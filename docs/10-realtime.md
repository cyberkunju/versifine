# 10 · Real-time WebSocket

> One Bun.serve listener handles HTTP + WS. Per-user fan-out via in-process bus. Subprotocol-bearer auth.

## Why WebSocket and not SSE?

- SSE is one-way (server → client). We want the option to send client → server later (e.g., presence pings, "user is typing").
- A single Bun.serve socket handles both protocols on the same port; no extra infrastructure.
- The browser's WebSocket API supports custom subprotocols, which we use to pass the auth token without putting it in the URL.

## Server side — the upgrade

`apps/api/src/index.ts:fetch` intercepts every request:

```ts
async fetch(req, srv) {
  const url = new URL(req.url);
  if (url.pathname === '/ws') {
    try {
      const auth = await authoriseUpgrade(req);   // verify subprotocol bearer
      const subprotocol = selectedSubprotocol(req);
      const upgraded = srv.upgrade(req, {
        headers: subprotocol ? { 'Sec-WebSocket-Protocol': subprotocol } : undefined,
        data: { userId: auth.userId, attachedAt: Date.now() },
      });
      if (upgraded) return undefined as unknown as Response;
      return /* 426 */;
    } catch (err) {
      return /* 401 */;
    }
  }
  return app.fetch(req, srv);  // Hono handles everything else
}
```

The `data` field on `srv.upgrade` is Bun-specific — it gets attached to the resulting `ServerWebSocket<T>` so per-socket state (the userId in our case) stays accessible without a global map.

The `websocket` block on `Bun.serve` registers the lifecycle handlers:

```ts
websocket: {
  open(ws) { attachSocket(ws); },
  close(ws) { detachSocket(ws); },
  message(_ws, _message) { /* clients are read-only at the protocol level */ },
}
```

## Auth — subprotocol bearer

Browsers can't set custom headers on WebSocket connections (only Authorization in some implementations and inconsistently). The standard workaround is the `Sec-WebSocket-Protocol` header, which the WebSocket constructor accepts as a string array:

```js
const ws = new WebSocket('wss://api.example.com/ws', [`bearer.${accessToken}`]);
```

`authoriseUpgrade` parses this header, extracts the JWT, verifies it, and returns `{ userId, activeSpaceId }`. As a curl-friendly fallback, the regular `Authorization: Bearer <token>` header is also accepted.

The server echoes back the selected subprotocol (`bearer.<jwt>`) so the browser doesn't reject the upgrade. This is the WebSocket spec's required handshake — if the server doesn't echo, the browser closes the connection.

## Fan-out — `services/events/{bus,ws}.ts`

### `bus.ts` — in-process emitter

```ts
const subscribers = new Map<string, Set<(event: WsEvent) => void>>();

export function emit(userId: string, event: Omit<WsEvent, 'seq' | 'ts'> & { type: WsEventType }) {
  const seq = ++lastSeqByUser[userId] ?? 1;
  const enriched = { ...event, seq, ts: new Date().toISOString() } as WsEvent;
  const handlers = subscribers.get(userId);
  if (!handlers) return;
  for (const h of handlers) h(enriched);
}

export function subscribe(userId: string, handler: (event: WsEvent) => void): () => void {
  let bucket = subscribers.get(userId);
  if (!bucket) { bucket = new Set(); subscribers.set(userId, bucket); }
  bucket.add(handler);
  return () => {
    bucket!.delete(handler);
    if (bucket!.size === 0) subscribers.delete(userId);
  };
}
```

`seq` is monotonic per user; clients dedupe by `entityId` so a replay is harmless. `ts` is server-side ISO 8601.

### `ws.ts` — broadcaster

```ts
const socketsByUser = new Map<string, Set<ServerWebSocket<Attachment>>>();
const unsubByUser = new Map<string, () => void>();

function ensureSubscription(userId) {
  if (unsubByUser.has(userId)) return;
  unsubByUser.set(userId, subscribe(userId, (event) => fanout(userId, event)));
}

function fanout(userId, event) {
  const sockets = socketsByUser.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const ws of sockets) ws.send(payload);
}

export function attachSocket(ws) {
  ensureSubscription(ws.data.userId);
  socketsByUser.get(ws.data.userId)!.add(ws);
  ws.send(JSON.stringify({ type: 'connected', ts: new Date().toISOString() }));
}

export function detachSocket(ws) {
  const bucket = socketsByUser.get(ws.data.userId);
  if (!bucket) return;
  bucket.delete(ws);
  if (bucket.size === 0) {
    socketsByUser.delete(ws.data.userId);
    unsubByUser.get(ws.data.userId)?.();
    unsubByUser.delete(ws.data.userId);
  }
}
```

Two design choices worth highlighting:

1. **One bus subscription per user, not per socket.** Multiple browser tabs share the subscription, then each tab gets the event via the per-user `Set`. Cuts subscription churn in half when a user reloads.
2. **Lazy subscription teardown.** When the last socket for a user disconnects, we call the unsubscribe function so the bus map shrinks. Idle users don't keep map entries forever.

## Event vocabulary

The discriminated union in `packages/shared/src/events.ts`:

| Type | Emitted from | Payload (`data`) |
| --- | --- | --- |
| `transaction.created` | `services/transactions/create.ts` | `{ transactionId, walletId, type, amount, baseAmount, currency, date, description, category }` |
| `transaction.updated` | `routes/transactions.ts` PATCH, `/category` | `{ transactionId, changedFields[] }` |
| `transaction.deleted` | `routes/transactions.ts` DELETE | `{ transactionId }` |
| `budget.warning` | `services/budgets/index.ts` (first crossing of warnThreshold) | `{ budgetId, category, allocated, spent, percentage }` |
| `budget.exceeded` | same (first crossing of exceedThreshold) | `{ budgetId, category, allocated, spent, overBy }` |
| `goal.updated` | `routes/goals.ts` (CRUD + `/progress`) | `{ goalId, currentAmount, progressPercentage, atRisk }` |
| `recurring.detected` | `services/forecast/recurring.ts:runDetector` | `{ recurringId, displayName, averageAmount, frequencyDays }` |
| `forecast.invalidated` | `services/forecast/index.ts:invalidateForecast` (called from txn + recurring events) | `{ reason: 'transaction_change' \| 'recurring_change' \| 'manual' }` |
| `wallet.updated` | `routes/wallets.ts` POST/PATCH | `{ walletId, balance }` |
| `ledger.updated` | `services/ledger/index.ts` | `{ entryId, direction, outstanding, status }` |

Each event also carries `type`, `seq`, `entityId`, `ts` from the envelope.

## Client side (planned for Phase 12)

```ts
// apps/web/src/lib/api/ws.ts
export class FinehanceSocket {
  private ws: WebSocket | null = null;
  private retryDelay = 1000;
  private maxRetryDelay = 30000;
  private accessToken: () => string;
  private listeners = new Map<WsEventType, Set<(event: WsEvent) => void>>();

  constructor(accessToken: () => string) { this.accessToken = accessToken; }

  connect() {
    const url = new URL('/ws', PUBLIC_WS_URL);
    this.ws = new WebSocket(url, [`bearer.${this.accessToken()}`]);
    this.ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as WsEvent;
      const handlers = this.listeners.get(event.type);
      if (handlers) for (const h of handlers) h(event);
    };
    this.ws.onclose = () => {
      setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.maxRetryDelay, this.retryDelay * 2);
    };
    this.ws.onopen = () => { this.retryDelay = 1000; };
  }

  on<T extends WsEventType>(type: T, handler: (event: Extract<WsEvent, { type: T }>) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler as any);
    return () => this.listeners.get(type)!.delete(handler as any);
  }
}
```

The store layer wires events into TanStack Query cache:

```ts
socket.on('transaction.created', (event) => {
  queryClient.setQueryData(['transactions'], (old) => [event.data, ...(old ?? [])]);
});
socket.on('budget.warning', (event) => {
  toast.warning(`Budget alert: ${event.data.category} at ${event.data.percentage.toFixed(0)}%`);
});
```

## Failure modes

### The socket drops mid-conversation

Auto-reconnect with exponential backoff (1s, 2s, 4s, ... cap 30s). On reconnect, the client re-fetches the relevant query data (txn list, budget progress) since it doesn't have a way to know which events it missed.

A future v2 could add an `Event-Resume-After: <seq>` header on reconnect; the server replays missed events from a circular buffer. Not in MVP scope.

### The user opens 10 tabs

Each tab opens its own WebSocket. The broadcaster sends each event 10 times (once per socket). For our scale this is fine; if it becomes a concern, deduplication could move to a SharedWorker on the client.

### The API restarts

All sockets close. Clients reconnect within ~1s. Any events that fired during the outage are lost (no persistence). Acceptable for MVP — the worst case is "your dashboard was 30 seconds out of date".

### Bot crashes WS spam

The bot doesn't connect a WebSocket — it pushes events server-side via the bus, which then fans out to every web socket for the same user. If the bot misbehaves, the API process is its blast radius, not the WS layer.

## Heartbeats

We don't currently send pings. Bun's WebSocket implementation closes idle sockets after `idleTimeout` (set to 30s on the Bun.serve config). The client's reconnect logic handles the close cleanly.

If demoing across a flaky NAT, we'd add a 25-second `setInterval` that sends a `{ "type": "ping" }` from server to client. Not needed for laptop-on-WiFi.

## CORS

Bun's WebSocket upgrade respects the same `Origin` header check as HTTP. The Hono CORS middleware (set in `index.ts`) is HTTP-only — it doesn't apply to the WS path because the upgrade happens before Hono sees the request.

For the demo we accept any origin; the access token in the subprotocol is the actual security.

## Testing

`apps/api/scripts/smoke-*.ts` doesn't currently exercise the WS path because we'd need a small WebSocket client harness. The plan in [15-roadmap.md](./15-roadmap.md) Phase 17 includes a `smoke-ws.ts` that:

1. Registers + logs in.
2. Connects WebSocket with `bearer.<token>` subprotocol.
3. Posts a transaction.
4. Asserts the next message on the socket has `type: 'transaction.created'` and matches the posted transaction id.

## Ops checklist

- [ ] Verify upgrade with `wscat -c 'ws://127.0.0.1:5000/ws' -s 'bearer.<token>'` — should print `connected`.
- [ ] Post a transaction in another terminal — should print the event JSON on the wscat session.
- [ ] Disconnect the API — wscat should reconnect within a few seconds (when the API is back).
- [ ] Open 5 tabs — each receives every event. Verify per-user fan-out works.

This is the spine that makes "WhatsApp message → web dashboard updates instantly" possible. Without it, we'd be polling every N seconds.
