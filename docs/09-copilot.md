# 09 · Copilot RAG + Tool Calling

> The AI co-pilot that answers questions about the user's money. Streaming SSE, RAG-grounded, math-via-tools, gpt-4o-mini.

## Hard rules baked into the system prompt

```
You are Vivien, Finehance's personal-finance copilot.

Hard rules:
- Never invent or estimate amounts. For any math, call one of the tools.
- If the data does not contain the answer, say so plainly and offer to look further.
- Be brief. Numbers belong in real currency formatting (₹4,250 / $50 / etc).
- Default tone: warm, factual, decisive. Avoid hedging adverbs ("maybe", "kind of").
```

These four lines are how we structurally prevent number hallucination. The model never sees raw amounts unless they came through a tool — that's how we know any number it cites is real.

## Pipeline (`routes/copilot.ts:POST /copilot/chat`)

```
1. Parse + validate body (CopilotChatInput Zod schema).
2. requireUser middleware → user, activeSpaceId.
3. copilotLimit middleware (20 req / 60s / user).
4. Find the last user message in the conversation.
5. Embed it with text-embedding-3-small (`embed()`).
6. PgVector cosine search top-20 transactions in the user's space:
     SELECT date, amount, category, description
     FROM transaction_embeddings te
     JOIN transactions t ON t.id = te.transaction_id
     WHERE te.space_id = $1 AND t.deleted_at IS NULL
     ORDER BY te.embedding <=> $2::vector
     LIMIT 20
7. Aggregate context block in parallel:
     - this month income/expense/savings
     - last month income/expense/savings
     - top 5 expense categories this month
     - active recurring items (up to 20)
     - active goals (up to 10)
     - retrieved transactions from step 6
8. Render the context block as a structured plaintext header.
9. Build the conversation:
     [
       { role: 'system', content: SYSTEM_PROMPT },
       { role: 'system', content: 'User context:\n<rendered context>' },
       ...incoming messages
     ]
10. Run the tool-call loop (cap 4 rounds per turn):
     a. client.chat.completions.create({ model, stream: true, tools, tool_choice: 'auto' })
     b. For each chunk, send SSE { type: 'chunk', delta }
     c. Accumulate any tool_calls in this round
     d. If any tool calls, dispatch each, send SSE tool_call + tool_result,
        append to conversation, loop
     e. If no tool calls, send SSE { type: 'done' }, close stream
11. On error, send SSE { type: 'error', message }, close stream.
```

## Context block (rendered for the system prompt)

```
USER LANGUAGE: en
BASE CURRENCY: INR

THIS MONTH:
  income=₹85000.00 expense=₹47320.50 savings=₹37679.50
LAST MONTH:
  income=₹85000.00 expense=₹52840.00 savings=₹32160.00

TOP CATEGORIES THIS MONTH:
  Groceries: ₹14250
  Restaurants: ₹9800
  Transportation: ₹6420
  Bills & Utilities: ₹5200
  Subscriptions: ₹3680

ACTIVE RECURRING:
  Netflix: ₹649 every 30d (next 2026-06-11)
  Spotify: ₹119 every 30d (next 2026-06-07)
  Zerodha SIP: ₹5000 every 30d (next 2026-06-05)
  Rent: ₹18000 every 30d (next 2026-06-01)
  Internet: ₹999 every 30d (next 2026-06-14)

ACTIVE GOALS:
  Emergency Fund: ₹125000/₹250000 (50%)
  Macbook: ₹40000/₹200000 (20%) by 2026-12-31

RELEVANT RECENT TRANSACTIONS (top by similarity):
  2026-05-26 ₹450 Transportation — UPI/RAPIDO/...
  2026-05-25 ₹620 Transportation — UBER TRIP
  2026-05-24 ₹180 Transportation — auto rickshaw
  ... (up to 12)

Today's date: 2026-05-28
```

The retrieved transactions are pre-filtered to the user's space and capped at 12 in the prompt (the full 20 are kept in memory for tool calls). Description is sliced to 200 chars to control prompt length.

## Tools — `services/ai/copilotTools.ts`

