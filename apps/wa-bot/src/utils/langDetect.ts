/**
 * Per-turn input-language detection.
 *
 * The bot's persistent `session.language` is set during onboarding ("English"
 * picked on first contact) and rarely changes. But Indian + NRI users freely
 * code-switch every message — a user with `session.language='en'` will say
 * "ഇന്ന് എത്ര ചെലവായി?" or "njan oonu kazhicchu" in the same conversation.
 * If we localize the reply only against `session.language`, a Manglish
 * question gets an English answer and the user feels unheard. The empath
 * subagent identified this as the cardinal sin our bot was committing.
 *
 * This module returns the language the USER actually wrote on THIS turn.
 * The engine combines it with `session.language` (turn wins when present and
 * we have a pack for it) to localize the reply.
 *
 * Detection is layered:
 *
 *   1. Native script — Unicode block ranges. A single Devanagari character
 *      means Hindi; a single Malayalam character means Malayalam. Wins
 *      decisively because no romanized form looks like a native script.
 *
 *   2. Romanized indicator words — short closed-set lexicons of stop words /
 *      pronouns / particles / spend nouns that are STRONGLY language-specific
 *      ("njan" = ml only; "kya" = hi only; "naan" = ta only). A single hit
 *      is enough because these words are rarely borrowed across languages.
 *
 *   3. Romanized Indian-English markers — distinctive phrasings ("kya yaar",
 *      "machaan", "kazhveri") that boost the romanized pass when the closed
 *      set was ambiguous.
 *
 * Returns null when nothing matched (use the session default).
 *
 * Pure: no network, no DB, no LLM. Deterministic and offline-testable.
 */
import type { Language } from '@versifine/shared';
import { LANGUAGES } from '@versifine/shared';
import type { Session } from '../types.ts';

/**
 * Native-script Unicode blocks → language. Devanagari is shared by Hindi and
 * Marathi; we default to Hindi (much higher traffic) and rely on the user's
 * onboarding language pick to disambiguate when it actually matters.
 */
const SCRIPT_RANGES: Array<{ range: RegExp; lang: Language }> = [
  // Malayalam — checked first because some Malayalam-only chars are easy to
  // spot and the range is narrow.
  { range: /[\u0D00-\u0D7F]/u, lang: 'ml' },
  { range: /[\u0980-\u09FF]/u, lang: 'bn' }, // Bengali
  { range: /[\u0A80-\u0AFF]/u, lang: 'gu' }, // Gujarati
  { range: /[\u0A00-\u0A7F]/u, lang: 'pa' }, // Gurmukhi (Punjabi)
  { range: /[\u0B00-\u0B7F]/u, lang: 'od' }, // Odia
  { range: /[\u0B80-\u0BFF]/u, lang: 'ta' }, // Tamil
  { range: /[\u0C00-\u0C7F]/u, lang: 'te' }, // Telugu
  { range: /[\u0C80-\u0CFF]/u, lang: 'kn' }, // Kannada
  // Devanagari last — it covers Hindi AND Marathi, so we default to hi and
  // trust the onboarding language to refine if a Marathi user's session is
  // already configured that way (downstream code respects session.language).
  { range: /[\u0900-\u097F]/u, lang: 'hi' },
];

/**
 * Romanized indicator words. These are CLOSED-SET stopwords/pronouns/
 * particles/colloquial markers that are highly language-specific in
 * everyday speech. A single hit is treated as a strong signal — we
 * deliberately skip ambiguous words ("hai" exists in many languages,
 * "no" / "yes" / "ok" obviously English-loans).
 *
 * Word lists are intentionally short. Each word is independently
 * verifiable as language-distinctive. Add words sparingly.
 */
