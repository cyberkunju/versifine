/**
 * Natural-language settings / account-actions flow.
 *
 * Users say things like "change language to malayalam", "speak in hindi",
 * "reply in english", "voice off", "talk to me", "switch to tamil", and
 * account actions like "link my email", "now i need to link email",
 * "connect asha@gmail.com" — in any of the six languages, by text or voice.
 * These are things the USER OWNS, so the bot acts on them directly. They must
 * NOT be routed to the finance copilot (which would refuse them as "outside
 * my lane"). The engine calls `detectSettingsIntent` before capture/chat.
 *
 * Handled here:
 *   - language        → en/hi/ml/ta/te/kn
 *   - reply mode      → text | voice | auto
 *   - email linking   → "link my email", a bare email address, or a follow-up
 *                       email after we asked for one (pending.awaitingEmailLink)
 */
import { LANGUAGES, LANGUAGE_META, type Language } from '@versifine/shared';
import type { ReplyMode, Session } from '../../types.ts';
import { ApiClientError, botEnsureUser } from '../../services/apiClient.ts';
import { log } from '../../utils/logger.ts';
import { parseEmail, looksLikeSkip } from '../../utils/text.ts';
import { getMessages } from '../messages/index.ts';
import { setLanguage, setLinked, setReplyMode, updateSession } from '../state.ts';

export interface SettingsOutcome {
  text: string;
  /** The reply should be rendered in this language (new one if it changed). */
  language: Language;
}

/**
 * Map a wide range of spoken/written language names (English + native
 * script + common transliterations across all six languages) to our codes.
 */
const LANGUAGE_ALIASES: Record<Language, string[]> = {
  en: ['english', 'angl', 'ingles', 'ഇംഗ്ലീഷ്', 'इंग्लिश', 'अंग्रेज', 'ஆங்கில', 'ఇంగ్లీష్', 'ಇಂಗ್ಲಿಷ್'],
  hi: ['hindi', 'हिंदी', 'हिन्दी', 'ഹിന്ദി', 'ஹிந்தி', 'హిందీ', 'ಹಿಂದಿ'],
  ml: ['malayalam', 'malayam', 'malyalam', 'മലയാളം', 'मलयालम', 'மலையாளம்', 'మలయాళం', 'ಮಲಯಾಳಂ'],
  ta: ['tamil', 'tamizh', 'தமிழ்', 'தமிழ', 'तमिल', 'തമിഴ്', 'తమిళం', 'ತಮಿಳು'],
  te: ['telugu', 'telegu', 'తెలుగు', 'तेलुगु', 'തെലുങ്ക്', 'தெலுங்கு', 'ತೆಲುಗು'],
  kn: ['kannada', 'kannad', 'canada language', 'ಕನ್ನಡ', 'कन्नड', 'കന്നഡ', 'கன்னடம்', 'కన్నడ'],
  bn: ['bengali', 'bangla', 'bangali', 'বাংলা', 'बंगाली', 'ബംഗാളി', 'பெங்காலி', 'బెంగాలీ'],
  mr: ['marathi', 'marati', 'मराठी', 'मराठि', 'മറാത്തി', 'மராத்தி', 'మరాఠీ'],
  gu: ['gujarati', 'gujrati', 'ગુજરાતી', 'गुजराती', 'ഗുജറാത്തി', 'குஜராத்தி', 'గుజరాతీ'],
  pa: ['punjabi', 'panjabi', 'ਪੰਜਾਬੀ', 'पंजाबी', 'പഞ്ചാബി', 'பஞ்சாபி', 'పంజాబీ'],
  od: ['odia', 'oriya', 'odiya', 'ଓଡ଼ିଆ', 'ओड़िया', 'ഒഡിയ', 'ஒடியா', 'ఒడియా'],
};

/** Verbs that signal the user wants to change a setting. */
const CHANGE_VERB =
  /\b(change|set|switch|make|use|change to|talk|speak|reply|respond|convert|change the|set the)\b/i;
const LANGUAGE_WORD = /\b(language|lang|bhasha|भाषा|ഭാഷ|மொழி|భాష|ಭಾಷೆ)\b/i;

/** Reply-mode phrases (English + light multilingual). */
const VOICE_ON =
  /\b(voice on|speak to me|talk to me|send (me )?voice|reply (in |with )?voice|voice note|audio reply|voice mode|speak)\b/i;
