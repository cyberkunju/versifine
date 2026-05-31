/**
 * Copilot route — RAG chat with tool-calling.
 *
 *   POST /copilot/chat   { messages: [...] }   (web, JWT)  → SSE stream
 *   POST /copilot/ask    { text }              (bot secret) → one JSON answer
 *
 * The streaming pipeline:
 *   1. Screen the user's last message for prompt-injection / off-topic.
 *      Refuse cheaply (no model call) when it trips the guard.
 *   2. Embed the message, cosine-search the top transactions, and build a
 *      structured context block — fenced + sanitised as UNTRUSTED DATA.
 *   3. Call the chat model with the hardened finance system prompt + tools.
 *   4. Dispatch any tool calls, append results, resume — capped rounds.
 *   5. Stream every token to the client as SSE.
 *
 * The non-streaming /ask path (WhatsApp) lives in services/ai/copilotAnswer.
 *
 * Security + scope are centralised in services/ai/guard.ts:
 *   - All user text and all retrieved transaction data are treated as DATA,
 *     never instructions ("spotlighting" via fenceUntrusted/sanitizeUntrusted).
 *   - Vivien is locked to personal finance; everything else is refused.
 */
import { Hono } from 'hono';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { copilotChatInput } from '@versifine/shared';
import { env } from '../env.ts';
import { requireBot, requireUser } from '../middleware/auth.ts';
import { limits, rateLimit } from '../middleware/rateLimit.ts';
import { getOpenAI, isAIConfigured, normalizeChatParams, withLatency } from '../services/ai/client.ts';
import { answerFinanceQuestion } from '../services/ai/copilotAnswer.ts';
import { buildContext, renderContextBlock } from '../services/ai/copilotContext.ts';
import {
  COPILOT_TOOL_SPECS,
  dispatchTool,
} from '../services/ai/copilotTools.ts';
import {
  FINANCE_SYSTEM_PROMPT,
  fenceUntrusted,
  refusalFor,
  screenInput,
} from '../services/ai/guard.ts';
import { errors } from '../utils/errors.ts';
import { ok } from '../utils/envelope.ts';
import { log } from '../utils/logger.ts';

const app = new Hono();

const copilotLimit = rateLimit({
  ...limits.copilot,
  key: (c) => {
    const u = c.get('user');
    return u?.id ? `copilot:${u.id}` : null;
  },
});

function buildSseChunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/* ----------------------------------------------------------------- *
 * POST /copilot/chat — web, streaming.
 * ----------------------------------------------------------------- */
app.post('/chat', requireUser, copilotLimit, async (c) => {
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

  // 1. Guard: refuse injection / off-topic before spending a token. The
  //    refusal is streamed back in the same SSE shape the client expects.
  const screen = screenInput(lastUserMessage);
  if (screen.verdict !== 'allow') {
    log.info('COPILOT_WEB_SCREENED', { verdict: screen.verdict, reason: screen.reason });
    return streamSingleMessage(refusalFor(screen.verdict));
  }

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

  // Build the conversation: hardened system prompt + fenced context + the
  // user-supplied messages (each user turn fenced as untrusted data).
  const conversation: ChatCompletionMessageParam[] = [
    { role: 'system', content: FINANCE_SYSTEM_PROMPT },
    { role: 'system', content: `User context:\n${contextBlock}` },
    ...parsed.data.messages.map((m) => ({
      role: m.role,
      content: m.role === 'user' ? fenceUntrusted(m.content) : m.content,
    })) as ChatCompletionMessageParam[],
  ];

  const tools = COPILOT_TOOL_SPECS as ChatCompletionTool[];
  const messageId = crypto.randomUUID();

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const send = (payload: Record<string, unknown>) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(buildSseChunk(payload)));
          } catch {
            closed = true;
          }
        };
        const finish = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the platform — fine.
          }
        };

        try {
          const MAX_ROUNDS = 4;
          for (let round = 0; round < MAX_ROUNDS; round += 1) {
            const stream = await withLatency(
              `copilot.chat.round${round}`,
              async () =>
                client.chat.completions.create(
                  normalizeChatParams({
                    model: env.OPENAI_CHAT_MODEL,
                    temperature: 0.4,
                    stream: true,
                    messages: conversation,
                    tools,
                    tool_choice: 'auto',
                  }),
                ),
            );

            const toolCalls: Array<{ id: string; name: string; args: string }> = [];
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
                const result = await dispatchTool(
                  { spaceId: user.activeSpaceId, userId: user.id, source: 'manual_web' },
                  tc.name,
                  tc.args,
                );
                send({ type: 'tool_result', name: tc.name, result });
                conversation.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify(result),
                } as ChatCompletionMessageParam);
              }
              continue;
            }

            log.info('COPILOT_TURN_OK', {
              userId: user.id,
              round,
              finishReason,
              tokens: assistantContent.length,
            });
            send({ type: 'done', messageId });
            finish();
            return;
          }

          send({ type: 'error', message: 'Tool-call loop exceeded the per-turn budget.' });
          finish();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!closed && !/closed|aborted/i.test(msg)) {
            log.warn('COPILOT_STREAM_FAIL', { error: msg.slice(0, 240) });
            send({ type: 'error', message: 'Copilot ran into a problem; try again.' });
          }
          finish();
        }
      },
    }),
    sseHeaders(),
  );
});

/* ----------------------------------------------------------------- *
 * POST /copilot/ask — WhatsApp bot, single JSON answer.
 * ----------------------------------------------------------------- */
const askLimit = rateLimit({
  ...limits.copilot,
  key: (c) => {
    const u = c.get('user');
    return u?.id ? `copilot:ask:${u.id}` : null;
  },
});

app.post('/ask', requireBot, askLimit, async (c) => {
  const body = await c.req.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text.trim()) {
    throw errors.validation('text is required');
  }
  const user = c.get('user');
  const result = await answerFinanceQuestion(user, text.slice(0, 2000));
  return c.json(ok({ answer: result.text, outcome: result.outcome }));
});

/* ----------------------------------------------------------------- *
 * Helpers.
 * ----------------------------------------------------------------- */
function sseHeaders() {
  return {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  } as const;
}

/** Stream a single assistant message (used for guard refusals). */
function streamSingleMessage(message: string): Response {
  const messageId = crypto.randomUUID();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        try {
          controller.enqueue(encoder.encode(buildSseChunk({ type: 'chunk', delta: message })));
          controller.enqueue(encoder.encode(buildSseChunk({ type: 'done', messageId })));
        } catch {
          // client gone — nothing to do
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      },
    }),
    sseHeaders(),
  );
}

export const copilotRoutes = app;