Five tools, each a pure function the LLM can call. All run inside the API process against the same Drizzle connection, scoped to the caller's `space_id`.

### `compute_total`

```ts
args: { category?: string, type?: 'income' | 'expense', from?: string, to?: string }
returns: { total: number, count: number, currency: string, range: { from, to } }
```

`SELECT SUM(base_amount), COUNT(*) FROM transactions WHERE space_id=$1 AND ...filters...`

If `from`/`to` not provided, defaults to current month.

### `compute_category_breakdown`

```ts
args: { from?: string, to?: string, top?: number }
returns: { items: [{ category, total }], total: number, range: { from, to } }
```

`GROUP BY category ORDER BY SUM DESC LIMIT $top`. Default top=10.

### `compute_forecast`

```ts
args: { days?: 7 | 14 | 30 | 60 | 90 }
returns: ForecastResult (recurringBase, variableTotal, total, daily, anomalies, method)
```

Calls `services/forecast/index.ts:computeForecast()`. Cached for 6h.

### `find_recurring`

```ts
args: { status?: 'active' | 'dismissed', minAmount?: number }
returns: { items: RecurringItem[], totalMonthly: number }
```

`SELECT * FROM recurring_items WHERE space_id=$1 AND status=$2 AND average_amount >= $3`. The `totalMonthly` is the projected monthly total (sum of `average_amount * 30 / frequency_days`).

### `compare_periods`

```ts
args: {
  a: { from: string, to: string },
  b: { from: string, to: string },
  by?: 'category' | 'merchant' | 'wallet'  // default 'category'
}
returns: {
  a: { total, items: [...] },
  b: { total, items: [...] },
  deltas: [{ key, aTotal, bTotal, delta, percentChange }]
}
```

Two parallel `compute_category_breakdown` calls plus a delta join.

## Tool dispatch — the loop

```ts
const MAX_ROUNDS = 4;
for (let round = 0; round < MAX_ROUNDS; round += 1) {
  const stream = await client.chat.completions.create({
    model: env.OPENAI_CHAT_MODEL,
    temperature: 0.4,
    stream: true,
    messages: conversation,
    tools,
    tool_choice: 'auto',
  });

  // Accumulate streamed chunks AND tool_calls
  let assistantContent = '';
  const toolCalls = [];
  for await (const part of stream) {
    if (part.choices[0]?.delta?.content) {
      assistantContent += part.choices[0].delta.content;
      send({ type: 'chunk', delta: part.choices[0].delta.content });
    }
    if (part.choices[0]?.delta?.tool_calls) {
      // accumulate by index ...
    }
  }

  if (toolCalls.length > 0) {
    // Append the assistant tool-call request to the conversation
    conversation.push({ role: 'assistant', content: assistantContent || null, tool_calls: ... });

    for (const tc of toolCalls) {
      send({ type: 'tool_call', name: tc.name, args: tc.args });
      const result = await dispatchTool(user.activeSpaceId, tc.name, tc.args);
      send({ type: 'tool_result', name: tc.name, result });
      conversation.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
    continue;  // next round, with tool results in the conversation
  }

  // No tool call → done
  send({ type: 'done', messageId });
  return;
}
send({ type: 'error', message: 'Tool-call loop exceeded the per-turn budget.' });
```

The 4-round cap is critical. Without it, a model that decides to call `compute_total` then `compute_total` then `compare_periods` then `compute_forecast` etc. could burn through your rate limit on a single turn. 4 rounds is enough for any sensible question we've tested ("compare last month to this month broken down by category" needs 1 tool call; "what was my biggest expense and is it recurring?" needs 2).

## SSE protocol

Every line in the response is `data: <json>\n\n`. Event types:

| Type | Payload |
| --- | --- |
| `chunk` | `{ type: 'chunk', delta: '...' }` — partial assistant content |
| `tool_call` | `{ type: 'tool_call', name: 'compute_total', args: '{"category":"Food"}' }` — tool name announcement before dispatch |
| `tool_result` | `{ type: 'tool_result', name: 'compute_total', result: { total: 14250, count: 47, currency: 'INR', range: {...} } }` |
| `done` | `{ type: 'done', messageId: '...' }` — final marker |
| `error` | `{ type: 'error', message: '...' }` — terminal failure |