const ROMAN_MARKERS: Array<{ words: string[]; lang: Language }> = [
  {
    lang: 'ml',
    words: [
      // pronouns / particles unique to Manglish — REMOVED short collisions:
      //   'avan'/'aval'/'avar' (3-letter shapes too common in non-text)
      //   'enaku' (Tamil pronoun primarily; Manglish uses 'enikku')
      'njan', 'njaan', 'njanu', 'enikku', 'ente', 'ningal', 'ningalkku',
      'avante', 'avalude',
      // verbs of saying / doing / eating frequent in casual chat
      'paranju', 'paranjittund', 'paranjirunnu', 'paranjathu', 'paranjathum',
      'kazhicchu', 'kazhichu', 'kazhicchittund', 'kazhicchirikkunu',
      'cheythu', 'cheyyunnu', 'cheyyukayanu', 'cheyyam', 'cheyyilla',
      // Manglish copula / aux — REMOVED 'undu' (English: "undo" is similar shape)
      'aanu', 'aano', 'aayirunnu', 'aayirikkum', 'aanenkil',
      'undallo', 'undayirunnu', 'undakkam', 'illee',
      // common spend / food words used in the screenshots
      'oonu', 'chappathi', 'porotta', 'kaapi', 'choru',
      // grammar particles distinctive to Manglish (NOT 'illa' — shared with Tamil)
      'alle', 'venda', 'venam', 'mathi', 'pinne', 'ennitt',
      'kazhveri', 'machaan', 'kashtam', 'sammathicchu',
      // Malayalam-only number words common in voice notes
      'rendu', 'randu', 'onnu', 'moonnu', 'naalu', 'anchu',
      // questions
      'enthayirunnu', 'enthaanu', 'enthane', 'engane', 'evide', 'eppol',
      'chelavakkiyath', 'chelavakku', 'chelavaakki', 'koduthu', 'kaiyude',
      // explicit casual / commands the screenshots used
      // REMOVED 'nokku' / 'kelku' — too short
      'nokkada', 'nokkanam', 'ezhuthi', 'ezhuthiyekkunnath',
      'ariyam', 'ariyilla', 'kelkkanam',
    ],
  },
  {
    lang: 'hi',
    words: [
      // pronouns — REMOVED 'main' (English: main menu/main account),
      // 'tu' (Latin-letter shape), 'tum' (English: tum/tumescent rare),
      // 'aap' (English: app/AAP). Kept compound forms with no collision.
      'mera', 'meri', 'mere', 'mujhe', 'mujhko', 'mujhse',
      'tumhara', 'tumhari', 'tumhare', 'tumhe',
      'aapka', 'aapki', 'aapke', 'aapko',
      // verbs / aux — REMOVED 'kar' (English: Karaoke/Kar surnames),
      // 'tha'/'thi'/'the' (English: "the" article — high collision)
      'kiya', 'karta', 'karti', 'karte', 'karoon', 'karenge',
      'hua', 'hui', 'huye', 'hota', 'hoti', 'hote',
      // grammar particles distinctive vs other Indic
      'nahi', 'nahin', 'nai', 'haan', 'kyu', 'kyun', 'kyon', 'kyunki',
      // Hindi-distinctive (NOT 'paisa', 'kharch' — too shared across Indic)
      'kitna', 'kitne', 'kitni', 'jitna', 'thoda', 'bahut',
      // Hindi-distinctive time markers — REMOVED 'phir'/'fir' (Latin
      // collision: "fir" is "first" abbrev in chat; "Phir" name)
      'aaj', 'parso', 'abhi',
      // colloquial fillers
      'yaar', 'bhai', 'didi', 'bhabhi', 'beta',
      // Hindi number words — REMOVED 'ek' (English: EK initials), 'do'
      // (English verb), 'char' (English: char/character). Kept distinctive.
      'teen', 'paanch', 'panch',
      // common questions
      'kya', 'kaise', 'kab', 'kahan', 'kaun', 'kaisa', 'kaisi',
    ],
  },
  {
    lang: 'ta',
    words: [
      // pronouns — REMOVED 'naan' (English: bread/naan), 'naa', 'nan',
      // 'en', 'nee'/'ungal' (3-letter; 'en' is English preposition)
      'enaku', 'enakku', 'ennoda',
      'neenga', 'ungalukku',
      // questions / verbs — REMOVED 'enkay'/'enge' (3-letter; 'eppa' kept)
      'enna', 'epdi', 'eppadi', 'eppa', 'ennikku',
      'pannen', 'panren', 'pannitten', 'pannittu',
      // common — REMOVED 'po' (Latin filler), 'da' (English: da Vinci),
      // 'macha'/'machan' (overlap), 'vaa'/'vaadhi' (English vowel chars)
      'sapittu', 'sapidu', 'saapittu', 'sapdittu', 'romba', 'rombo',
      'venum', 'vendam', 'vandhu', 'seri',
      'aiyo', 'aiyyo',
      // Tanglish numbers — REMOVED 'rendu' (Manglish overlap), 'nalu'
      // (3-letter; English-shape collision)
      'ondru', 'moonu', 'anju',
    ],
  },
];

