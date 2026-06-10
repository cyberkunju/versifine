/**
 * Token-undo flow (L2-2).
 *
 * Every mutation reply carries a 6-char undo token ("✅ Logged ₹50 · undo
 * K7P2A9"). When the user sends that token back — bare, or after the word
 * "undo" — we reverse THAT specific mutation, even if it wasn't the most
 * recent. This is the confidence-budget UX: the bot can auto-log
 * aggressively because every action is one token away from a clean reversal.
 *
 * The token is self-contained: the API resolves it from the mutation log
 * scoped to the user's space. No session state required — the token IS the
 * lookup key.
 */
import type { Session } from '../../types.ts';
import { ApiClientError, undoByToken } from '../../services/apiClient.ts';
import { effectiveLanguage } from '../../utils/langDetect.ts';
import { getMessages } from '../messages/index.ts';
import { log } from '../../utils/logger.ts';
import { updateSession } from '../state.ts';

/**
 * The token alphabet (uppercase, ambiguity-free) from the API's generator:
 * 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' — excludes I, L, O (and 0, 1). The
 * char-class MUST match that set exactly: A-H, J, K, M, N, P-Z, 2-9.
 * (Note L is excluded — between K and M — so "CANCEL" is never a token.)
 *
 * Every emitted token contains at least one digit (guaranteed by the API's
 * generateToken). The BARE-token detector exploits this: it requires a digit,
 * which eliminates every all-letters English-word false positive — "BUDGET"
 * (B,U,D,G,E,T all valid glyphs) is NOT mistaken for a token because it has
 * no digit. A prefixed form ("undo BUDGET") is still rejected by the same
 * digit requirement, which is correct — BUDGET was never a real token.
 */
const TOKEN_CHAR = '[A-HJKMNP-Z2-9]';
const TOKEN_RE = new RegExp(`^${TOKEN_CHAR}{6}$`, 'i');
const DIGIT_RE = /[2-9]/;
const LETTER_RE = /[A-HJKMNP-Z]/i;
const PREFIXED_TOKEN_RE = new RegExp(
  `^\\s*(?:undo|oops|revert|cancel|remove|delete)\\s+(${TOKEN_CHAR}{6})\\s*$`,
  'i',
);

/** Extract a 6-char undo token from the message, or null if there isn't one.
 *  A real token always has BOTH a digit and a letter (API generator
 *  guarantee). Requiring both eliminates English-word false positives
 *  ("BUDGET" — no digit) AND bare-number false positives ("234567" — an
 *  amount/OTP the user typed, no letter). */
export function extractUndoToken(body: string): string | null {
  if (!body) return null;
  const trimmed = body.trim();
  if (TOKEN_RE.test(trimmed) && DIGIT_RE.test(trimmed) && LETTER_RE.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const prefixed = PREFIXED_TOKEN_RE.exec(trimmed);
  if (prefixed && DIGIT_RE.test(prefixed[1]!) && LETTER_RE.test(prefixed[1]!)) {
    return prefixed[1]!.toUpperCase();
  }
  return null;
}

/**
 * True when the body looks like a token-undo command. The engine checks this
 * BEFORE the capture flow so a bare token never gets mis-parsed as an
 * expense ("K7P2A9" must not become a transaction description).
 */
export function looksLikeUndoToken(body: string): boolean {
  return extractUndoToken(body) !== null;
}

/** Resolve the token-undo. Returns the localized reply. */
export async function handleUndoToken(session: Session, body: string): Promise<{ text: string }> {
  const m = getMessages(effectiveLanguage(session));
  const token = extractUndoToken(body);
  if (!token) {
    // Shouldn't happen — engine only calls this when looksLikeUndoToken is
    // true — but fail safe.
    return { text: m.undoTokenNotFound };
  }
  try {
    const result = await undoByToken(session.phone, token);
    if (!result.undone) {
      return {
        text: result.reason === 'already_undone' ? m.undoTokenAlready : m.undoTokenNotFound,
      };
    }
    // If the reversed entry was the bot's tracked lastTransaction, clear the
    // stale pointer so a follow-up "undo"/"delete that" doesn't act on a row
    // that's now gone (create-reversal) or changed (update-reversal).
    if (result.transaction && session.lastTransactionId === result.transaction.id) {
      const pending = { ...(session.pending ?? {}) };
      delete pending.lastTx;
      updateSession(session.phone, { lastTransactionId: null, pending });
    }
    const tx = result.transaction;
    const summary = tx
      ? tx.currency === 'INR'
        ? `₹${tx.amount.toLocaleString('en-IN')} — ${tx.description}`
        : `${tx.currency} ${tx.amount} — ${tx.description}`
      : 'the entry';
    return { text: m.undoByTokenDone(summary) };
  } catch (err) {
    log.warn('UNDO_TOKEN_FAIL', {
      phone: session.phone,
      error: err instanceof ApiClientError ? `${err.code}:${err.message}` : String(err),
    });
    return { text: m.undoTokenNotFound };
  }
}
