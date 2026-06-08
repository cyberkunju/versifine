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
import { synthesizeBulbul } from '../services/ai/bulbulSpeech.ts';
import { synthesizeSpeech } from '../services/ai/tts.ts';
import { transcribe } from '../services/ai/transcribe.ts';
import { translateForUser } from '../services/ai/translate.ts';
import { translateToEnglish } from '../services/ai/translate.ts';
import { log } from '../utils/logger.ts';
import { chunkText, parseLinkCommand, parseUniversal } from '../utils/text.ts';
import { handleBudget, looksLikeBudgetTrigger, pickCategory, pickAmount } from './flows/budget.ts';
import { handleCapture, handleConfirm } from './flows/capture.ts';
import { handleCorrection, looksLikeCorrection } from './flows/correct.ts';
import { handleLanguagePick, handleEmailStep, resolveFirstContact } from './flows/identity.ts';
import {
  handleHelp,
  handleLanguageSwitch,
  handleReset,
  handleStatus,
  handleStop,
} from './flows/help.ts';
import { handleLinkCommand, rePrompt } from './flows/link.ts';
import { detectSettingsIntent, wantsLanguageMenu } from './flows/settings.ts';
import { hasNativePack, getMessages } from './messages/index.ts';
import {
  buildLanguageMenuTier1,
  buildLanguageMenuTier2,
  isMoreLanguagesRequest,
} from './languageMenu.ts';
import type { InteractiveListSpec } from '../types.ts';
import { getSession, setReplyMode, setState, updateSession, preloadSession, persistSession } from './state.ts';

interface DispatchOutcome {
  /** Localized text from the flow handler (still in the *engine's source language*, en for ta/te/kn). */
  text: string;
  /** Optional state override; the flow may have already set this on the session. */
  state?: ConversationState;
  /** Whether the engine should attempt voice synthesis for this reply. */
  speakable?: boolean;
  /** Optional tappable interactive list (rendered on the Cloud API path). */
  interactive?: InteractiveListSpec;
}

/**
 * Build the (localized) tappable language picker plus its plain-text fallback.
 * Tier 1 is the most-spoken languages + a "More" row; tier 2 is the rest.
 */
async function languageMenu(
  session: Session,
  tier: 1 | 2,
): Promise<{ text: string; interactive: InteractiveListSpec }> {
  const m = getMessages(session.language);
  const prompt = tier === 2 ? 'More languages — tap to choose:' : 'Please choose your language:';
  const body = await localize(prompt, session.language);
  const interactive = tier === 2 ? buildLanguageMenuTier2(body) : buildLanguageMenuTier1(body);
  // Fallback text for transports without interactive support: the numbered menu.
  return { text: m.greeting, interactive };
}

/**
 * Languages routed through English for the understanding pipeline. The LLM is
 * markedly stronger on English than on lower-resource Indian languages, so for
 * these we translate the user's message to English (Sarvam Mayura) before
 * intent/parse/chat, then localize the reply back into their language. The
 * proven languages (en/hi/ml/ta/te/kn) are understood natively.
 */
const ENGLISH_BRIDGE_LANGS = new Set<Language>(['bn', 'mr', 'gu', 'pa', 'od']);

