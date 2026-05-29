/**
 * Copilot route — RAG chat with tool-calling.
 *
 *   POST /copilot/chat   { messages: [...] }
 *
 * Streams Server-Sent Events. Each line is one of:
 *   data: {"type":"chunk","delta":"..."}            partial content
 *   data: {"type":"tool_call","name":"...","args":...}   tool name announcement
 *   data: {"type":"tool_result","name":"...","result":...}  tool output
 *   data: {"type":"done","messageId":"..."}         final marker
 *   data: {"type":"error","message":"..."}          on failure
 *
 * The pipeline:
 *   1. Embed the user's last message via text-embedding-3-small.
 *   2. Cosine-search the top 20 transaction_embeddings for this space.
 *   3. Build a structured context block: monthly totals, top categories,
 *      active recurring items, active goals, recent retrieved transactions.
 *   4. Call gpt-4o-mini with the context + tools enabled.
 *   5. If the model issues a tool call, dispatch it (compute_total etc.),
 *      append the result as a `tool` message, and resume streaming.
 *   6. Stream every token to the client as it arrives.
 *
 * Hard rules baked into the system prompt:
 *   - Never fabricate numbers; call a tool for any math.
 *   - If the answer isn't in the data, say so and offer to fetch it.
 *   - Reply in the user's primary language when one is set.
 */
import { sql as drizzleSql, and, desc, eq, isNull, gte, isNotNull, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { copilotChatInput } from '@versifine/shared';
import { db } from '../db/client.ts';
import { goals } from '../db/schema/goals.ts';
import { recurringItems } from '../db/schema/recurring.ts';
import { transactionEmbeddings } from '../db/schema/embeddings.ts';
import { transactions } from '../db/schema/transactions.ts';
import { env } from '../env.ts';
import { requireUser, type AuthedUser } from '../middleware/auth.ts';
import { limits, rateLimit } from '../middleware/rateLimit.ts';
import { embed } from '../services/ai/embed.ts';
import { getOpenAI, isAIConfigured, withLatency } from '../services/ai/client.ts';
import {
  COPILOT_TOOL_SPECS,
  dispatchTool,
} from '../services/ai/copilotTools.ts';
import { errors } from '../utils/errors.ts';
import { log } from '../utils/logger.ts';

const app = new Hono();
app.use('*', requireUser);

const copilotLimit = rateLimit({
  ...limits.copilot,
  key: (c) => {
    const u = c.get('user');
    return u?.id ? `copilot:${u.id}` : null;
  },
});

const SYSTEM_PROMPT = [
  "You are Vivien, Versifine's personal-finance copilot.",
  '',
  'Your job: answer the user\'s questions about THEIR money, grounded in the data shown to you.',
  '',
  'Hard rules:',
  '- Never invent or estimate amounts. For any math, call one of the tools.',
  '- If the data does not contain the answer, say so plainly and offer to look further.',
  '- Be brief. Numbers belong in real currency formatting (₹4,250 / $50 / etc).',
  '- When the user asks "how much" / "what was the most" / "compare months", reach for compute_total, compute_category_breakdown, compare_periods.',
  '- When the user asks "what\'s coming up" / "next 30 days", reach for compute_forecast and find_recurring.',
  '- Default tone: warm, factual, decisive. Avoid hedging adverbs ("maybe", "kind of"). Confirm what you did before asking what they want next.',
].join('\n');

function buildSseChunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

interface ContextSummary {
  thisMonth: { income: number; expense: number; savings: number };
  lastMonth: { income: number; expense: number; savings: number };
  topCategoriesThisMonth: Array<{ category: string; total: number }>;
  recurring: Array<{
    displayName: string;
    averageAmount: number;
    frequencyDays: number;
    nextExpectedDate: string | null;
  }>;
  goals: Array<{ name: string; target: number; current: number; progress: number; deadline: string | null }>;
  retrieved: Array<{
    date: string;
    amount: number;
    category: string | null;
    description: string;
  }>;
}

function monthBounds(date: Date): { from: string; to: string } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

async function aggregateMonth(
  spaceId: string,
  range: { from: string; to: string },
): Promise<{ income: number; expense: number; savings: number }> {
  const rows = await db
    .select({
      type: transactions.type,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.spaceId, spaceId),
        isNull(transactions.deletedAt),
        gte(transactions.date, range.from),
        lte(transactions.date, range.to),
      ),
    )
    .groupBy(transactions.type);
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    if (r.type === 'income') income += Number(r.total);
    else if (r.type === 'expense') expense += Number(r.total);
  }
  return { income: round2(income), expense: round2(expense), savings: round2(income - expense) };
}