/** Build a single boundary-anchored regex per language for fast scanning. */
const ROMAN_REGEX: Array<{ re: RegExp; lang: Language }> = ROMAN_MARKERS.map(
  ({ words, lang }) => ({
    re: new RegExp(`\\b(?:${words.map(escapeRegex).join('|')})\\b`, 'i'),
    lang,
  }),
);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect the language the user wrote in for the current turn. Returns null
 * when the message has no script + no romanized markers (so the engine
 * falls back to `session.language`).
 *
 * `sessionLanguage` is the user's persistent language pick. We use it for
 * two tie-breakers:
 *   • Devanagari script defaults to `hi` BUT if `sessionLanguage='mr'` we
 *     return `mr` instead (Hindi and Marathi share Devanagari; the user's
 *     onboarding pick is the deciding context).
 *   • When two romanized lists tie on hit count, prefer the language matching
 *     `sessionLanguage` over the iteration order. Otherwise it's
 *     deterministic on insertion order, which is brittle.
 *
 * The detector is INTENTIONALLY conservative. We'd rather return null and
 * fall back to the session default than guess wrong on a 1–2 word message.
 */
export function detectInputLanguage(
  text: string,
  sessionLanguage?: Language,
): Language | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1) Native script wins.
  for (const { range, lang } of SCRIPT_RANGES) {
    if (range.test(trimmed)) {
      // Devanagari is shared by Hindi and Marathi; honour the user's
      // onboarding pick when it disambiguates.
      if (lang === 'hi' && sessionLanguage === 'mr') return 'mr';
      return lang;
    }
  }

  // 2) Romanized markers. Count hits per language and take the winner;
  //    on a tie, prefer the user's session language so we never flip a
  //    persistent setting based on a single ambiguous code-mix word.
  const counts = new Map<Language, number>();
  for (const { re, lang } of ROMAN_REGEX) {
    const reGlobal = new RegExp(re.source, 'gi');
    const matches = trimmed.match(reGlobal);
    counts.set(lang, matches?.length ?? 0);
  }
  let bestLang: Language | null = null;
  let bestCount = 0;
  for (const [lang, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestLang = lang;
    } else if (count > 0 && count === bestCount && lang === sessionLanguage) {
      // Tie at >0: prefer the session's language.
      bestLang = lang;
    }
  }
  return bestLang;
}


/**
 * The per-turn effective language for rendering replies.
 *
 * Prefers an explicit per-turn detection (set by the engine at dispatch
 * entry) over the persistent session language. The engine clears the turn
 * field at the end of each turn so a stale detection can't bleed forward.
 */
export function effectiveLanguage(session: {
  language: Language;
  turnLanguage?: Language;
}): Language {
  return session.turnLanguage ?? session.language;
}

/** Clear the per-turn language at end of turn. Called by the engine. */
export function clearTurnLanguage(session: Session): void {
  delete session.turnLanguage;
}


/**
 * Detect + commit the per-turn language onto the session. Called at engine
 * entry. Skipped when the session is mid-onboarding — those states use raw
 * text matching and shouldn't have their language flipped by an in-progress
 * reply.
 */
export function commitTurnLanguage(session: Session, body: string): Language {
  if (
    session.state === 'GREETING' ||
    session.state === 'AWAITING_LANGUAGE' ||
    session.state === 'AWAITING_EMAIL' ||
    session.state === 'AWAITING_LINK_CODE'
  ) {
    delete session.turnLanguage;
    return session.language;
  }
  const detected = detectInputLanguage(body, session.language);
  if (detected && (LANGUAGES as readonly string[]).includes(detected)) {
    session.turnLanguage = detected;
    return detected;
  }
  delete session.turnLanguage;
  return session.language;
}
