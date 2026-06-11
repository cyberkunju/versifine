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

/**
 * Morphological recall layer. The closed-set lexicon misses ordinary
 * code-mixed sentences that carry no listed pronoun but ARE unmistakably
 * Indic by their agglutinative endings — "ATM il ninnu 2000 eduthu", "bill
 * adachu 1200". These endings essentially never occur word-finally in
 * English. The set is deliberately PRUNED of collision-prone suffixes that a
 * brutal review caught flipping English to Indic:
 *   - ml `-ille`  (louisville/nashville/grille) — REMOVED
 *   - ml `-thu/-ttu` (shared with Tamil paarthu/saapittu) — REMOVED earlier
 *   - ml `-nnu`   guarded with (?<!pa) so Tamil "seipannu" stays Tamil
 *   - hi `-enge`  (challenge/revenge/scavenge) — REMOVED
 *   - hi standalone "mein"/"wala" (chow mein) — now SUFFIX-only
 *   - ta `-nen`   (linen) — REMOVED; keep longer -pannen/-panren
 * Morphology is allowed to DETECT (so the reply matches this turn) but its
 * hits are NOT tallied into the per-user prior (a single morph false-positive
 * must never poison future turns).
 */
const MORPH_REGEX: Array<{ re: RegExp; lang: Language }> = [
  {
    lang: 'ml',
    re: /\b[a-z]{2,}(?:cchu|chu|kkunnu|ikkunnu|aanu|aano|akki|ichu|undu|ikkanam|kkanam)\b|\b[a-z]{2,}(?<!pa)nnu\b/i,
  },
  {
    lang: 'hi',
    re: /\b[a-z]{2,}(?:unga|oonga|wala|wale|wali)\b/i,
  },
  {
    lang: 'ta',
    re: /\b[a-z]{2,}(?:itten|kiren|pannen|panren|pannitten|pannu|panni)\b/i,
  },
];

/**
 * Distinctive English function/content words. Presence of any signals the user
 * is writing English THIS turn, which vetoes the "fail-toward-the-user" prior
 * so a genuine English message from an otherwise-Indic user still gets English.
 */
const ENGLISH_MARKER_WORDS = [
  'the', 'is', 'are', 'was', 'were', 'will', 'would', 'i', 'you', 'my', 'your',
  'our', 'how', 'what', 'when', 'where', 'why', 'which', 'please', 'thanks',
  'thank', 'ok', 'okay', 'yes', 'no', 'want', 'need', 'show', 'tell', 'balance',
  'spent', 'paid', 'got', 'received', 'for', 'on', 'and', 'with', 'me', 'it',
  'that', 'this', 'today', 'yesterday', 'much', 'total', 'account', 'wallet',
  'budget',
];
const ENGLISH_MARKER_SET = new Set(ENGLISH_MARKER_WORDS);
const ENGLISH_MARKERS = new RegExp(`\\b(?:${ENGLISH_MARKER_WORDS.join('|')})\\b`, 'i');

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface LanguageAnalysis {
  /** Detected language (lexicon/script OR morphology), or null. */
  lang: Language | null;
  /** The detection came from native script OR the closed lexicon (tally-worthy),
   *  NOT morphology alone. A morph-only hit detects-but-doesn't-tally. */
  decisive: boolean;
  /** Any Indic signal at all (native script OR a romanized/morph hit). */
  indicSignal: boolean;
  /** A distinctive English word is present this turn. */
  englishSignal: boolean;
}

/**
 * Core analysis: native script → romanized lexicon + morphology → English
 * signal. Lexicon and morphology are counted separately so the caller knows
 * whether a detection is "decisive" (script/lexicon, safe to remember) or
 * merely morphological (use this turn, but don't poison the prior).
 */
