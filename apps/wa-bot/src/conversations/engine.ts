/**
 * Conversation engine — top-level dispatcher.
 *
 * Receives a normalized `IncomingMessage` (from real WhatsApp or the
 * simulator transport), routes through the right flow, and returns an
 * `OutgoingReply` containing the text bubble plus an optional voice-note
 * promise the transport awaits in pass two.
 *
 * Order of routing:
 *   1. If audio: transcribe to text + maybe-update session language.
 *   2. Universal commands (HELP / STATUS / RESET / STOP / LANGUAGE).
 *   3. `LINK <code>` always handled regardless of state.
 *   4. State-based dispatch:
 *        GREETING / AWAITING_LANGUAGE        → identity
 *        AWAITING_LINK_CODE                  → link prompt
 *        CAPTURE_CONFIRM                     → confirm flow (CONFIRM/CANCEL/EDIT or follow-up)
 *        SET_BUDGET_*                        → budget flow
 *        LINKED_MAIN (or any linked state)   → capture flow
 *        ERROR                               → silent unless RESET
 *
 * Translation + TTS happens AFTER the flow returns; en/hi/ml use their
 * native packs verbatim, ta/te/kn translate the en pack at send time.
 * Voice synthesis is offered only when `replyMode !== 'text'` and the
 * caller asks for it.
 */
import type {
  ConversationState,
  IncomingMessage,
  OutgoingReply,
  OutgoingVoice,
  Session,
} from '../types.ts';
import { LANGUAGE_META, type Language } from '@versifine/shared';
import { synthesizeIndicSpeech } from '../services/ai/indicSpeech.ts';
import { synthesizeSpeech } from '../services/ai/tts.ts';
import { transcribe } from '../services/ai/transcribe.ts';
import { translateForUser } from '../services/ai/translate.ts';
import { log } from '../utils/logger.ts';
import { chunkText, parseLinkCommand, parseUniversal } from '../utils/text.ts';
import { handleBudget, looksLikeBudgetTrigger } from './flows/budget.ts';
import { handleCapture, handleConfirm } from './flows/capture.ts';
import { handleCorrection, looksLikeCorrection } from './flows/correct.ts';
import { handleLanguagePick, resolveFirstContact } from './flows/identity.ts';
import {
  handleHelp,
  handleLanguageSwitch,
  handleReset,
  handleStatus,
  handleStop,
} from './flows/help.ts';
import { handleLinkCommand, rePrompt } from './flows/link.ts';
import { hasNativePack, getMessages } from './messages/index.ts';
import { getSession, setReplyMode, updateSession } from './state.ts';

interface DispatchOutcome {
  /** Localized text from the flow handler (still in the *engine's source language*, en for ta/te/kn). */
  text: string;
  /** Optional state override; the flow may have already set this on the session. */
  state?: ConversationState;
  /** Whether the engine should attempt voice synthesis for this reply. */
  speakable?: boolean;
}

function detectVoiceLanguage(detected: string, current: Language): Language {
  const lower = detected.toLowerCase().split('-')[0] ?? '';
  if (
    lower === 'en' ||
    lower === 'hi' ||
    lower === 'ml' ||
    lower === 'ta' ||
    lower === 'te' ||
    lower === 'kn'
  ) {
    return lower as Language;
  }
  return current;
}

async function dispatch(session: Session, message: IncomingMessage): Promise<DispatchOutcome> {
  // Universal commands first — they always win.
  const universal = parseUniversal(message.body);
  if (universal) {
    switch (universal.command) {
      case 'HELP':
      case 'MENU':
        return { text: handleHelp(session).text, speakable: false };
      case 'STATUS':
        return { text: handleStatus(session).text, speakable: false };
      case 'RESET':
      case 'BACK':
        return { text: handleReset(session).text, speakable: false };
      case 'STOP':
        return { text: handleStop(session).text, speakable: false };
      case 'LANGUAGE':
        return { text: handleLanguageSwitch(session).text, speakable: false };
      case 'HUMAN':
        return { text: handleHelp(session).text, speakable: false };
      case 'UNDO':
        // UNDO not yet wired; fall back to help.
        return { text: handleHelp(session).text, speakable: false };
      case 'CONFIRM':
      case 'CANCEL':
      case 'EDIT': {
        // Confirm-flow universal terms only matter in CAPTURE_CONFIRM.
        if (session.state === 'CAPTURE_CONFIRM') {
          const result = await handleConfirm(
            session,
            universal.command,
            universal.command === 'EDIT' ? '' : null,
          );
          return { text: result.text, speakable: true };
        }
        // Otherwise the user typed CONFIRM/CANCEL out of context; ignore.
        return { text: 'Nothing to confirm right now. Send HELP for commands.', speakable: false };
      }
    }
  }

  // Link command always honored — binds this number to a pre-existing web
  // account (the advanced path). The common case never needs it.
  const link = parseLinkCommand(message.body);
  if (link) {
    const out = await handleLinkCommand(session, link.code);
    return { text: out.text, speakable: true };
  }

  // Safety guard: if we somehow reach here without a linked account (e.g. the
  // legacy web-claim AWAITING_LINK_CODE state), re-prompt for linking. The
  // onboarding gate in runEngine normally provisions the account first.
  if (session.state === 'AWAITING_LINK_CODE' || !session.linked) {
    return { text: rePrompt(session).text, speakable: false };
  }

  // CAPTURE_CONFIRM with free-form follow-up.
  if (session.state === 'CAPTURE_CONFIRM') {
    const m = getMessages(session.language);
    if (message.hasImage && message.imageBuffer) {
      // Treat a receipt/photo as a fresh capture instead of shoving an
      // empty caption through the text-only draft-confirm endpoint.
      updateSession(session.phone, { lastDraftId: null, state: 'LINKED_MAIN' });
      const active = getSession(session.phone);
      const result = await handleCapture(active, message);
      return { text: result.text, speakable: true };
    }
    if (!message.body.trim()) {
      return {
        text: m.captureFollowup('I need one missing detail. Type it here, or send CANCEL to discard this draft.'),
        speakable: true,
      };
    }
    const result = await handleConfirm(session, 'EDIT', message.body);
    return { text: result.text, speakable: true };
  }

  // Multi-step budget.
  if (
    session.state === 'SET_BUDGET_CATEGORY' ||
    session.state === 'SET_BUDGET_AMOUNT' ||
    looksLikeBudgetTrigger(message.body)
  ) {
    const out = await handleBudget(session, message.body);
    return { text: out.text, speakable: true };
  }

  // "Last one was X not Y" — correction shortcut.
  if (looksLikeCorrection(message.body)) {
    const out = await handleCorrection(session, message.body);
    return { text: out.text, speakable: true };
  }

  // Default linked path: capture.
  const out = await handleCapture(session, message);
  return { text: out.text, speakable: true };
}

