/**
 * Per-phone in-memory session store.
 *
 * Persistence is intentionally out of scope. The API is the source of truth
 * for everything that actually matters (linkage, transactions, budgets) so
 * if the bot restarts the user transparently re-establishes context on the
 * next message. The session here is a small scratchpad: language, current
 * conversational state, last draft id, and any flow-specific pending data.
 *
 * A 12-hour sweep retires idle sessions so the map can't grow unbounded
 * across long uptimes.
 */
import type { Language } from '@versifine/shared';
import type { ConversationState, ReplyMode, Session } from '../types.ts';
import { apiGetBotSession, apiSaveBotSession } from '../services/apiClient.ts';

const SWEEP_INTERVAL_MS = 60 * 60_000; // 1h
const STALE_AFTER_MS = 12 * 60 * 60_000; // 12h

const sessions = new Map<string, Session>();
let lastSweep = 0;

function maybeSweep(): void {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [phone, session] of sessions) {
    if (now - session.lastSeenAt > STALE_AFTER_MS) sessions.delete(phone);
  }
}

function blankSession(phone: string, language: Language): Session {
  return {
    phone,
    language,
    state: 'GREETING',
    linked: false,
    userId: null,
    spaceId: null,
    lastDraftId: null,
    lastTransactionId: null,
    replyMode: 'auto',
    pending: {},
    accountResolved: false,
    lastSeenAt: Date.now(),
  };
}

export interface SessionInitOptions {
  language?: Language;
  state?: ConversationState;
}

/**
 * Look up or create a session for the given phone. The default state for
 * a new session is `GREETING`; flows may override via `state` on first
 * touch (e.g., after the engine resolves an existing linked user).
 */
export function getSession(phone: string, options: SessionInitOptions = {}): Session {
  maybeSweep();
  const existing = sessions.get(phone);
  if (existing) {
    existing.lastSeenAt = Date.now();
    return existing;
  }
  const fresh = blankSession(phone, options.language ?? 'en');
  if (options.state) fresh.state = options.state;
  sessions.set(phone, fresh);
  return fresh;
}

/**
 * Apply a partial patch to an existing session and return the updated row.
 * Creates a new session when the phone isn't seen before — convenient for
 * flow files that don't want to call `getSession` separately.
 */
export function updateSession(phone: string, patch: Partial<Omit<Session, 'phone'>>): Session {
  const session = getSession(phone);
  Object.assign(session, patch);
  session.lastSeenAt = Date.now();
  return session;
}

export function setLanguage(phone: string, language: Language): Session {
  return updateSession(phone, { language });
}

export function setState(phone: string, state: ConversationState): Session {
  return updateSession(phone, { state });
}

export function setReplyMode(phone: string, mode: ReplyMode): Session {
  return updateSession(phone, { replyMode: mode });
}

export function setLinked(phone: string, linked: { userId: string; spaceId: string }): Session {
  return updateSession(phone, {
    linked: true,
    userId: linked.userId,
    spaceId: linked.spaceId,
    state: 'LINKED_MAIN',
  });
}

export function resetSession(phone: string): Session {
  const previous = sessions.get(phone);
  // Keep the language only so the re-onboarding copy renders in the script
  // the user was last using. Everything else is wiped: RESET means "start
  // over from onboarding" (greeting → language → email), so we deliberately
  // drop linkage, resolution, drafts, and pending flow data.
  const language = previous?.language ?? 'en';
  const fresh = blankSession(phone, language);
  sessions.set(phone, fresh);
  return fresh;
}

/** Test/debug only — wipes the entire map. */
export function _resetAllSessions(): void {
  sessions.clear();
  lastSweep = 0;
}

/** Return a snapshot list — used by /sessions admin route. */
export function listSessions(): Array<{
  phone: string;
  language: Language;
  state: ConversationState;
  linked: boolean;
  lastSeenAt: number;
}> {
  return Array.from(sessions.values()).map((s) => ({
    phone: s.phone,
    language: s.language,
    state: s.state,
    linked: s.linked,
    lastSeenAt: s.lastSeenAt,
  }));
}

/**
 * Preloads the user session from the PostgreSQL database into the in-memory cache.
 * If the session doesn't exist, a blank session is initialized.
 */
export async function preloadSession(phone: string): Promise<Session> {
  try {
    const dbSess = await apiGetBotSession(phone);
    if (dbSess) {
      const session: Session = {
        phone: dbSess.phone,
        language: dbSess.language as Language,
        state: dbSess.state as ConversationState,
        linked: dbSess.linked,
        userId: dbSess.userId,
        spaceId: dbSess.spaceId,
        lastDraftId: dbSess.lastDraftId,
        lastTransactionId: dbSess.lastTransactionId,
        replyMode: dbSess.replyMode as ReplyMode,
        pending: dbSess.pending,
        accountResolved: dbSess.accountResolved,
        lastSeenAt: Date.now(),
      };
      sessions.set(phone, session);
      return session;
    }
  } catch (err) {
    console.error('Failed to preload session from database:', err);
  }
  
  // Fallback to blank session if not found or on error
  return getSession(phone);
}

/**
 * Persists the user session from the in-memory cache back to the PostgreSQL database.
 */
export async function persistSession(phone: string): Promise<void> {
  const session = sessions.get(phone);
  if (!session) return;
  
  try {
    await apiSaveBotSession(phone, {
      language: session.language,
      state: session.state,
      linked: session.linked,
      userId: session.userId,
      spaceId: session.spaceId,
      lastDraftId: session.lastDraftId,
      lastTransactionId: session.lastTransactionId,
      replyMode: session.replyMode,
      pending: session.pending,
      accountResolved: session.accountResolved,
    });
  } catch (err) {
    console.error('Failed to persist session to database:', err);
  }
}
