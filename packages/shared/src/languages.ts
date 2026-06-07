/**
 * The eleven supported languages — English plus the ten Indian languages
 * covered end-to-end by Sarvam (Saaras STT, Bulbul TTS, Mayura translate).
 *
 * Three (en, hi, ml) ship with hand-translated message packs in the bot.
 * The other eight (ta, te, kn, bn, mr, gu, pa, od) use runtime translation
 * through Sarvam Mayura at send time (`hasNativePack: false`).
 */

export const LANGUAGES = [
  'en',
  'hi',
  'ml',
  'ta',
  'te',
  'kn',
  'bn',
  'mr',
  'gu',
  'pa',
  'od',
] as const;
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
  bn: {
    code: 'bn',
    englishName: 'Bengali',
    nativeName: 'বাংলা',
    hasNativePack: false,
    scriptBlock: 'Bengali',
    scriptRegex: /[\u0980-\u09FF]/g,
    bcp47: 'bn-IN',
  },
  mr: {
    code: 'mr',
    englishName: 'Marathi',
    nativeName: 'मराठी',
    hasNativePack: false,
    // Marathi shares the Devanagari block with Hindi, so script alone can't
    // distinguish the two — language routing must trust the user's chosen
    // language for Devanagari text rather than guessing from the script.
    scriptBlock: 'Devanagari',
    scriptRegex: /[\u0900-\u097F]/g,
    bcp47: 'mr-IN',
  },
  gu: {
    code: 'gu',
    englishName: 'Gujarati',
    nativeName: 'ગુજરાતી',
    hasNativePack: false,
    scriptBlock: 'Gujarati',
    scriptRegex: /[\u0A80-\u0AFF]/g,
    bcp47: 'gu-IN',
  },
  pa: {
    code: 'pa',
    englishName: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    hasNativePack: false,
    scriptBlock: 'Gurmukhi',
    scriptRegex: /[\u0A00-\u0A7F]/g,
    bcp47: 'pa-IN',
  },
  od: {
    code: 'od',
    englishName: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    hasNativePack: false,
    scriptBlock: 'Odia',
    scriptRegex: /[\u0B00-\u0B7F]/g,
    bcp47: 'od-IN',
  },
};

/**
 * Sibling scripts to flag if they appear when translating into the target —
 * i.e. the distinct Indic scripts OTHER than the target's own. Computed from
 * the registry so it stays correct as languages are added. Languages that
 * share a script block (Hindi & Marathi both use Devanagari) are NOT siblings
 * of each other — script alone can't tell them apart.
 */
export const SIBLING_SCRIPTS: Record<Language, ReadonlyArray<RegExp>> = (() => {
  const map = {} as Record<Language, ReadonlyArray<RegExp>>;
  for (const lang of LANGUAGES) {
    if (lang === 'en') {
      map[lang] = [];
      continue;
    }
    const ownBlock = LANGUAGE_META[lang].scriptBlock;
    const seen = new Set<string>([ownBlock, 'Latin']);
    const regexes: RegExp[] = [];
    for (const other of LANGUAGES) {
      const meta = LANGUAGE_META[other];
      if (seen.has(meta.scriptBlock)) continue;
      seen.add(meta.scriptBlock);
      regexes.push(meta.scriptRegex);
    }
    map[lang] = regexes;
  }
  return map;
})();

/**
 * Best-effort detection of the dominant Indic script in a piece of text.
 * Returns the language code for the first matching script block, English for
 * Latin-only text, or null when nothing matches.
 *
 * NOTE: Devanagari is shared by Hindi and Marathi, so this returns `hi` for
 * any Devanagari text. Callers that care about the Hindi/Marathi distinction
 * must fall back to the user's chosen language (see `resolveLanguage` in the
 * bot's transcribe service).
 */
export function detectScript(text: string): Language | null {
  for (const lang of LANGUAGES) {
    if (lang === 'en') continue;
    // Skip Marathi here: it shares Devanagari with Hindi, which is checked
    // first, so Devanagari text resolves to `hi` and we never misreport `mr`.
    if (lang === 'mr') continue;
    if (LANGUAGE_META[lang].scriptRegex.test(text)) return lang;
  }
  return /[A-Za-z]/.test(text) ? 'en' : null;
}

/** True when this language is written in the Devanagari script (hi, mr). */
export function isDevanagari(lang: Language): boolean {
  return LANGUAGE_META[lang].scriptBlock === 'Devanagari';
}
