/**
 * Natural-language settings flow.
 *
 * Users say things like "change language to malayalam", "speak in hindi",
 * "reply in english", "voice off", "send me text only", "talk to me",
 * "switch to tamil" — in any of the six languages, by text or voice. These
 * are SETTINGS the user owns, so the bot must act on them directly. They
 * must NOT be routed to the finance copilot (which would refuse them as
 * "outside my lane"). The engine calls `detectSettingsIntent` before the
 * capture/chat dispatch.
 *
 * Two settings are supported today:
 *   - language       → en/hi/ml/ta/te/kn
 *   - reply mode     → text | voice | auto
 */
import { LANGUAGES, LANGUAGE_META, type Language } from '@versifine/shared';
import type { ReplyMode, Session } from '../../types.ts';
import { getMessages } from '../messages/index.ts';
import { setLanguage, setReplyMode, updateSession } from '../state.ts';

export interface SettingsOutcome {
  text: string;
  /** When the language changed, the reply should be rendered in the NEW language. */
  language: Language;
}

/**
 * Map a wide range of spoken/written language names (English + native
 * script + common transliterations across all six languages) to our codes.
 * Order matters only for substring safety — we match whole words.
 */
const LANGUAGE_ALIASES: Record<Language, string[]> = {
  en: ['english', 'angl', 'ingles', 'ഇംഗ്ലീഷ്', 'इंग्लिश', 'अंग्रेज', 'ஆங்கில', 'ఇంగ్లీష్', 'ಇಂಗ್ಲಿಷ್'],
  hi: ['hindi', 'हिंदी', 'हिन्दी', 'ഹിന്ദി', 'ஹிந்தி', 'హిందీ', 'ಹಿಂದಿ'],
  ml: ['malayalam', 'malayam', 'malyalam', 'മലയാളം', 'मलयालम', 'மலையாளம்', 'మలయాళం', 'ಮಲಯಾಳಂ'],
  ta: ['tamil', 'tamizh', 'தமிழ்', 'தமிழ', 'तमिल', 'തമിഴ്', 'తమిళం', 'ತಮಿಳು'],
  te: ['telugu', 'telegu', 'తెలుగు', 'तेलुगु', 'തെലുങ്ക്', 'தெலுங்கு', 'ತೆಲುಗು'],
  kn: ['kannada', 'kannad', 'canada language', 'ಕನ್ನಡ', 'कन्नड', 'കന്നഡ', 'கன்னடம்', 'కన్నడ'],
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

function detectLanguage(text: string): Language | null {
  const lower = text.toLowerCase();
  for (const code of LANGUAGES) {
    for (const alias of LANGUAGE_ALIASES[code]) {
      if (!alias) continue;
      // Native-script aliases: substring match (scripts are unambiguous).
      // Latin aliases: word-ish boundary match to avoid false hits.
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

/**
 * Decide whether `text` is a settings command and, if so, apply it.
 * Returns null when the message is not a settings request (the engine then
 * continues to capture/chat). Never touches finance data.
 */
export function detectSettingsIntent(session: Session, text: string): SettingsOutcome | null {
  const raw = text.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // --- Language change -------------------------------------------------
  // Trigger when the message mentions a language name AND either a change
  // verb or the word "language" — e.g. "change language to malayalam",
  // "speak in hindi", "malayalam please", "reply in tamil".
  const targetLang = detectLanguage(raw);
  const wordCount = raw.split(/\s+/).filter(Boolean).length;
  const hasDigit = /\d/.test(raw);
  const looksLikeLangChange =
    targetLang !== null &&
    !hasDigit &&
    (CHANGE_VERB.test(lower) ||
      LANGUAGE_WORD.test(raw) ||
      /\b(in|to|please|plz)\b/i.test(lower) ||
      // bare language name essentially on its own ("malayalam", "tamil please")
      wordCount <= 2);

  if (targetLang && looksLikeLangChange) {
    setLanguage(session.phone, targetLang);
    // The confirmation should be in the NEW language so the user sees it worked.
    const m = getMessages(targetLang);
    const label = LANGUAGE_META[targetLang].englishName;
    return { text: m.languageChanged?.(label) ?? `✅ Language set to ${label}.`, language: targetLang };
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
        ? m.replyModeText ?? '✅ I will reply with text only now.'
        : mode === 'voice'
          ? m.replyModeVoice ?? '✅ I will reply with voice notes now.'
          : m.replyModeAuto ?? '✅ I will match your input — voice for voice, text for text.';
    return { text: confirm, language: session.language };
  }

  return null;
}
