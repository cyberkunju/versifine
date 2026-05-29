# 05 · API Surface

> Bun + Hono on `:5000`. 14 mounted routers. WebSocket upgrade on `/ws`. Every body validated by Zod. Every response wrapped in `{ success: true, data }` or `{ success: false, error }`.

## Conventions

### Response envelope

```json
// success
{ "success": true, "data": { /* shape depends on route */ } }

// failure
{
  "success": false,
  "error": {
    "code": "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "UPSTREAM_AI" | "INTERNAL",
    "message": "Human-readable",
    "details": { /* optional, route-specific */ }
  }
}
```

### Auth headers

| Caller | Header(s) |
| --- | --- |
| Web | `Authorization: Bearer <accessToken>` |
| Bot (server-to-server) | `X-Bot-Secret: <BOT_SECRET>` + `X-Phone: 919876543210` |
| Health/QR/auth-bootstrap | none |

### Standard headers we emit

- `x-request-id` — propagated from the inbound request or generated; printed on every log line for that request
- `x-ratelimit-remaining` — current bucket level for rate-limited routes

### Error codes

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION` | Body / query param fails Zod parse |
| 401 | `UNAUTHORIZED` | Missing/expired/invalid JWT, missing bot secret, OTP not found |
| 403 | `FORBIDDEN` | JWT valid but lacks the requested space membership |
| 404 | `NOT_FOUND` | Entity not in caller's space |
| 409 | `CONFLICT` | Duplicate (e.g., email already registered, phone already linked) |
| 429 | `RATE_LIMITED` | Token bucket exhausted |
| 500 | `INTERNAL` | Unhandled exception (stack in logs, generic message in body) |
| 502 | `UPSTREAM_AI` | OpenAI call failed and we couldn't fall back |

## Mounted routers

```
/health        → routes/health.ts
/auth          → routes/auth.ts
/capture       → routes/capture.ts
/wallets       → routes/wallets.ts
/transactions  → routes/transactions.ts
/budgets       → routes/budgets.ts
/goals         → routes/goals.ts
/ledger        → routes/ledger.ts
/recurring     → routes/recurring.ts
/forecast      → routes/forecast.ts
/reports       → routes/reports.ts
/advice        → routes/advice.ts
/copilot       → routes/copilot.ts
/ws            → routes/ws.ts (handler returns 426; the actual upgrade lives in index.ts Bun.serve.fetch)
```

## Endpoint reference

### `/health`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/` | none | Liveness + uptime + timestamp |
| GET | `/ready` | none | Liveness + DB ping (`SELECT 1`) |

### `/auth`

| Method | Path | Auth | Body / Query | Description |
| --- | --- | --- | --- | --- |
| POST | `/register` | none | `{ email, password, displayName?, primaryLanguage? }` | Create user + personal space + default INR cash wallet + token pair. Rate-limited per IP. |
| POST | `/login` | none | `{ email, password }` | Verify credentials → token pair. Always runs the bcrypt verify even when user not found (timing-safe). |
| POST | `/refresh` | none | `{ refreshToken }` | Rotate. Reuse-detection: if a previously-rotated token is presented, **all** of that user's tokens are revoked. |
| POST | `/logout` | bearer | `{ refreshToken? }` | Revokes the supplied refresh token; access token expires naturally. |
| GET | `/me` | bearer | — | Current user profile. |
| POST | `/phone-link/start` | bearer | — | Mints a 6-digit OTP, 10-minute TTL. In dev mode the response includes the code; in prod it doesn't. |
| POST | `/phone-link/confirm` | none | `{ code, phone }` | Web-side confirmation path (alternative to the bot path of sending `LINK 123456` via WhatsApp). |

### `/capture`

| Method | Path | Auth | Body | Description |
| --- | --- | --- | --- | --- |
| POST | `/text` | bearer or bot | `{ text, locale?, hint? }` | Full pipeline: intent → parse → wallet pick → persist (or draft for confirmation). Rate-limited per user. |
| POST | `/voice` | bearer or bot | multipart `audio` (file) + `locale?` | Whisper transcribe → text path. |
| POST | `/image` | bearer or bot | multipart `image` (file) + `locale?` | gpt-4o vision → always returns a draft for confirmation. |
| POST | `/confirm` | bearer or bot | `{ draftId, edits? } \| { draftId, text? }` | Commits a draft. Edits override fields; text re-runs the parser to fill nulls. |

**Capture response shape (uniform for all four):**

