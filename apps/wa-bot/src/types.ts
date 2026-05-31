/**
 * Shared types for the bot. Kept tiny on purpose — the API's Zod schemas
 * own everything that crosses the wire. These types only describe the
 * bot's internal session and message-handling shapes.
 */
import type { Language } from '@versifine/shared';

export type { Language };

export const CONVERSATION_STATES = [
  'GREETING',
  'AWAITING_LANGUAGE',
  'AWAITING_LINK_CODE',
  'LINKED_MAIN',
  'CAPTURE_CONFIRM',
  'SET_BUDGET_CATEGORY',
  'SET_BUDGET_AMOUNT',
  'QUERY_AWAITING_RANGE',
  'COPILOT_THREAD',
  'ERROR',
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

export type ReplyMode = 'text' | 'voice' | 'auto';

/**
 * Per-phone session held in memory. Persistence is out of scope; if the
 * bot restarts the user transparently re-establishes context on the next
 * message because the API is the source of truth for everything that
 * matters (linkage, transactions, budgets).
 */
export interface Session {
  phone: string;
  language: Language;
  state: ConversationState;
  linked: boolean;
  /** Resolved on first successful `requireBot` API call. */
  userId: string | null;
  spaceId: string | null;
  /** Pending capture draft id awaiting CONFIRM/EDIT/CANCEL. */
  lastDraftId: string | null;
  /** Most recent transaction id (for UNDO). */
  lastTransactionId: string | null;
  /** How replies should be delivered: text, voice, or auto (mirror input). */
  replyMode: ReplyMode;
  /** Free-form scratchpad for multi-step flows (set-budget, etc). */
  pending: Record<string, unknown>;
  /**
   * True once we've asked the API whether this phone already has an account
   * (the whoami check on first contact). Prevents re-checking every message.
   */
  accountResolved: boolean;
  /** Last activity timestamp used for the 12h sweep. */
  lastSeenAt: number;
}

export interface IncomingMessage {
  phone: string;
  body: string;
  hasAudio: boolean;
  audioBuffer: Buffer | null;
  audioMimetype: string | null;
  hasImage: boolean;
  imageBuffer: Buffer | null;
  imageMimetype: string | null;
  source: 'whatsapp' | 'simulator';
}

export interface OutgoingVoice {
  buffer: Buffer;
  mimetype: string;
  /**
   * Optional caption used purely for logs and the simulator response so a
   * curl test can still see what the bot actually said when TTS fires.
   */
  spokenText?: string;
}

export interface OutgoingReply {
  /** Text bubble. Always sent first, even when voice is also produced. */
  text: string;
  /** Optional voice clip; awaited after text is sent. */
  voicePromise?: Promise<OutgoingVoice | null>;
  /** Convenience snapshot of the state the engine ended in. */
  state: ConversationState;
}

/**
 * Mirrors `captureResponse` in @versifine/shared. We re-declare the
 * minimum shape we need so the bot can typecheck without circular
 * dependencies on the API's runtime parser code.
 */
export interface ApiCaptureResponse {
  intent: string;
  needsConfirmation: boolean;
  draftId?: string;
  draft?: {
    type: 'expense' | 'income' | 'transfer';
    amount: number | null;
    currency: string | null;
    description: string | null;
    category: string | null;
    walletHint: string | null;
    date: string | null;
    splitPeople: number | null;
    originalAmount: number | null;
    originalCurrency: string | null;
    confidence: number;
    needs: ReadonlyArray<'amount' | 'description' | 'wallet' | 'currency'>;
  };
  followupQuestion?: string;
  queryResult?: Record<string, unknown>;
  copilotStreamUrl?: string;
  echo: string;
}
