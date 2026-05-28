import { z } from 'zod';
import { LANGUAGES } from '../languages.ts';
import { INTENTS } from '../intents.ts';

/**
 * Capture pipeline contracts. The API exposes /capture/text, /capture/voice,
 * /capture/image and they all funnel into the same response envelope.
 */

export const captureTextInput = z.object({
  text: z.string().min(1).max(2000),
  locale: z.enum(LANGUAGES).optional(),
  /** Optional state hint from the client, e.g. "confirming-draft:abc". */
  hint: z.string().max(120).optional(),
});
export type CaptureTextInput = z.infer<typeof captureTextInput>;

export const captureFollowupInput = z.object({
  draftId: z.string().min(8).max(64),
  /** User's reply to a clarifying question. */
  text: z.string().min(1).max(800),
});
export type CaptureFollowupInput = z.infer<typeof captureFollowupInput>;

export const transactionDraft = z.object({
  type: z.enum(['expense', 'income', 'transfer']),
  amount: z.number().positive().nullable(),
  currency: z.string().length(3).nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  walletHint: z.string().nullable(),
  date: z.string().date().nullable(),
  splitPeople: z.number().int().positive().nullable(),
  originalAmount: z.number().positive().nullable(),
  originalCurrency: z.string().length(3).nullable(),
  confidence: z.number().min(0).max(1),
  /** Per-field flag for what's still missing. */
  needs: z.array(z.enum(['amount', 'description', 'wallet', 'currency'])),
});
export type TransactionDraft = z.infer<typeof transactionDraft>;

export const captureResponse = z.object({
  intent: z.enum(INTENTS),
  needsConfirmation: z.boolean(),
  draftId: z.string().optional(),
  draft: transactionDraft.optional(),
  followupQuestion: z.string().optional(),
  /** For query intents the API resolves immediately. */
  queryResult: z.record(z.unknown()).optional(),
  /** For chat intent: the URL to open as an SSE stream. */
  copilotStreamUrl: z.string().optional(),
  /** Echo back the user's input so the client can render the timeline. */
  echo: z.string(),
});
export type CaptureResponse = z.infer<typeof captureResponse>;

export const copilotMessage = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
});
export type CopilotMessage = z.infer<typeof copilotMessage>;

export const copilotChatInput = z.object({
  messages: z.array(copilotMessage).min(1).max(40),
  traceId: z.string().min(1).max(64).optional(),
});
export type CopilotChatInput = z.infer<typeof copilotChatInput>;
