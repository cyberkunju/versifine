/**
 * Identity flow.
 *
 * Runs on the very first interaction with an unlinked phone. We greet,
 * ask for a language, then nudge the user toward the LINK flow.
 *
 * Language is picked either by replying with a number (1-6) or with the
 * native language name. After selection we move to AWAITING_LINK_CODE
 * which `engine.ts` interprets as "everything except `LINK <code>` gets
 * the link prompt".
 */
import type { Language } from '@finehance/shared';
import { isLanguage, LANGUAGE_META, LANGUAGES } from '@finehance/shared';
import type { Session } from '../../types.ts';
import { getMessages } from '../messages/index.ts';
import { setLanguage, setState } from '../state.ts';

const NUMBER_TO_LANG: Record<string, Language> = {
  '1': 'en',
  '2': 'hi',
  '3': 'ml',
  '4': 'ta',
  '5': 'te',
  '6': 'kn',
};

const NAME_TO_LANG: Record<string, Language> = {
  english: 'en',
  hindi: 'hi',
  हिन्दी: 'hi',
  हिंदी: 'hi',
  malayalam: 'ml',
  മലയാളം: 'ml',
  tamil: 'ta',
  தமிழ்: 'ta',
  telugu: 'te',
  తెలుగు: 'te',
  kannada: 'kn',
  ಕನ್ನಡ: 'kn',
};

function pickLanguage(text: string): Language | null {
  const trimmed = text.trim().toLowerCase();
  if (NUMBER_TO_LANG[trimmed]) return NUMBER_TO_LANG[trimmed];
  if (isLanguage(trimmed)) return trimmed as Language;
  if (NAME_TO_LANG[trimmed]) return NAME_TO_LANG[trimmed];
  // Single-token detection of a typed Indian language name.
  for (const lang of LANGUAGES) {
    if (trimmed === LANGUAGE_META[lang].englishName.toLowerCase()) return lang;
    if (trimmed === LANGUAGE_META[lang].nativeName.toLowerCase()) return lang;
  }
  return null;
}

export interface IdentityResult {
  text: string;
  state: Session['state'];
  language: Language;
}

export function handleGreetingOrLanguage(session: Session, body: string): IdentityResult {
  const m = getMessages(session.language);

  // First touch — emit the greeting and move to AWAITING_LANGUAGE.
  if (session.state === 'GREETING') {
    setState(session.phone, 'AWAITING_LANGUAGE');
    return { text: m.greeting, state: 'AWAITING_LANGUAGE', language: session.language };
  }

  // Awaiting a language pick.
  const picked = pickLanguage(body);
  if (!picked) {
    return { text: m.greeting, state: 'AWAITING_LANGUAGE', language: session.language };
  }

  setLanguage(session.phone, picked);
  setState(session.phone, 'AWAITING_LINK_CODE');
  const localized = getMessages(picked);
  const text = `${localized.languageSet(LANGUAGE_META[picked].englishName)}\n\n${localized.linkPrompt}`;
  return { text, state: 'AWAITING_LINK_CODE', language: picked };
}