async function dispatch(session: Session, message: IncomingMessage): Promise<DispatchOutcome> {
  // English bridge — for lower-resource languages, reason over an English
  // translation of the user's message (the reply is localized back later).
  if (
    message.body &&
    message.body.trim() &&
    ENGLISH_BRIDGE_LANGS.has(session.language) &&
    !parseUniversal(message.body) &&
    !parseLinkCommand(message.body)
  ) {
    const bridged = await translateToEnglish(message.body, session.language);
    if (bridged && bridged.trim()) {
      message = { ...message, body: bridged };
    }
  }

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
      case 'BACK': {
        const resetText = handleReset(session).text;
        // After RESET the user is in AWAITING_LANGUAGE — serve the tappable
        // tier-1 menu right away so they don't need to send a second message.
        const resetMenu = await languageMenu(getSession(session.phone), 1);
        return {
          text: resetText,
          speakable: false,
          interactive: resetMenu.interactive,
        };
      }
      case 'STOP':
        return { text: handleStop(session).text, speakable: false };
      case 'LANGUAGE': {
        handleLanguageSwitch(session); // drops into AWAITING_LANGUAGE
        const menu = await languageMenu(session, 1);
        return { text: menu.text, speakable: false, interactive: menu.interactive };
      }
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
        text: m.captureFollowup(
          'I need one missing detail. Type it here, or send CANCEL to discard this draft.',
        ),
        speakable: true,
      };
    }
    const result = await handleConfirm(session, 'EDIT', message.body);
    return { text: result.text, speakable: true };
  }

  // Settings / account actions the user owns — change language / reply mode
  // by natural language or voice ("change language to malayalam", "voice
  // off", "speak in hindi"), and link an email on demand ("link my email",
  // "now i need to link email", a bare address). Handled here BEFORE the
  // copilot so these are never refused as out-of-scope.
  const settings = await detectSettingsIntent(session, message.body);
  if (settings) {
    return { text: settings.text, speakable: false };
  }

  // "Change language" / "which languages do you support" / a bare "language" —
  // the user wants to choose a language but didn't name one. Show the tappable
  // picker (tier 1). (A NAMED target like "change to Malayalam" was already
  // handled directly by detectSettingsIntent above.)
  if (wantsLanguageMenu(message.body)) {
    setState(session.phone, 'AWAITING_LANGUAGE');
    const menu = await languageMenu(getSession(session.phone), 1);
    return { text: menu.text, speakable: false, interactive: menu.interactive };
  }

  // Multi-step budget.
  if (
    session.state === 'SET_BUDGET_CATEGORY' ||
    session.state === 'SET_BUDGET_AMOUNT' ||
    looksLikeBudgetTrigger(message.body)
  ) {
    if (session.state === 'SET_BUDGET_CATEGORY' || session.state === 'SET_BUDGET_AMOUNT') {
      let isBudgetResponse = false;
      if (session.state === 'SET_BUDGET_CATEGORY') {
        isBudgetResponse = pickCategory(message.body) !== null;
      } else {
        isBudgetResponse = pickAmount(message.body) !== null;
      }

      if (!isBudgetResponse) {
        try {
          const { captureText } = await import('../services/apiClient.ts');
          const check = await captureText(session.phone, message.body, session.language);
          if (
            check.intent === 'query_spending' ||
            check.intent === 'query_summary' ||
            check.intent === 'query_forecast' ||
            check.intent === 'expense' ||
            check.intent === 'income' ||
            check.intent === 'transfer' ||
            check.intent === 'chat'
          ) {
            updateSession(session.phone, { state: 'LINKED_MAIN', pending: {} });
            session.state = 'LINKED_MAIN';
            session.pending = {};
          }
        } catch {
          // ignore error and proceed
        }
      }
    }

    if (
      session.state === 'SET_BUDGET_CATEGORY' ||
      session.state === 'SET_BUDGET_AMOUNT' ||
      looksLikeBudgetTrigger(message.body)
    ) {
      const out = await handleBudget(session, message.body);
      return { text: out.text, speakable: true };
    }
  }

  // "Last one was X not Y" — correction shortcut. Only when there's a recent
  // transaction to amend, so a fresh "paid 500 instead of cash" stays a new
  // capture rather than being mistaken for a correction.
  if (session.lastTransactionId && looksLikeCorrection(message.body)) {
    const out = await handleCorrection(session, message.body);
    return { text: out.text, speakable: true };
  }

  // Default linked path: capture.
  const out = await handleCapture(session, message);
  return { text: out.text, speakable: true };
}

