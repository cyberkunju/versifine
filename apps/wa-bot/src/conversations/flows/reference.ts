/**
 * Reference flow — resolves "delete the coffee one", "change yesterday's uber
 * to 250", "remove last 2" against the user's transaction history and applies
 * the action. Powers corrections/deletes on NON-LAST entries (the standard
 * correction path is bound to lastTransactionId; this is the escape hatch).
 *
 * Three deterministic phrasing detectors decide whether the message is a
 * reference command and what to do:
 *   - delete-reference  ("delete the coffee one", "remove yesterday's uber")
 *   - amount-correction-reference ("change the coffee to 250")
 *
 * Single match → act-with-undo. Multiple matches → tappable "which one?"
 * Zero → graceful "I couldn't find that". The actual reference resolution
 * lives in the API (`POST /capture/resolve-ref`) — three strategies (structural,
 * keyword, semantic) — so we get the same answer the API uses elsewhere.
 *
 * Detection is INTENTIONALLY conservative — only fires when the message is
 * clearly NOT about the LAST transaction (which has its own dedicated flow).
 * "delete that" / "undo" / "no, 230" stay in the lastTransactionId path.
 */
import type { Session } from '../../types.ts';
import { ApiClientError, deleteTransaction, patchTransaction, resolveTxReference, type ResolvedTxCandidate } from '../../services/apiClient.ts';
import { getMessages } from '../messages/index.ts';
import { updateSession } from '../state.ts';
import { log } from '../../utils/logger.ts';

/** Verbs that signal the user wants to MODIFY/REMOVE a transaction. */
const DELETE_VERB = /\b(delete|remove|cancel|undo|kill)\b/i;
const CHANGE_VERB = /\b(change|edit|fix|correct|update|make|set)\b/i;

/**
 * Words that suggest a SPECIFIC referent — i.e. NOT "delete that" / "delete
 * the last one" (which the lastTransactionId path handles). "the X one" /
 * "yesterday's X" / "last N" / a specific amount/category/date phrase.
 */
const HAS_SPECIFIC_REFERENT =
  /\b(the\s+\w+(?:\s+one)?|yesterday(?:'s)?|today(?:'s)?|last\s+(?:\d+|two|three|four|five)\b|the\s+₹?\d+(?:\s*(?:one|coffee|lunch|dinner|chai|cab|uber|swiggy|rent|fuel|grocery|groceries))?)\b/i;

/** Heuristic — does the user's message reference a SPECIFIC non-last entry? */
export function looksLikeReferenceCommand(body: string, hasLastTx: boolean): boolean {
  if (!body || !body.trim()) return false;
  const lower = body.toLowerCase().trim();
  // Bare "delete that" / "undo" / "remove the last one" with a recent tx →
  // the dedicated last-tx flow handles it; don't intercept.
  if (
    hasLastTx &&
    /^(delete\s+(?:that|the\s+last(?:\s+one)?)|undo|remove\s+(?:that|the\s+last(?:\s+one)?))\.?$/i.test(
      lower,
    )
  ) {
    return false;
  }
  if (!DELETE_VERB.test(lower) && !CHANGE_VERB.test(lower)) return false;
  return HAS_SPECIFIC_REFERENT.test(lower);
}

/** Parse a "change X to <amount>" target value (light bot-side regex; the
 *  API resolver re-validates with the full deterministic extractor). */