const VOICE_OFF =
  /\b(voice off|no voice|stop voice|text only|only text|reply (in |with )?text|text mode|don'?t speak|no audio|silent|mute)\b/i;
const AUTO_MODE = /\b(auto( mode)?|mirror|match (my )?input|both)\b/i;

/** Intent to link/connect an email to the account. */
const EMAIL_INTENT =
  /\b(link|connect|attach|add|set|register|sync|join)\b[^.\n]{0,30}\b(e[\s-]?mail|account|gmail|web)\b/i;
const EMAIL_WORD = /\b(e[\s-]?mail|gmail)\b/i;

function detectLanguage(text: string): Language | null {
  const lower = text.toLowerCase();
  for (const code of LANGUAGES) {
    for (const alias of LANGUAGE_ALIASES[code]) {
      if (!alias) continue;
      const isLatin = /^[a-z ]+$/i.test(alias);
      if (isLatin) {
        const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (re.test(lower)) return code;
      } else if (text.includes(alias)) {
        return code;
      }
    }
  }
  return null;
}

/** Question/command words that, with a "language" word, mean "show the menu". */
const LANGUAGE_MENU_VERB =
  /\b(change|switch|set|choose|select|pick|which|what|list|show|see|available|supported|supports?|options?|change to|switch to)\b/i;

/**
 * True when the user wants to CHOOSE/CHANGE/SEE languages but did NOT name a
 * specific target — e.g. "change language", "switch language", "which
 * languages do you support", or a bare "language" / "भाषा". When a specific
 * language IS named ("change to Malayalam") this returns false so the caller
 * switches directly instead of re-showing the menu.
 */
export function wantsLanguageMenu(text: string): boolean {
  const raw = (text ?? '').trim();
  if (!raw || /\d/.test(raw)) return false;
  if (detectLanguage(raw)) return false; // a concrete target → direct switch
  if (!LANGUAGE_WORD.test(raw)) return false; // must mention language/भाषा/मொழி…
  const lower = raw.toLowerCase();
  const wordCount = raw.split(/\s+/).filter(Boolean).length;
  // "change language", "which languages supported", or just "language"/"भाषा".
  return LANGUAGE_MENU_VERB.test(lower) || wordCount <= 2;
}

async function linkEmail(session: Session, email: string): Promise<SettingsOutcome> {
  const m = getMessages(session.language);
  try {
    const account = await botEnsureUser(session.phone, session.language, email);
    setLinked(session.phone, { userId: account.userId, spaceId: account.spaceId });
    updateSession(session.phone, { pending: { ...session.pending, awaitingEmailLink: false } });
    const head = account.linkedExisting
      ? (m.emailLinkedExisting?.(account.email ?? email) ??
        `✅ Linked to your existing account (${email}).`)
      : (m.emailLinked?.(account.email ?? email) ?? `✅ Linked your email (${email}).`);
    return { text: head, language: session.language };
  } catch (err) {
    log.warn('EMAIL_LINK_FAIL', {
      phone: session.phone,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    if (err instanceof ApiClientError && err.code === 'CONFLICT') {
      return {
        text: err.message,
        language: session.language,
      };
    }
    return {
      text: m.error ?? "Couldn't link that right now — try again in a moment.",
      language: session.language,
    };
  }
}

/**
 * Decide whether `text` is a settings / account action and, if so, apply it.
 * Returns null when the message is not one (the engine then continues to
 * capture/chat). Never touches finance data.
 */
export async function detectSettingsIntent(
  session: Session,
  text: string,
): Promise<SettingsOutcome | null> {
  const raw = text.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const email = parseEmail(raw);

  // --- Email linking ---------------------------------------------------
  // (a) We previously asked for the email → this message should be it (or a skip).
  if (session.pending?.awaitingEmailLink) {
    if (email) return await linkEmail(session, email);
    if (looksLikeSkip(raw)) {
      updateSession(session.phone, { pending: { ...session.pending, awaitingEmailLink: false } });
      const m = getMessages(session.language);
      return { text: m.emailSkipped ?? 'No problem — skipped.', language: session.language };
    }
    // Not an email and not a skip while we're waiting: only treat as the
    // email step if it still looks email-ish; otherwise fall through so a
    // real expense/question isn't swallowed.
    if (EMAIL_WORD.test(lower)) {
      const m = getMessages(session.language);
      return {
        text: m.emailInvalid ?? "That doesn't look like an email. Send a valid one, or reply SKIP.",
        language: session.language,
      };
    }
    // Anything else → drop the pending flag and let the engine handle it.
    updateSession(session.phone, { pending: { ...session.pending, awaitingEmailLink: false } });
  }

  // (b) A bare email or an explicit "link my email" request.
  if (
    email &&
    (EMAIL_INTENT.test(lower) || EMAIL_WORD.test(lower) || raw.split(/\s+/).length <= 2)
  ) {
    return await linkEmail(session, email);
  }
  if (!email && EMAIL_INTENT.test(lower)) {
    // User wants to link but didn't give the address yet — ask for it.
    updateSession(session.phone, { pending: { ...session.pending, awaitingEmailLink: true } });
    const m = getMessages(session.language);
    return {
      text: m.askEmail ?? 'Sure — what email should I link? Send it here, or reply SKIP.',
      language: session.language,
    };
  }

  // --- Language change -------------------------------------------------
  const targetLang = detectLanguage(raw);
  const wordCount = raw.split(/\s+/).filter(Boolean).length;
  const hasDigit = /\d/.test(raw);
  const looksLikeLangChange =
    targetLang !== null &&
    !hasDigit &&
    (CHANGE_VERB.test(lower) ||
      LANGUAGE_WORD.test(raw) ||
      /\b(in|to|please|plz)\b/i.test(lower) ||
      wordCount <= 2);

  if (targetLang && looksLikeLangChange) {
    setLanguage(session.phone, targetLang);
    const m = getMessages(targetLang);
    const label = LANGUAGE_META[targetLang].englishName;
    return {
      text: m.languageChanged?.(label) ?? `✅ Language set to ${label}.`,
      language: targetLang,
    };
  }

  // --- Reply mode ------------------------------------------------------
  let mode: ReplyMode | null = null;
  if (VOICE_OFF.test(lower)) mode = 'text';
  else if (VOICE_ON.test(lower)) mode = 'voice';
  else if (AUTO_MODE.test(lower) && CHANGE_VERB.test(lower)) mode = 'auto';

  if (mode) {
    setReplyMode(session.phone, mode);
    updateSession(session.phone, { replyMode: mode });
    const m = getMessages(session.language);
    const confirm =
      mode === 'text'
        ? (m.replyModeText ?? '✅ I will reply with text only now.')
        : mode === 'voice'
          ? (m.replyModeVoice ?? '✅ I will reply with voice notes now.')
          : (m.replyModeAuto ?? '✅ I will match your input — voice for voice, text for text.');
    return { text: confirm, language: session.language };
  }

  return null;
}