async function aggregateTopCategories(
  spaceId: string,
  range: { from: string; to: string },
): Promise<Array<{ category: string; total: number }>> {
  const rows = await db
    .select({
      category: transactions.category,
      total: drizzleSql<string>`coalesce(sum(${transactions.baseAmount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.spaceId, spaceId),
        eq(transactions.type, 'expense'),
        isNotNull(transactions.category),
        isNull(transactions.deletedAt),
        gte(transactions.date, range.from),
        lte(transactions.date, range.to),
      ),
    )
    .groupBy(transactions.category)
    .orderBy(desc(drizzleSql`sum(${transactions.baseAmount})`))
    .limit(5);
  return rows
    .filter((r) => r.category !== null)
    .map((r) => ({ category: r.category as string, total: round2(Number(r.total)) }));
}

async function retrieveRelevant(
  spaceId: string,
  queryVector: number[],
): Promise<ContextSummary['retrieved']> {
  if (queryVector.every((v) => v === 0)) return [];
  // Cosine distance via pgvector. Drizzle doesn't expose the vector op
  // directly, so we drop into raw SQL through the orderBy escape hatch.
  const literal = `[${queryVector.join(',')}]`;
  const rows = await db
    .select({
      date: transactions.date,
      amount: transactions.baseAmount,
      category: transactions.category,
      description: transactions.description,
    })
    .from(transactionEmbeddings)
    .innerJoin(transactions, eq(transactions.id, transactionEmbeddings.transactionId))
    .where(
      and(
        eq(transactionEmbeddings.spaceId, spaceId),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(drizzleSql`${transactionEmbeddings.embedding} <=> ${literal}::vector`)
    .limit(20);
  return rows.map((r) => ({
    date: r.date,
    amount: round2(Number(r.amount)),
    category: r.category,
    description: r.description.slice(0, 200),
  }));
}

async function buildContext(spaceId: string, lastUserMessage: string): Promise<ContextSummary> {
  const today = new Date();
  const thisMonthRange = monthBounds(today);
  const lastMonthRef = new Date(today);
  lastMonthRef.setUTCDate(1);
  lastMonthRef.setUTCMonth(lastMonthRef.getUTCMonth() - 1);
  const lastMonthRange = monthBounds(lastMonthRef);

  const [thisTotals, lastTotals, topCats, recurringRows, goalRows] = await Promise.all([
    aggregateMonth(spaceId, thisMonthRange),
    aggregateMonth(spaceId, lastMonthRange),
    aggregateTopCategories(spaceId, thisMonthRange),
    db
      .select()
      .from(recurringItems)
      .where(
        and(
          eq(recurringItems.spaceId, spaceId),
          eq(recurringItems.status, 'active'),
        ),
      )
      .limit(20),
    db
      .select()
      .from(goals)
      .where(and(eq(goals.spaceId, spaceId), eq(goals.status, 'active')))
      .limit(10),
  ]);

  // Vector search runs in parallel with the aggregates above when the API
  // key is configured. When it isn't, embed() returns a zero vector and
  // retrieveRelevant short-circuits.
  let retrieved: ContextSummary['retrieved'] = [];
  if (isAIConfigured()) {
    try {
      const queryVector = await embed(lastUserMessage);
      retrieved = await retrieveRelevant(spaceId, queryVector);
    } catch (err) {
      log.warn('COPILOT_RETRIEVAL_FAIL', {
        error: err instanceof Error ? err.message.slice(0, 240) : String(err),
      });
    }
  }

  return {
    thisMonth: thisTotals,
    lastMonth: lastTotals,
    topCategoriesThisMonth: topCats,
    recurring: recurringRows.map((r) => ({
      displayName: r.displayName,
      averageAmount: Number(r.averageAmount),
      frequencyDays: r.frequencyDays,
      nextExpectedDate: r.nextExpectedDate,
    })),
    goals: goalRows.map((g) => ({
      name: g.name,
      target: Number(g.targetAmount),
      current: Number(g.currentAmount),
      progress: Math.round(((Number(g.currentAmount) / Math.max(1, Number(g.targetAmount))) * 100) * 100) / 100,
      deadline: g.deadline,
    })),
    retrieved,
  };
}

function renderContextBlock(context: ContextSummary, user: AuthedUser): string {
  const lines: string[] = [];
  lines.push(`USER LANGUAGE: ${user.primaryLanguage}`);
  lines.push(`BASE CURRENCY: ${user.baseCurrency}`);
  lines.push('');
  lines.push('THIS MONTH:');
  lines.push(`  income=₹${context.thisMonth.income} expense=₹${context.thisMonth.expense} savings=₹${context.thisMonth.savings}`);
  lines.push('LAST MONTH:');
  lines.push(`  income=₹${context.lastMonth.income} expense=₹${context.lastMonth.expense} savings=₹${context.lastMonth.savings}`);
  if (context.topCategoriesThisMonth.length > 0) {
    lines.push('TOP CATEGORIES THIS MONTH:');
    for (const c of context.topCategoriesThisMonth) {
      lines.push(`  ${c.category}: ₹${c.total}`);
    }
  }
  if (context.recurring.length > 0) {
    lines.push('ACTIVE RECURRING:');
    for (const r of context.recurring) {
      lines.push(`  ${r.displayName}: ₹${r.averageAmount} every ${r.frequencyDays}d (next ${r.nextExpectedDate ?? '?'})`);
    }
  }
  if (context.goals.length > 0) {
    lines.push('ACTIVE GOALS:');
    for (const g of context.goals) {
      lines.push(`  ${g.name}: ₹${g.current}/₹${g.target} (${g.progress}%)${g.deadline ? ` by ${g.deadline}` : ''}`);
    }
  }
  if (context.retrieved.length > 0) {
    lines.push('RELEVANT RECENT TRANSACTIONS (top by similarity):');
    for (const t of context.retrieved.slice(0, 12)) {
      lines.push(`  ${t.date} ₹${t.amount} ${t.category ?? '-'} — ${t.description}`);
    }
  }
  lines.push('');
  lines.push('Today\'s date: ' + new Date().toISOString().slice(0, 10));
  return lines.join('\n');
}

app.post('/chat', copilotLimit, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = copilotChatInput.safeParse(body);
  if (!parsed.success) {
    throw errors.validation('Invalid copilot payload', { issues: parsed.error.issues });
  }
  const user = c.get('user');

  const lastUserMessage = parsed.data.messages
    .slice()
    .reverse()
    .find((m) => m.role === 'user')?.content ?? '';

  if (!isAIConfigured()) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UPSTREAM_AI',
          message: 'Copilot requires OPENAI_API_KEY to be set on the server.',
        },
      },
      503,
    );
  }

  const client = getOpenAI();
  if (!client) {
    return c.json(
      {
        success: false,
        error: { code: 'UPSTREAM_AI', message: 'OpenAI client not initialised.' },
      },
      503,
    );
  }

  const context = await buildContext(user.activeSpaceId, lastUserMessage);
  const contextBlock = renderContextBlock(context, user);

  // Build the conversation: system + context + user-supplied messages.
  const conversation: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `User context:\n${contextBlock}` },
    ...parsed.data.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })) as ChatCompletionMessageParam[],
  ];

  const tools = COPILOT_TOOL_SPECS as ChatCompletionTool[];
  const messageId = crypto.randomUUID();

  // Set up the SSE stream.
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(buildSseChunk(payload)));
        };

        try {
          // Loop: ask the model. If it calls a tool, dispatch it, append the
          // result, ask again. Cap iterations so a runaway tool-call cycle
          // can't burn the rate limit.
          const MAX_ROUNDS = 4;
          for (let round = 0; round < MAX_ROUNDS; round += 1) {
            // Build a fresh stream each round.
            const stream = await withLatency(
              `copilot.chat.round${round}`,
              async () =>
                client.chat.completions.create({
                  model: env.OPENAI_CHAT_MODEL,
                  temperature: 0.4,
                  stream: true,
                  messages: conversation,
                  tools,
                  tool_choice: 'auto',
                }),
            );

            const toolCalls: Array<{
              id: string;
              name: string;
              args: string;
            }> = [];
            let assistantContent = '';
            let finishReason: string | null = null;

            for await (const part of stream) {
              const choice = part.choices[0];
              if (!choice) continue;
              if (choice.delta?.content) {
                assistantContent += choice.delta.content;
                send({ type: 'chunk', delta: choice.delta.content });
              }
              const deltaToolCalls = (choice.delta as { tool_calls?: unknown }).tool_calls;
              if (Array.isArray(deltaToolCalls)) {
                for (const tc of deltaToolCalls as Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>) {
                  let entry = toolCalls[tc.index];
                  if (!entry) {
                    entry = { id: tc.id ?? crypto.randomUUID(), name: '', args: '' };
                    toolCalls[tc.index] = entry;
                  }
                  if (tc.id) entry.id = tc.id;
                  if (tc.function?.name) entry.name = tc.function.name;
                  if (tc.function?.arguments) entry.args += tc.function.arguments;
                }
              }
              if (choice.finish_reason) finishReason = choice.finish_reason;
            }

            if (toolCalls.length > 0) {
              // Append the assistant's tool-call request to the conversation.
              conversation.push({
                role: 'assistant',
                content: assistantContent || null,
                tool_calls: toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: tc.args || '{}' },
                })),
              } as ChatCompletionMessageParam);

              for (const tc of toolCalls) {
                send({ type: 'tool_call', name: tc.name, args: tc.args });
                const result = await dispatchTool(user.activeSpaceId, tc.name, tc.args);
                send({ type: 'tool_result', name: tc.name, result });
                conversation.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify(result),
                } as ChatCompletionMessageParam);
              }
              continue; // next round, with tool results in the conversation
            }

            // No tool call → we're done. The text was streamed already.
            log.info('COPILOT_TURN_OK', {
              userId: user.id,
              round,
              finishReason,
              tokens: assistantContent.length,
            });
            send({ type: 'done', messageId });
            controller.close();
            return;
          }

          // Hit the round cap.
          send({
            type: 'error',
            message: 'Tool-call loop exceeded the per-turn budget.',
          });
          controller.close();
        } catch (err) {
          log.warn('COPILOT_STREAM_FAIL', {
            error: err instanceof Error ? err.message.slice(0, 240) : String(err),
          });
          send({
            type: 'error',
            message: 'Copilot ran into a problem; try again.',
          });
          controller.close();
        }
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    },
  );
});

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export const copilotRoutes = app;
