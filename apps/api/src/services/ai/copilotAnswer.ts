/**
 * Non-streaming copilot answer — the WhatsApp path.
 *
 * The web copilot streams SSE tokens, but WhatsApp wants one finished
 * bubble. `answerFinanceQuestion` runs the same guarded, grounded pipeline
 * and returns a single string:
 *
 *   1. screenInput()  — refuse injection / blatant off-topic before any
 *      model call (the security boundary).
 *   2. buildContext() — grounded snapshot, fenced as UNTRUSTED DATA.
 *   3. one tool-enabled completion round (compute_total et al.) so numbers
 *      are real, then a final synthesis round.
 *   4. screenOutput() — catch a leaked prompt as a last resort.
 *
 * Kept deliberately small: a hard 2-round tool budget and a short token
 * cap. The bot is a convenience surface; deep analysis lives on the web.
 */
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { AuthedUser } from '../../middleware/auth.ts';
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import { getOpenAI, isAIConfigured, normalizeChatParams, withLatency } from './client.ts';
import { buildContext, renderContextBlock } from './copilotContext.ts';
import { COPILOT_TOOL_SPECS, dispatchTool } from './copilotTools.ts';
import {
  FINANCE_SYSTEM_PROMPT,
  fenceUntrusted,
  refusalFor,
  screenInput,
  screenOutput,
} from './guard.ts';

export interface AnswerResult {
  text: string;
  /** Why we answered the way we did — for structured logs only. */
  outcome: 'answered' | 'refused_injection' | 'refused_offtopic' | 'unavailable' | 'error';
}

const BOT_STYLE_NOTE =
  'You are replying inside WhatsApp. Keep it to 2-4 short sentences, no markdown headings or tables. Lead with the number or the answer.';

/**
 * Answer one finance question for a linked WhatsApp user. `question` is the
 * raw user text; `user` is resolved by `requireBot` (carries activeSpaceId
 * + language).
 */
export async function answerFinanceQuestion(
  user: AuthedUser,
  question: string,
): Promise<AnswerResult> {
  const screen = screenInput(question);
  if (screen.verdict !== 'allow') {
    log.info('COPILOT_BOT_SCREENED', { verdict: screen.verdict, reason: screen.reason });
    return {
      text: refusalFor(screen.verdict),
      outcome: screen.verdict === 'injection' ? 'refused_injection' : 'refused_offtopic',
    };
  }

  if (!isAIConfigured()) {
    return {
      text: "I can't answer detailed questions right now — the assistant isn't configured. You can still log expenses and ask for summaries.",
      outcome: 'unavailable',
    };
  }
  const client = getOpenAI();
  if (!client) {
    return {
      text: "I can't answer detailed questions right now. You can still log expenses and ask for summaries.",
      outcome: 'unavailable',
    };
  }

  try {
    const context = await buildContext(user.activeSpaceId, question);
    const contextBlock = renderContextBlock(context, user);

    const conversation: ChatCompletionMessageParam[] = [
      { role: 'system', content: FINANCE_SYSTEM_PROMPT },
      { role: 'system', content: BOT_STYLE_NOTE },
      { role: 'system', content: `User context:\n${contextBlock}` },
      {
        role: 'user',
        // Fence the live question too: the model reads it as the request,
        // but the fence reminds it that the contents are untrusted.
        content: fenceUntrusted(question),
      },
    ];

    const tools = COPILOT_TOOL_SPECS as ChatCompletionTool[];
    const MAX_ROUNDS = 2;
    let answer = '';

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const completion = await withLatency(`copilot.bot.round${round}`, () =>
        client.chat.completions.create(
          normalizeChatParams({
            model: env.OPENAI_CHAT_MODEL,
            temperature: 0.4,
            // Headroom for Indic replies: Malayalam/Tamil tokenize ~2-3x
            // heavier than English, and gpt-5-mini truncated a Malayalam answer
            // to null at a tighter cap. reasoning_effort=minimal keeps the whole
            // budget for visible output.
            max_tokens: 1200,
            messages: conversation,
            tools,
            tool_choice: round === 0 ? 'auto' : 'none',
          }),
        ),
      );

      const choice = completion.choices[0];
      const msg = choice?.message;
      const toolCalls = msg?.tool_calls ?? [];

      if (toolCalls.length > 0 && round < MAX_ROUNDS - 1) {
        conversation.push({
          role: 'assistant',
          content: msg?.content ?? null,
          tool_calls: toolCalls,
        } as ChatCompletionMessageParam);
        for (const tc of toolCalls) {
          if (tc.type !== 'function') continue;
          const result = await dispatchTool(
            { spaceId: user.activeSpaceId, userId: user.id, source: 'whatsapp_text' },
            tc.function.name,
            tc.function.arguments || '{}',
          );
          conversation.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          } as ChatCompletionMessageParam);
        }
        continue;
      }

      answer = (msg?.content ?? '').trim();
      break;
    }

    if (!answer) {
      return {
        text: "I couldn't pull that together just now. Try asking on the web copilot at versifine.com.",
        outcome: 'error',
      };
    }

    const checked = screenOutput(answer);
    log.info('COPILOT_BOT_OK', {
      userId: user.id,
      leaked: !checked.safe,
      len: checked.text.length,
    });
    return { text: checked.text, outcome: 'answered' };
  } catch (err) {
    log.warn('COPILOT_BOT_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    return {
      text: 'I ran into a problem answering that. Try again, or use the web copilot at versifine.com.',
      outcome: 'error',
    };
  }
}