async function maybeTranscribe(message: IncomingMessage, session: Session): Promise<{
  text: string;
  language: Language;
}> {
  if (!message.hasAudio || !message.audioBuffer) {
    return { text: message.body, language: session.language };
  }
  const result = await transcribe(
    message.audioBuffer,
    message.audioMimetype ?? 'audio/ogg',
    LANGUAGE_META[session.language].bcp47,
  );
  if (!result.text) {
    return { text: '', language: session.language };
  }
  const detected = detectVoiceLanguage(result.language, session.language);
  if (detected !== session.language) updateSession(session.phone, { language: detected });
  return { text: result.text, language: detected };
}

async function localize(text: string, language: Language): Promise<string> {
  if (hasNativePack(language)) return text;
  return await translateForUser(text, language);
}

async function speak(text: string, language: Language): Promise<OutgoingVoice | null> {
  if (language === 'ta' || language === 'ml') {
    const result = await synthesizeIndicSpeech({ text, language });
    return result ? { buffer: result.buffer, mimetype: result.mimetype, spokenText: result.spokenText } : null;
  }
  return await synthesizeSpeech({ text, language });
}

export async function runEngine(message: IncomingMessage): Promise<OutgoingReply> {
  const session = getSession(message.phone);
  if (session.state === 'ERROR' && parseUniversal(message.body)?.command !== 'RESET') {
    // STOP was previously acknowledged — stay silent unless the user says RESET.
    return { text: '', state: session.state };
  }

  // Voice → text bookkeeping.
  if (message.hasAudio && message.audioBuffer) {
    setReplyMode(message.phone, 'auto');
    const transcribed = await maybeTranscribe(message, session);
    message = {
      ...message,
      body: transcribed.text,
    };
    log.debug('VOICE_TRANSCRIBED', {
      phone: session.phone,
      length: transcribed.text.length,
      language: transcribed.language,
    });
  }

  // Onboarding gate — phone-first sign-up.
  //
  // Before normal dispatch we make sure the account is resolved. RESET/STOP
  // are allowed through so a user is never trapped. Otherwise:
  //   - first contact (not yet resolved) → whoami: returning user proceeds
  //     (we keep their message), new user gets the language menu;
  //   - AWAITING_LANGUAGE → provision the account, then drop into the main flow.
  const onboardCmd = parseUniversal(message.body)?.command;
  const onboardingExempt = onboardCmd === 'RESET' || onboardCmd === 'STOP';
  let welcomePrefix: string | undefined;
  if (!onboardingExempt && (session.state === 'GREETING' || !session.accountResolved)) {
    const first = await resolveFirstContact(session, message.body);
    if (!first.proceed) {
      const text = await localize(first.reply ?? getMessages(session.language).greeting, session.language);
      return { text, state: getSession(session.phone).state };
    }
    welcomePrefix = first.welcomePrefix;
  }
  if (!onboardingExempt && getSession(session.phone).state === 'AWAITING_LANGUAGE') {
    const picked = await handleLanguagePick(getSession(session.phone), message.body);
    const text = await localize(picked.text, getSession(session.phone).language);
    return { text, state: getSession(session.phone).state };
  }

  // Re-read the session: onboarding may have changed language/state/linkage.
  const active = getSession(session.phone);

  let outcome: DispatchOutcome;
  try {
    outcome = await dispatch(active, message);
  } catch (err) {
    log.warn('ENGINE_FAIL', {
      phone: active.phone,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    outcome = { text: 'Something went wrong. Try again or send RESET.' };
  }

  const body = welcomePrefix ? `${welcomePrefix}\n\n${outcome.text}` : outcome.text;
  const localized = await localize(body, active.language);
  const speakable = outcome.speakable !== false && active.replyMode !== 'text' && message.hasAudio;
  const voicePromise: Promise<OutgoingVoice | null> | undefined = speakable
    ? speak(localized, active.language)
    : undefined;

  const final: OutgoingReply = {
    text: localized,
    state: getSession(active.phone).state,
    ...(voicePromise ? { voicePromise } : {}),
  };

  return final;
}

export { chunkText };