function extractCorrectionAmount(body: string): number | null {
  const toMatch = /\bto\s+(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)/i.exec(body);
  if (toMatch) {
    const n = Number(toMatch[1]!.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Strip the verb-and-target suffix from the query so the resolver focuses on the referent. */
function buildReferenceQuery(body: string): string {
  // Drop the leading verb chunk and trailing "to <amount>" so the API resolver
  // sees just the referent ("the coffee one", "yesterday's uber").
  let q = body
    .replace(/^\s*(?:please\s+)?(?:can\s+you\s+)?(?:just\s+)?(delete|remove|cancel|undo|kill|change|edit|fix|correct|update|make|set)\b/i, '')
    .replace(/\s+to\s+(?:₹|rs\.?\s*)?\d[\d,]*(?:\.\d+)?\b.*$/i, '')
    .replace(/\bplease\b/gi, '')
    .trim();
  return q || body.trim();
}

function summarize(c: ResolvedTxCandidate): string {
  const amt =
    c.currency === 'INR'
      ? `₹${c.amount.toLocaleString('en-IN')}`
      : `${c.currency} ${c.amount.toLocaleString('en-IN')}`;
  const desc = c.description ? ` ${c.description}` : '';
  return `${amt}${desc} (${c.date})`;
}

export async function handleReferenceCommand(
  session: Session,
  body: string,
): Promise<{ text: string }> {
  const m = getMessages(session.language);
  const lower = body.toLowerCase();
  const isDelete = DELETE_VERB.test(lower) && !/\bto\s+\d/i.test(lower);
  const targetAmount = isDelete ? null : extractCorrectionAmount(body);
  const refQuery = buildReferenceQuery(body);

  let candidates: ResolvedTxCandidate[];
  try {
    const res = await resolveTxReference(session.phone, refQuery);
    candidates = res.candidates;
  } catch (err) {
    log.warn('REF_CMD_RESOLVE_FAIL', {
      phone: session.phone,
      error: err instanceof ApiClientError ? `${err.code}:${err.message}` : String(err),
    });
    return { text: m.error };
  }

  if (candidates.length === 0) {
    return {
      text: `I couldn't find a matching transaction. Try mentioning the amount, the merchant, or the date — e.g. "delete the ₹250 coffee" or "change yesterday's lunch to 350".`,
    };
  }

  // Multiple candidates → ask which one. Stash them on the session so a
  // follow-up "the first one" / "1" can pick.
  if (candidates.length > 1) {
    const list = candidates
      .map((c, i) => `${i + 1}. ${summarize(c)}`)
      .join('\n');
    const verb = isDelete ? 'delete' : 'change';
    const pending = {
      ...(session.pending ?? {}),
      pendingRefAction: { verb: isDelete ? 'delete' : 'patch', targetAmount, candidates, expiresAt: Date.now() + 5 * 60_000 },
    };
    updateSession(session.phone, { pending });
    return {
      text: `Which one do you want to ${verb}?\n${list}\nReply with the number (1-${candidates.length}) or CANCEL.`,
    };
  }

  // Single match — act with undo affordance.
  const c = candidates[0]!;
  return await applyReferenceAction(session, c, isDelete, targetAmount);
}

async function applyReferenceAction(
  session: Session,
  c: ResolvedTxCandidate,
  isDelete: boolean,
  targetAmount: number | null,
): Promise<{ text: string }> {
  const m = getMessages(session.language);
  try {
    if (isDelete) {
      await deleteTransaction(session.phone, c.id);
      // Clear lastTransactionId if it pointed here, so a subsequent "undo"
      // hits the mutation log (which is the right path for older entries).
      if (session.lastTransactionId === c.id) {
        const pending = { ...(session.pending ?? {}) };
        delete pending.lastTx;
        updateSession(session.phone, { lastTransactionId: null, pending });
      }
      return { text: m.deleted(summarize(c)) };
    }
    if (targetAmount !== null) {
      const { transaction } = await patchTransaction(session.phone, c.id, { amount: targetAmount });
      // If the patched transaction IS the lastTransactionId the bot tracks,
      // refresh the cached summary — otherwise a follow-up "delete that" will
      // show the stale (pre-patch) amount in its summary.
      if (session.lastTransactionId === c.id) {
        const lastTx = (session.pending?.lastTx as Record<string, unknown> | undefined) ?? {};
        const pending = {
          ...(session.pending ?? {}),
          lastTx: { ...lastTx, amount: transaction.amount, ts: Date.now() },
        };
        updateSession(session.phone, { pending });
      }
      const oldAmt = `₹${c.amount.toLocaleString('en-IN')}`;
      const newAmt = `₹${transaction.amount.toLocaleString('en-IN')}`;
      return { text: m.correctUpdated(`${oldAmt} → ${newAmt}`) };
    }
    return { text: 'Found the entry but I need to know what to change it to.' };
  } catch (err) {
    log.warn('REF_CMD_APPLY_FAIL', {
      phone: session.phone,
      error: err instanceof ApiClientError ? `${err.code}:${err.message}` : String(err),
    });
    return { text: m.error };
  }
}

/**
 * Resolve a follow-up "1" / "2" / "first one" pick when the bot offered a
 * choice. Returns null when there is no pending ref action or the input
 * doesn't look like a number pick.
 */
export async function tryResolvePendingPick(
  session: Session,
  body: string,
): Promise<{ text: string } | null> {
  const pending = session.pending?.pendingRefAction as
    | { verb: 'delete' | 'patch'; targetAmount: number | null; candidates: ResolvedTxCandidate[]; expiresAt: number }
    | undefined;
  if (!pending) return null;
  if (Date.now() > pending.expiresAt) {
    const cleared = { ...(session.pending ?? {}) };
    delete cleared.pendingRefAction;
    updateSession(session.phone, { pending: cleared });
    return null;
  }
  // CANCEL aborts.
  if (/^\s*cancel\b/i.test(body)) {
    const cleared = { ...(session.pending ?? {}) };
    delete cleared.pendingRefAction;
    updateSession(session.phone, { pending: cleared });
    return { text: 'Cancelled.' };
  }
  // Number pick.
  const numMatch = /^\s*(\d{1,2})\b/.exec(body) ?? /^\s*(?:the\s+)?(first|second|third|fourth|fifth)\b/i.exec(body);
  if (!numMatch) return null;
  const wordMap: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  const idx = (wordMap[numMatch[1]!.toLowerCase()] ?? Number(numMatch[1])) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= pending.candidates.length) return null;
  const c = pending.candidates[idx]!;
  // Clear the pending pick BEFORE applying so a network error doesn't keep us locked in.
  const cleared = { ...(session.pending ?? {}) };
  delete cleared.pendingRefAction;
  updateSession(session.phone, { pending: cleared });
  return await applyReferenceAction(session, c, pending.verb === 'delete', pending.targetAmount);
}
