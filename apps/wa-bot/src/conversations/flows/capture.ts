/**
 * Capture flow.
 *
 * Linked users in `LINKED_MAIN` who send anything that isn't a universal
 * command land here. The flow funnels:
 *
 *   - text body      → POST /capture/text
 *   - voice note     → POST /capture/voice (multipart)
 *   - image (receipt) → POST /capture/image (multipart)
 *
 * The API replies with a uniform envelope. We translate the envelope into
 * a localized bot reply and update session state for follow-up flows
 * (CAPTURE_CONFIRM when the API returned a draft; LINKED_MAIN otherwise).
 */
import type { Session, IncomingMessage } from '../../types.ts';
import {
  ApiClientError,
  askCopilot,
  captureImage,
  captureText,
  captureVoice,
  type CaptureResponseShape,
} from '../../services/apiClient.ts';
import { log } from '../../utils/logger.ts';
import { getMessages } from '../messages/index.ts';
import type { QuerySummaryView } from '../messages/types.ts';
import { setState, updateSession } from '../state.ts';

export interface CaptureResult {
  text: string;
  /** Optional spoken summary the engine may pass to TTS. */
  speakable?: string;
  /** Set when the API returned a draft pending confirmation. */
  pendingDraftId?: string;
}

function summarizeQueryResult(result: Record<string, unknown> | undefined): string {
  if (!result) return '';
  // Recognise the shapes our API services return.
  const tx = result.transaction as { amount?: number; currency?: string; category?: string | null } | undefined;
  if (tx && typeof tx.amount === 'number') {
    const cur = tx.currency ?? 'INR';
    const cat = tx.category ?? null;
    const amount = cur === 'INR' ? `₹${tx.amount}` : `${cur} ${tx.amount}`;
    return cat ? `${amount} (${cat})` : amount;
  }
  if (typeof result.message === 'string') return result.message;
  if (typeof result.total === 'number') {
    const cur = (result.currency as string) ?? 'INR';
    return cur === 'INR' ? `₹${result.total}` : `${cur} ${result.total}`;
  }
  if (Array.isArray((result as { topCategories?: unknown }).topCategories)) {
    return JSON.stringify(result).slice(0, 400);
  }
  return JSON.stringify(result).slice(0, 400);
}

function renderCaptureResponse(session: Session, response: CaptureResponseShape): CaptureResult {
  const m = getMessages(session.language);

  // Successful persist → server returns intent + queryResult.transaction.
  if (!response.needsConfirmation) {
    if (response.intent === 'expense' || response.intent === 'income' || response.intent === 'transfer') {
      const txs = response.queryResult?.transactions as
        | Array<{ id?: string; amount: number; currency: string; description: string; category: string | null }>
        | undefined;
      if (Array.isArray(txs) && txs.length > 0) {
        const last = txs[txs.length - 1];
        if (last?.id) {
          updateSession(session.phone, { lastTransactionId: last.id });
        }
        const total =
          typeof response.queryResult?.total === 'number'
            ? response.queryResult.total
            : txs.reduce((sum, tx) => sum + tx.amount, 0);
        const currency =
          typeof response.queryResult?.currency === 'string'
            ? response.queryResult.currency
            : (txs[0]?.currency ?? 'INR');
        const text = m.captureLoggedMany(txs, total, currency);
        return { text, speakable: text };
      }

      const tx = response.queryResult?.transaction as
        | { id?: string; amount: number; currency: string; category: string | null }
        | undefined;
      if (tx) {
        // Remember the just-created transaction so the "actually, that was
        // <category>" correction flow can patch it. Without this the
        // correction flow always reports "nothing to correct".
        if (tx.id) {
          updateSession(session.phone, { lastTransactionId: tx.id });
        }
        return {
          text: m.captureLogged(tx.amount, tx.currency, tx.category),
          speakable: m.captureLogged(tx.amount, tx.currency, tx.category),
        };
      }
    }
    if (
      response.intent === 'query_spending' ||
      response.intent === 'query_summary' ||
      response.intent === 'query_forecast'
    ) {
      // Prefer the API's structured summary so the answer is rendered in the
      // user's language (hi/ml packs build it locally; ta/te/kn translate the
      // English build at send time). Fall back to the raw message string only
      // when the structured payload is absent (older API).
      const summaryPayload = response.queryResult?.summary as QuerySummaryView | undefined;
      if (summaryPayload && typeof summaryPayload.total === 'number') {
        const text = m.queryReply(summaryPayload);
        return { text, speakable: text };
      }
      const summary = summarizeQueryResult(response.queryResult);
      return { text: m.queryAnswer(summary || m.unknown), speakable: summary };
    }
    if (response.intent === 'chat') {
      // The chat intent is answered inline by the caller (handleCapture)
      // via the guarded copilot; this branch only fires if that path was
      // skipped, so fall back to the nudge.
      return { text: m.copilotNudge };
    }
    if (response.intent === 'unknown') {
      return { text: m.unknown };
    }
    return { text: m.captureLogged(0, 'INR', null) };
  }

  // Needs confirmation → store draft id on the session and ask.
  if (response.draftId) {
    updateSession(session.phone, { lastDraftId: response.draftId });
    setState(session.phone, 'CAPTURE_CONFIRM');
  }
  if (response.followupQuestion) {
    return {
      text: response.followupQuestion,
      speakable: response.followupQuestion,
      ...(response.draftId ? { pendingDraftId: response.draftId } : {}),
    };
  }
  if (response.draft) {
    const summary = m.captureNeedsConfirm({
      amount: response.draft.amount,
      currency: response.draft.currency,
      description: response.draft.description,
      category: response.draft.category,
      date: response.draft.date,
      splitPeople: response.draft.splitPeople,
    });
    return {
      text: summary,
      ...(response.draftId ? { pendingDraftId: response.draftId } : {}),
    };
  }
  return { text: m.captureFailed };
}