async function maybeTranscribe(
  message: IncomingMessage,
  session: Session,
): Promise<{
  text: string;
  language: Language;
}> {
  if (!message.hasAudio || !message.audioBuffer) {
    return { text: message.body, language: session.language };
  }
  // Pass the user's chosen language only as a SOFT fallback — the transcriber
  // auto-detects so code-mixed / English speech isn't mangled into the wrong
  // script. We do NOT flip the session's reply language here: the user picked
  // it deliberately at onboarding and can change it with LANGUAGE / "speak in
  // X". Voice detection only ensures we transcribe what was actually said.
  const result = await transcribe(
    message.audioBuffer,
    message.audioMimetype ?? 'audio/ogg',
    LANGUAGE_META[session.language].bcp47,
  );
  if (!result.text) {
    return { text: '', language: session.language };
  }
  return { text: result.text, language: session.language };
}

async function localize(text: string, language: Language): Promise<string> {
  if (hasNativePack(language)) return text;
  return await translateForUser(text, language);
}

async function speak(text: string, language: Language): Promise<OutgoingVoice | null> {
  // Primary: Sarvam Bulbul (native Indic + Indian-English voices, MP3 output
  // WhatsApp accepts). Falls back to the OpenAI TTS paths only if Bulbul is
  // unavailable, then to text-only.
  const bulbul = await synthesizeBulbul({ text, language });
  if (bulbul) return bulbul;

  if (language === 'ta' || language === 'ml') {
    const result = await synthesizeIndicSpeech({ text, language });
    return result
      ? { buffer: result.buffer, mimetype: result.mimetype, spokenText: result.spokenText }
      : null;
  }
  return await synthesizeSpeech({ text, language });
}

