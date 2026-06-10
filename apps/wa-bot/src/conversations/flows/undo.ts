/**
 * Undo flow — reverse the user's most recent action.
 *
 * Powers the universal "undo" / "oops" command (advertised in HELP across
 * every language and previously a no-op). Calls the server undo engine, which
 * reverses the last mutation: a fresh log is removed, a correction is reverted,
 * a delete is restored — all from the durable mutation log, so it survives
 * restarts and isn't limited to the in-memory session.
 *
 * After an undo the session's lastTransaction pointer is stale (the row may be
 * gone or reverted), so we clear it to stop a following correction targeting a
 * reverted/removed entry.
 */
import type { Session } from '../../types.ts';
import { ApiClientError, undoLast } from '../../services/apiClient.ts';
import { getMessages } from '../messages/index.ts';
import { updateSession } from '../state.ts';
import { log } from '../../utils/logger.ts';
import { effectiveLanguage } from '../../utils/langDetect.ts';

export async function handleUndo(session: Session): Promise<{ text: string }> {
  const m = getMessages(effectiveLanguage(session));
  try {
    const res = await undoLast(session.phone);
    if (!res.undone || !res.transaction) {
      return { text: m.nothingToUndo };
    }
    const t = res.transaction;
    const amt =
      t.currency === 'INR'
        ? `₹${t.amount.toLocaleString('en-IN')}`
        : `${t.currency} ${t.amount.toLocaleString('en-IN')}`;
    const tail = t.description ? ` (${t.description})` : '';

    // The lastTransaction pointer is now stale — clear it + the cached summary.
    const pending = { ...(session.pending ?? {}) };
    delete pending.lastTx;
    updateSession(session.phone, { lastTransactionId: null, pending });

    let summary: string;
    if (res.reversed === 'create') {
      summary = `removed ${amt}${tail}`;
    } else if (res.reversed === 'delete') {
      summary = `restored ${amt}${tail}`;
    } else {
      summary = `back to ${amt}${t.category ? ` · ${t.category}` : ''}`;
    }
    return { text: m.undone(summary) };
  } catch (err) {
    log.warn('UNDO_FAIL', {
      phone: session.phone,
      error: err instanceof ApiClientError ? `${err.code}:${err.message}` : String(err),
    });
    return { text: m.error };
  }
}
