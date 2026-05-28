/**
 * The six supported languages. Three (en, hi, ml) ship with hand-translated
 * message packs in the bot. The other three (ta, te, kn) use runtime
 * translation through the API's translate service.
 */

export const LANGUAGES = ['en', 'hi', 'ml', 'ta', 'te', 'kn'] as const;
export type Language = (typeof LANGUAGES)[number];

const LANGUAGE_SET = new Set<string>(LANGUAGES);
export function isLanguage(value: string): value is Language {
  return LANGUAGE_SET.has(value);
}

export interface LanguageMeta {
  code: Language;
  englishName: string;
  nativeName: string;
  /** Whether this language has a hand-translated message pack in the bot. */
  hasNativePack: boolean;
  /** Unicode block used for sibling-script contamination detection. */
  scriptBlock: string;
  scriptRegex: RegExp;
  /**
   * Language tag to send to ASR/TTS providers. Matches BCP-47 closely enough
   * for the OpenAI APIs we use.
   */
  bcp47: string;
}

export const LANGUAGE_META: Record<Language, LanguageMeta> = {
  en: {
    code: 'en',
    englishName: 'English',
    nativeName: 'English',
    hasNativePack: true,
    scriptBlock: 'Latin',
    scriptRegex: /[A-Za-z]/g,
    bcp47: 'en-IN',
  },
  hi: {
    code: 'hi',
    englishName: 'Hindi',
    nativeName: 'हिन्दी',
    hasNativePack: true,
    scriptBlock: 'Devanagari',
    scriptRegex: /[\u0900-\u097F]/g,
    bcp47: 'hi-IN',
  },
  ml: {
    code: 'ml',
    englishName: 'Malayalam',
    nativeName: 'മലയാളം',
    hasNativePack: true,
    scriptBlock: 'Malayalam',
    scriptRegex: /[\u0D00-\u0D7F]/g,
    bcp47: 'ml-IN',
  },
  ta: {
    code: 'ta',
    englishName: 'Tamil',
    nativeName: 'தமிழ்',
    hasNativePack: false,
    scriptBlock: 'Tamil',
    scriptRegex: /[\u0B80-\u0BFF]/g,
    bcp47: 'ta-IN',
  },
  te: {
    code: 'te',
    englishName: 'Telugu',
    nativeName: 'తెలుగు',
    hasNativePack: false,
    scriptBlock: 'Telugu',
    scriptRegex: /[\u0C00-\u0C7F]/g,
    bcp47: 'te-IN',
  },
  kn: {
    code: 'kn',
    englishName: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    hasNativePack: false,
    scriptBlock: 'Kannada',
    scriptRegex: /[\u0C80-\u0CFF]/g,
    bcp47: 'kn-IN',
  },
};

/** Sibling scripts to flag if they appear when translating into the target. */
export const SIBLING_SCRIPTS: Record<Language, ReadonlyArray<RegExp>> = {
  en: [],
  hi: [LANGUAGE_META.ta.scriptRegex, LANGUAGE_META.kn.scriptRegex, LANGUAGE_META.ml.scriptRegex],
  ml: [LANGUAGE_META.ta.scriptRegex, LANGUAGE_META.hi.scriptRegex, LANGUAGE_META.kn.scriptRegex],
  ta: [LANGUAGE_META.ml.scriptRegex, LANGUAGE_META.hi.scriptRegex, LANGUAGE_META.kn.scriptRegex],
  te: [LANGUAGE_META.kn.scriptRegex, LANGUAGE_META.ta.scriptRegex, LANGUAGE_META.hi.scriptRegex],
  kn: [LANGUAGE_META.te.scriptRegex, LANGUAGE_META.ta.scriptRegex, LANGUAGE_META.hi.scriptRegex],
};

export function detectScript(text: string): Language | null {
  for (const lang of LANGUAGES) {
    if (lang === 'en') continue;
    if (LANGUAGE_META[lang].scriptRegex.test(text)) return lang;
  }
  return /[A-Za-z]/.test(text) ? 'en' : null;
}