## Headers

Every copilot response sets:

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`X-Accel-Buffering: no` disables nginx buffering when the API is behind a reverse proxy in production.

## When OPENAI_API_KEY is absent

The route returns 503 `UPSTREAM_AI`:

```json
{
  "success": false,
  "error": {
    "code": "UPSTREAM_AI",
    "message": "Copilot requires OPENAI_API_KEY to be set on the server."
  }
}
```

Every other route still works without an API key — only the copilot is gated.

## Rate limiting

`limits.copilot = { capacity: 20, refillTokens: 20, refillIntervalMs: 60_000 }`. 20 turns per minute per user. Generous enough that no real user hits it, tight enough that a runaway tab refreshing the chat won't burn through the budget.

## Cost per turn (rough)

- Embed query: 1× `text-embedding-3-small` call, ~30 tokens, ~$0.0000015.
- Aggregate queries: 0 LLM cost.
- LLM streaming: ~1500 input tokens (system + context + user), ~500 output tokens, ~$0.0003 per turn.
- Tool calls: 0 LLM cost (Drizzle queries against Postgres).

A 5-message conversation with 2 tool rounds: ~$0.002. Negligible.

## Worked example

User asks: "How much did I spend on transport this month?"

1. Embed → vector
2. Cosine search top-20 → mostly transport txns
3. Aggregates → context block above
4. LLM streams: `Looking at your transport...` → calls `compute_total({"category":"Transportation","from":"2026-05-01","to":"2026-05-28"})`
5. Tool returns `{ total: 6420, count: 23, currency: 'INR', range: {...} }`
6. LLM streams: `You've spent ₹6,420 on transport this month across 23 trips. That's about 14% of your total expenses, on track with last month's ₹6,800.`
7. Done.

The "track with last month" came from the context block, not a second tool call — the LLM saw the breakdown already.

## Why streaming?

- Latency perception: first chunk arrives in ~600ms; total response ~3s. Without streaming the user stares at a spinner for 3s.
- Tool transparency: the user sees `tool_call → tool_result` events, builds trust that the answer is grounded.
- Cancellable: closing the SSE stream cancels the upstream OpenAI call (Bun handles this through the request abort signal).

## Why a single context block, not iterative retrieval?

We could let the LLM call a `search_transactions(query)` tool to retrieve more context iteratively. We chose pre-fetched context because:
- One vector search per turn is cheaper than letting the model decide when to search.
- The aggregates (this month / last month / top categories) cover 80% of questions without retrieval.
- The retrieved transactions act as evidence; the LLM doesn't need to "find" them again.
- One round of tools is enough for math; iterative retrieval would push us past the 4-round cap.

Future iteration could add a `search_transactions` tool when the dashboard needs deep-history questions like "show me what I spent on coffee in March 2025", but for the demo dataset (90 days) the current context is enough.

## Web client (planned for Phase 15)

```svelte
<script lang="ts">
  import { useChat } from '$lib/copilot/use-chat';
  const chat = useChat();
</script>

<div class="messages">
  {#each chat.messages as m}
    <MessageBubble message={m} />
  {/each}
  {#if chat.streaming}
    <MessageBubble message={chat.draft} />
  {/if}
</div>

<input bind:value={chat.input} on:submit={chat.send} />
```

The `useChat` hook (to be written) wraps Vercel AI SDK's `streamText` reader to consume the SSE protocol above and append chunks to the draft message in real time.

## Bot client (planned for Phase 11)

The WhatsApp bot calls `/copilot/chat` only for the `chat` intent path. Because WhatsApp doesn't support streaming text bubbles, the bot:

1. Buffers the streamed chunks until `done`.
2. Splits the final text via `chunkText(maxLen=1500)`.
3. Sends each chunk as a separate WhatsApp message (numbered if more than one).
4. Optionally synthesizes voice for the first chunk only (TTS_MAX_CHARS cap).

Tool result events are dropped from the bot path — they'd be too verbose. The user sees the final answer only.