function analyzeLanguage(text: string, sessionLanguage?: Language): LanguageAnalysis {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { lang: null, decisive: false, indicSignal: false, englishSignal: false };

  // 1) Native script wins decisively.
  for (const { range, lang } of SCRIPT_RANGES) {
    if (range.test(trimmed)) {
      const resolved = lang === 'hi' && sessionLanguage === 'mr' ? 'mr' : lang;
      return { lang: resolved, decisive: true, indicSignal: true, englishSignal: false };
    }
  }

  // 2) Romanized lexicon (decisive) + morphology (recall-only).
  const lexCounts = new Map<Language, number>();
  const morphCounts = new Map<Language, number>();
  const bump = (m: Map<Language, number>, lang: Language, n: number) =>
    m.set(lang, (m.get(lang) ?? 0) + n);
  for (const { re, lang } of ROMAN_REGEX) {
    const matches = trimmed.match(new RegExp(re.source, 'gi'));
    if (matches) bump(lexCounts, lang, matches.length);
  }
  for (const { re, lang } of MORPH_REGEX) {
    const matches = trimmed.match(new RegExp(re.source, 'gi'));
    if (matches) bump(morphCounts, lang, matches.length);
  }

  // Combine for detection; track whether the winner had a lexicon hit.
  const combined = new Map<Language, number>();
  for (const [lang, n] of lexCounts) bump(combined, lang, n);
  for (const [lang, n] of morphCounts) bump(combined, lang, n);

  let bestLang: Language | null = null;
  let bestCount = 0;
  for (const [lang, count] of combined) {
    if (count > bestCount) {
      bestCount = count;
      bestLang = lang;
    } else if (count > 0 && count === bestCount && lang === sessionLanguage) {
      bestLang = lang;
    }
  }

  return {
    lang: bestLang,
    decisive: bestLang != null && (lexCounts.get(bestLang) ?? 0) > 0,
    indicSignal: bestCount > 0,
    englishSignal: ENGLISH_MARKERS.test(trimmed),
  };
}

/** True when the message is genuine multi-word prose (≥3 alphabetic tokens that
 *  aren't English markers) — the evidence required before we "fail toward the
 *  user". A bare "uber 250", a number, or a picker/undo token never qualifies,
 *  so those never flip to a non-English reply. */
function hasIndicProse(text: string): boolean {
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 2);
  const nonEnglish = tokens.filter((t) => !ENGLISH_MARKER_SET.has(t));
  return nonEnglish.length >= 3;
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
  return analyzeLanguage(text, sessionLanguage).lang;
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


/** Window of recent decisive detections to keep for the prior. Bounded so a
 *  bilingual user can drift and a stray detection ages out quickly. */
const RECENT_WINDOW = 12;

/**
 * The dominant non-English language the user has written this conversation:
 * the most frequent in the recent window (ties broken by recency), falling
 * back to a non-English session language. Returns null for a genuinely
 * English-first user — so we never invent a non-English reply with no basis.
 */
function dominantPrior(session: Session): Language | null {
  const recent = session.recentLangs ?? [];
  if (recent.length > 0) {
    const counts = new Map<Language, number>();
    for (const l of recent) counts.set(l, (counts.get(l) ?? 0) + 1);
    let best: Language | null = null;
    let bestN = 0;
    // Iterate most-recent-first so a tie resolves to the latest language.
    for (let i = recent.length - 1; i >= 0; i -= 1) {
      const l = recent[i]!;
      const n = counts.get(l)!;
      if (n > bestN) {
        bestN = n;
        best = l;
      }
    }
    if (best) return best;
  }
  return session.language !== 'en' ? session.language : null;
}

/** Record a DECISIVE (script/lexicon) non-English detection in the window. */
function rememberLang(session: Session, lang: Language): void {
  if (lang === 'en') return;
  const recent = session.recentLangs ?? (session.recentLangs = []);
  recent.push(lang);
  if (recent.length > RECENT_WINDOW) recent.splice(0, recent.length - RECENT_WINDOW);
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

  const analysis = analyzeLanguage(body, session.language);

  // Only DECISIVE detections (native script / closed lexicon) build the prior.
  // Morphology can be wrong on an English placename/brand, so it detects this
  // turn but must never poison future turns.
  if (analysis.lang && analysis.lang !== 'en' && analysis.decisive) {
    rememberLang(session, analysis.lang);
  }

  if (analysis.lang && (LANGUAGES as readonly string[]).includes(analysis.lang)) {
    session.turnLanguage = analysis.lang;
    return analysis.lang;
  }

  // FAIL TOWARD THE USER — but only on POSITIVE evidence, never mere absence of
  // English. The turn must be genuine multi-word code-mixed prose (≥3
  // non-English tokens), carry no English marker, and the user must have an
  // established non-English language. This kills the residual cardinal sin for
  // real Manglish/Hinglish prose while NEVER flipping a bare "uber 250", a
  // number, a picker reply, or a clearly-English message to an Indic reply.
  if (!analysis.englishSignal && hasIndicProse(body)) {
    const prior = dominantPrior(session);
    if (prior && prior !== 'en' && (LANGUAGES as readonly string[]).includes(prior)) {
      session.turnLanguage = prior;
      return prior;
    }
  }

  delete session.turnLanguage;
  return session.language;
}
