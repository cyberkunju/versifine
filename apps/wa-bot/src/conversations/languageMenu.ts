/**
 * Tappable language picker for the WhatsApp Cloud API.
 *
 * WhatsApp interactive lists cap at 10 rows total, but we support 11
 * languages — so the picker is two-tier:
 *
 *   Tier 1 (10 rows): English + the 8 most-spoken Indian languages, plus a
 *                     "🌐 More languages →" row.
 *   Tier 2          : the remaining languages (Punjabi, Odia).
 *
 * Each row's TITLE is the language's native name, which is exactly what the
 * API webhook relays back on tap and what `pickLanguage` already understands —
 * so a tap is handled identically to typing the language name. The "More"
 * row relays a control phrase we detect with `isMoreLanguagesRequest`.
 *
 * The whatsapp-web.js transport can't render lists, so every menu also ships
 * a plain-text fallback (the numbered greeting from the message packs).
 */
import { LANGUAGE_META, type Language } from '@versifine/shared';
import type { InteractiveListSpec } from '../types.ts';

/** Control row that opens tier 2. Its title is what WhatsApp relays on tap. */
export const MORE_LANGUAGES_TITLE = '🌐 More languages';

/**
 * Tier 1 languages, ordered by number of speakers in India (most first),
 * with English first as the widely-understood default. Exactly 9 here so the
 * tier-1 list is 9 languages + the "More" row = 10 rows (the hard cap).
 */
const TIER1_LANGS: Language[] = ['en', 'hi', 'bn', 'mr', 'te', 'ta', 'gu', 'kn', 'ml'];

/** Everything not in tier 1 spills into tier 2. */
const TIER2_LANGS: Language[] = ['pa', 'od'];

function row(lang: Language) {
  const meta = LANGUAGE_META[lang];
  // Title = native name (what gets matched on tap). Description = English name
  // for users who don't read the native script.
  return {
    id: `lang_${lang}`,
    title: meta.nativeName.slice(0, 24),
    description: meta.englishName,
  };
}

/**
 * Build the tier-1 interactive language menu. `body` is the (already localized)
 * prompt line; the rows themselves are script-universal.
 */
export function buildLanguageMenuTier1(body: string): InteractiveListSpec {
  return {
    body,
    button: 'Languages',
    sections: [
      {
        title: 'Languages',
        rows: [
          ...TIER1_LANGS.map(row),
          { id: 'lang_more', title: MORE_LANGUAGES_TITLE, description: 'Punjabi, Odia & more' },
        ],
      },
    ],
  };
}

/** Build the tier-2 interactive language menu (the remaining languages). */
export function buildLanguageMenuTier2(body: string): InteractiveListSpec {
  return {
    body,
    button: 'Languages',
    sections: [
      {
        title: 'More languages',
        rows: TIER2_LANGS.map(row),
      },
    ],
  };
}

/** True when the user tapped/typed the "More languages" control. */
export function isMoreLanguagesRequest(text: string): boolean {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return false;
  return t === 'lang_more' || /more\s+languages?/.test(t);
}