```json
{
  "success": true,
  "data": {
    "intent": "expense" | "income" | "transfer" | "set_budget" | "query_spending" | "query_summary" | "query_forecast" | "ask_advice" | "lend" | "borrow" | "correct_last" | "delete_last" | "chat" | "unknown",
    "needsConfirmation": false,
    "draftId": "01J...",
    "draft": { /* TransactionDraft, when needsConfirmation=true */ },
    "followupQuestion": "How much was it?",
    "queryResult": { "transaction": { /* TransactionSummary */ } },
    "copilotStreamUrl": "/copilot/chat",
    "echo": "spent 450 on auto"
  }
}
```

### `/wallets`

| Method | Path | Body / Query | Description |
| --- | --- | --- | --- |
| GET | `/` | — | List with live balances (single SQL aggregate). |
| POST | `/` | `{ name, type, currency?, openingBalance? }` | Create. Opening balance > 0 inserts an `opening_balance` transaction. |
| GET | `/:id` | — | Detail with balance. |
| PATCH | `/:id` | `{ name?, archived? }` | Rename / archive. |
| DELETE | `/:id` | — | Archive (soft); transactions remain intact. |
| POST | `/transfer` | `{ fromWalletId, toWalletId, amount, description?, date? }` | Atomic two-row transfer with shared `transfer_id`. Cross-currency uses FX. |

### `/transactions`

| Method | Path | Body / Query | Description |
| --- | --- | --- | --- |
| GET | `/` | `?from&to&type&category&walletId&search&tag&limit&offset` | Filtered list with pagination. |
| POST | `/` | `TransactionCreateInput` | Manual create. |
| GET | `/export` | `?from&to&...` | CSV stream of up to 5000 rows. |
| POST | `/import` | multipart `file` (CSV) | Bulk import. Returns `{ imported, skipped, errors[] }`. |
| GET | `/:id` | — | Detail. |
| PATCH | `/:id` | `TransactionUpdateInput` | Partial update; category change records correction + upserts override. |
| DELETE | `/:id` | — | Soft delete. |
| POST | `/:id/category` | `{ category }` | Explicit category correction (also records correction + upserts override). |

### `/budgets`

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| GET | `/` | — | List. |
| POST | `/` | `{ name, recurrence, allocations, warnThreshold?, exceedThreshold?, periodStart?, periodEnd? }` | Create. |
| GET | `/:id` | — | Detail. |
| PATCH | `/:id` | `{ name?, allocations?, warnThreshold?, exceedThreshold? }` | Update. |
| DELETE | `/:id` | — | Hard delete. |
| GET | `/:id/progress` | — | Per-category progress + totals + status (`ok` / `warn` / `exceeded`). |

### `/goals`

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| GET | `/` | `?status=active\|achieved\|archived` | List with serialized progress + atRisk. |
| POST | `/` | `{ name, targetAmount, currentAmount?, deadline?, linkedCategory? }` | Create + emit goal.updated. |
| GET | `/:id` | — | Detail. |
| PATCH | `/:id` | partial | Update + emit. |
| DELETE | `/:id` | — | Hard delete. |
| POST | `/:id/progress` | `{ amount, note? }` | Add to current_amount + emit. |

### `/ledger`

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| GET | `/` | `?direction&status&counterpartyName` | List entries. |
| POST | `/` | `{ direction, counterpartyName, amount, currency?, date, note?, linkedTransactionId? }` | Create. Base amount converted via FX. |
| GET | `/:id` | — | Detail. |
| POST | `/:id/settle` | `{ amount, date, walletId? }` | Apply settlement. With walletId, also creates a wallet transaction. |

### `/recurring`

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| GET | `/` | `?status=active\|dismissed` | List detected items. |
| POST | `/run` | — | Trigger detection over last 90 days. Invalidates forecast cache. |
| PATCH | `/:id` | `{ status }` | Dismiss / re-activate. |

### `/forecast`

| Method | Path | Query | Description |
| --- | --- | --- | --- |
| GET | `/` | `?days=7\|14\|30\|60\|90` (default 30) | Recurring-decomposed ARIMA forecast. 6h cache. |

Response shape:

```json
{
  "forecast": {
    "recurringBase": 24999.50,
    "variableTotal": 18342.30,
    "total": 43341.80,
    "method": "arima" | "rolling_average",
    "daily": [
      { "date": "2026-05-29", "recurring": 199, "variable": 612.10, "lower": 540, "upper": 1060 },
      // ... 30 entries
    ],
    "anomalies": [
      { "date": "2026-04-15", "amount": 9300, "expected": 1200, "z": 5.4 }
    ]
  }
}
```