export async function runEngine(message: IncomingMessage): Promise<OutgoingReply> {
  const session = await preloadSession(message.phone);
  if (session.state === 'ERROR' && parseUniversal(message.body)?.command !== 'RESET') {
    // STOP was previously acknowledged — stay silent unless the user says RESET.
    return { text: '', state: session.state };
  }

  // Voice → text. We transcribe once here (the bot's own transcribe path)
  // and route the result as TEXT, so the API isn't asked to transcribe the
  // same audio a second time. We keep the transcript to (a) decide routing
  // and (b) echo it back to the user so they see what we heard.
  let voiceTranscript: string | null = null;
  if (message.hasAudio && message.audioBuffer) {
    setReplyMode(message.phone, 'auto');
    const transcribed = await maybeTranscribe(message, session);
    const rawTranscript = transcribed.text.trim();
    // Use the transcript AS-IS. We deliberately do NOT run an LLM "cleaner"
    // over it: that step refused non-transaction voice commands (e.g. spoken
    // "change language to Malayalam") and hallucinated amounts (Malayalam
    // "അയ്യായിരം"=5000 came back "8000"). The downstream capture pipeline
    // (intent + multilingual parser + regex amount extraction) already handles
    // raw, code-mixed Indic speech, so the faithful transcript is what routes.
    voiceTranscript = rawTranscript ? rawTranscript : null;
    log.info('VOICE_TRANSCRIBED', {
      phone: session.phone,
      length: transcribed.text.length,
      language: transcribed.language,
      transcript: rawTranscript.slice(0, 200),
    });
    if (!voiceTranscript) {
      // Couldn't make out the audio — tell the user instead of failing
      // silently or pushing an empty body downstream.
      const couldntHear = await localize(
        "🎤 I couldn't make out that voice note. Could you try again or type it?",
        getSession(message.phone).language,
      );
      return { text: couldntHear, state: getSession(message.phone).state };
    }
    // Collapse to a text message carrying the transcript. Downstream flows
    // (capture/confirm/budget/query) now see plain text — single source of
    // truth, no double transcription.
    message = {
      ...message,
      body: voiceTranscript,
      hasAudio: false,
      audioBuffer: null,
    };
  }

  // Record user message in conversational history
  if (message.body && message.body.trim()) {
    let history = (session.pending.history as Array<{ role: 'user' | 'assistant'; content: string }>) || [];
    history.push({ role: 'user', content: message.body });
    if (history.length > 10) {
      history = history.slice(-10);
    }
    session.pending.history = history;
  }

  // Onboarding gate — phone-first sign-up.
  //
  // Before normal dispatch we make sure the account is resolved. RESET/STOP
  // are allowed through so a user is never trapped. Otherwise:
  //   - first contact (not yet resolved) → whoami: returning user proceeds
  //     (we keep their message), new user gets the tappable language menu;
  //   - AWAITING_LANGUAGE → handle the tap/typed language choice, or if the
  //     user tapped "More languages" send tier 2;
  //   - AWAITING_EMAIL → optional email step.
  const onboardCmd = parseUniversal(message.body)?.command;
  const onboardingExempt = onboardCmd === 'RESET' || onboardCmd === 'STOP';
  let welcomePrefix: string | undefined;

  if (!onboardingExempt && (session.state === 'GREETING' || !session.accountResolved)) {
    const first = await resolveFirstContact(session, message.body);
    if (!first.proceed) {
      // New user — show the tappable language menu (tier 1).
      const menu = await languageMenu(getSession(session.phone), 1);
      await persistSession(session.phone);
      return { text: menu.text, interactive: menu.interactive, state: getSession(session.phone).state };
    }
    welcomePrefix = first.welcomePrefix;
  }

  if (!onboardingExempt && getSession(session.phone).state === 'AWAITING_LANGUAGE') {
    const body = message.body.trim();

    // User tapped / typed "More languages" → show tier 2.
    if (isMoreLanguagesRequest(body)) {
      const menu = await languageMenu(getSession(session.phone), 2);
      await persistSession(session.phone);
      return { text: menu.text, interactive: menu.interactive, state: getSession(session.phone).state };
    }

    const picked = await handleLanguagePick(getSession(session.phone), body);
    const text = await localize(picked.text, getSession(session.phone).language);
    await persistSession(session.phone);
    return { text, state: getSession(session.phone).state };
  }

  if (!onboardingExempt && getSession(session.phone).state === 'AWAITING_EMAIL') {
    const stepped = await handleEmailStep(getSession(session.phone), message.body);
    if (stepped.consumed) {
      const text = await localize(stepped.text, getSession(session.phone).language);
      await persistSession(session.phone);
      return { text, state: getSession(session.phone).state };
    }
    // Not consumed: the user typed a real action at the email prompt.
    // The account is now provisioned — fall through and dispatch the message.
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

  // Record bot response in conversational history
  if (localized && localized.trim()) {
    let history = (active.pending.history as Array<{ role: 'user' | 'assistant'; content: string }>) || [];
    history.push({ role: 'assistant', content: localized });
    if (history.length > 10) {
      history = history.slice(-10);
    }
    active.pending.history = history;
  }

  // Voice-in → prefix the reply with what we heard so the user can confirm
  // the transcription, and mirror the modality (voice-in → voice-out).
  const wasVoice = voiceTranscript !== null;
  const withTranscript = wasVoice ? `🎤 _“${voiceTranscript}”_\n\n${localized}` : localized;

  const speakable = outcome.speakable !== false && active.replyMode !== 'text' && wasVoice;
  // Only the actual answer is spoken, never the transcript echo.
  const voicePromise: Promise<OutgoingVoice | null> | undefined = speakable
    ? speak(localized, active.language)
    : undefined;

  await persistSession(active.phone);

  const final: OutgoingReply = {
    text: withTranscript,
    state: getSession(active.phone).state,
    ...(voicePromise ? { voicePromise } : {}),
    // Propagate an interactive list (e.g. language picker) from dispatch outcomes.
    ...(outcome.interactive ? { interactive: outcome.interactive } : {}),
  };

  return final;
}

export { chunkText };