/**
 * Answer a free-form finance question through the guarded copilot.
 * Falls back to the website nudge if the answer can't be produced.
 */
async function answerChat(session: Session, question: string): Promise<CaptureResult> {
  const m = getMessages(session.language);
  if (!question.trim()) return { text: m.copilotNudge };
  try {
    const { answer } = await askCopilot(session.phone, question);
    if (answer && answer.trim()) {
      return { text: answer.trim(), speakable: answer.trim() };
    }
    return { text: m.copilotNudge };
  } catch (err) {
    log.warn('COPILOT_ASK_FAIL', {
      phone: session.phone,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { text: m.copilotNudge };
  }
}

export async function handleCapture(
  session: Session,
  message: IncomingMessage,
): Promise<CaptureResult> {
  const m = getMessages(session.language);
  // The API's /capture/* `locale` is the short language enum (en/hi/ml/ta/te/kn),
  // NOT a BCP-47 tag. Sending `en-IN` here makes captureTextInput's zod enum
  // reject every request with a 400 ZodError, which the bot rendered as the
  // empty-error "Couldn't log that." Pass the short code the schema expects.
  const locale = session.language;

  try {
    if (message.hasAudio && message.audioBuffer) {
      const response = await captureVoice(
        session.phone,
        message.audioBuffer,
        message.audioMimetype ?? 'audio/ogg',
        locale,
      );
      if (response.intent === 'chat' && !response.needsConfirmation) {
        return await answerChat(session, response.echo || '');
      }
      return renderCaptureResponse(session, response);
    }
    if (message.hasImage && message.imageBuffer) {
      const response = await captureImage(
        session.phone,
        message.imageBuffer,
        message.imageMimetype ?? 'image/jpeg',
        locale,
      );
      return renderCaptureResponse(session, response);
    }
    if (message.body && message.body.trim()) {
      const response = await captureText(session.phone, message.body, locale);
      // Free-form question → answer inline with the guarded copilot instead
      // of nudging the user to the website. The API screens for scope +
      // prompt-injection server-side; we just relay the finished answer.
      if (response.intent === 'chat' && !response.needsConfirmation) {
        return await answerChat(session, message.body);
      }
      return renderCaptureResponse(session, response);
    }
    return { text: m.unknown };
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'NOT_FOUND') {
      // The API resolves the user from X-Phone; NOT_FOUND here means the
      // phone isn't linked anymore (or never was, despite a session flag).
      setState(session.phone, 'AWAITING_LINK_CODE');
      updateSession(session.phone, { linked: false });
      return { text: m.notLinked };
    }
    log.warn('CAPTURE_FAIL', {
      phone: session.phone,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { text: m.captureFailed };
  }
}

export async function handleConfirm(
  session: Session,
  command: 'CONFIRM' | 'CANCEL' | 'EDIT',
  followupBody: string | null,
): Promise<CaptureResult> {
  const m = getMessages(session.language);
  if (!session.lastDraftId) {
    setState(session.phone, 'LINKED_MAIN');
    return { text: m.unknown };
  }
  const draftId = session.lastDraftId;

  if (command === 'CANCEL') {
    updateSession(session.phone, { lastDraftId: null });
    setState(session.phone, 'LINKED_MAIN');
    return { text: m.captureCancelled };
  }

  // CONFIRM with no edits → apiClient.captureConfirm with an empty edits map.
  // EDIT or CONFIRM-with-text → pass the user's free-form text so the
  // API parser can re-fill missing fields.
  const { captureConfirm } = await import('../../services/apiClient.ts');
  try {
    const payload =
      command === 'EDIT' || (followupBody && followupBody.trim())
        ? { draftId, text: followupBody ?? '' }
        : { draftId, edits: {} };
    const response = await captureConfirm(session.phone, payload);
    if (!response.needsConfirmation) {
      updateSession(session.phone, { lastDraftId: null });
      setState(session.phone, 'LINKED_MAIN');
    }
    return renderCaptureResponse(session, response);
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'NOT_FOUND') {
      const active = updateSession(session.phone, { lastDraftId: null, state: 'LINKED_MAIN' });
      if (command === 'EDIT' && followupBody?.trim()) {
        return await handleCapture(active, {
          phone: active.phone,
          body: followupBody,
          hasAudio: false,
          audioBuffer: null,
          audioMimetype: null,
          hasImage: false,
          imageBuffer: null,
          imageMimetype: null,
          source: 'whatsapp',
        });
      }
      return {
        text: m.captureFollowup('That draft expired. Send the expense again when ready.'),
      };
    }
    log.warn('CONFIRM_FAIL', {
      phone: session.phone,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { text: m.captureFailed };
  }
}