### `/reports`

| Method | Path | Query | Description |
| --- | --- | --- | --- |
| GET | `/summary` | `?from&to` (YYYY-MM-DD, required) | JSON summary. |
| GET | `/summary.csv` | `?from&to` | CSV download with totals, by-category, by-merchant, by-wallet, budget adherence sections. |

### `/advice`

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | 3–5 ranked advice items. LLM-backed when `OPENAI_API_KEY` is set, deterministic rule-based otherwise. |

### `/copilot`

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| POST | `/chat` | `{ messages: [{ role, content }, ...], traceId? }` | SSE stream of model output + tool calls + tool results + final `done` marker. Rate-limited (20/min/user). |

**SSE event types (each line is `data: <json>\n\n`):**

- `{ "type": "chunk", "delta": "..." }` — partial assistant content
- `{ "type": "tool_call", "name": "compute_total", "args": "{\"category\":\"Food\"}" }`
- `{ "type": "tool_result", "name": "compute_total", "result": { ... } }`
- `{ "type": "done", "messageId": "..." }`
- `{ "type": "error", "message": "..." }`

The tool-call loop caps at 4 rounds per turn. Tools available: `compute_total`, `compute_category_breakdown`, `compute_forecast`, `find_recurring`, `compare_periods`.

### `/ws`

Bun handles the upgrade in `index.ts:fetch`. The Hono router on `/ws` returns a 426 with a hint message for non-WebSocket clients.

**Connect from a browser:**

```js
const ws = new WebSocket(`${PUBLIC_WS_URL}/ws`, [`bearer.${accessToken}`]);
ws.onmessage = (e) => {
  const event = JSON.parse(e.data);
  // event.type, event.entityId, event.seq, event.data
};
```

The auth subprotocol is `bearer.<jwt>`. Authorization header is also accepted (curl-friendly).

**Events you'll receive** (from `@versifine/shared`'s `WsEvent` union):

- `transaction.created` — new transaction
- `transaction.updated` — edit (changedFields list)
- `transaction.deleted` — soft delete
- `budget.warning` — first crossing of 80%
- `budget.exceeded` — first crossing of 100%
- `goal.updated` — goal progress changed
- `recurring.detected` — new recurring item (after `/recurring/run`)
- `forecast.invalidated` — cache busted (recompute on next GET)
- `wallet.updated` — wallet balance changed (currently only on create/update)
- `ledger.updated` — ledger entry status changed

Each carries `entityId` and `seq`; clients dedupe by `entityId`.

## Rate limits

In-memory token bucket, three presets:

| Bucket | Capacity | Refill | Keyed by |
| --- | --- | --- | --- |
| `auth` | 10 | 10/min | IP (or `auth-anon`) |
| `capture` | 60 | 60/min | user id (or `phone:<digits>`) |
| `copilot` | 20 | 20/min | user id |

## OpenAPI / Scalar

`@scalar/hono-api-reference` is installed for a future `/api-reference` route. Not mounted yet — the spec generation pass (Phase 17) will wire it.

## Bot trust boundary

The bot signs server-to-server calls with `X-Bot-Secret: <BOT_SECRET>` + `X-Phone: <digits>`. The `requireBot` middleware:
1. Verifies the secret matches `env.BOT_SECRET` (constant-time).
2. Resolves the user by `whatsapp_phone = <normalized digits>`.
3. Sets `c.var.user` with the same shape as a JWT-authed user.

Either-or auth (`requireUserOrBot`) is used by `/capture/*` so the same routes serve both surfaces.

## Quick reference: curl recipes

```bash
# Boot a user end-to-end
curl -sX POST http://127.0.0.1:5000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"demo@versifine.com","password":"Versifine#2026!","primaryLanguage":"en"}'

# Capture an expense (paste accessToken from above)
TOKEN=eyJ...
curl -sX POST http://127.0.0.1:5000/capture/text \
  -H "authorization: bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"text":"spent 450 on auto"}'

# List transactions
curl -s "http://127.0.0.1:5000/transactions?limit=10" \
  -H "authorization: bearer $TOKEN"

# Stream copilot
curl -NX POST http://127.0.0.1:5000/copilot/chat \
  -H "authorization: bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"How much did I spend on transport this month?"}]}'
```
