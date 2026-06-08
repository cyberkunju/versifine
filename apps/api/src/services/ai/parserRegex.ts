/**
 * Deterministic extractors that beat the LLM on numbers and dates.
 *
 * The LLM does the hard semantic work — figuring out what the
 * description is, what category to hint, whether it's a split bill —
 * but a regex is more reliable for "did the user say 450" or "did they
 * say USD". When both produce a value, regex wins. The LLM still gets
 * a chance: it sees the full text, so its other fields stay
 * unaffected.
 */
import { CURRENCY_ALIASES, type Currency } from '@versifine/shared';

export interface AmountExtraction {
  /** Positive amount or null. */
  amount: number | null;
  /** Currency code if directly attached to the amount, else null. */
  currency: Currency | null;
}

const CURRENCY_KEYS = Object.keys(CURRENCY_ALIASES);
// Sort longest first so "rs." matches before "rs" and "₹" matches before "rupee".
CURRENCY_KEYS.sort((a, b) => b.length - a.length);

function escapeForRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CURRENCY_PATTERN = CURRENCY_KEYS.map(escapeForRegex).join('|');

/**
 * Scale-multiplier words that may trail a digit amount ("18k", "1.5 lakh",
 * "22 hazaar", "80 हज़ार", "60 ಸಾವಿರ", "10 vela"). Includes English, romanised
 * Indic, and native-script words across all 11 supported languages. Ordered
 * with the longer variants first so the alternation doesn't stop on a prefix,
 * and every use is paired with a `(?![a-z])` lookahead so a bare "k" never
 * devours the first letter of the NEXT word ("180 kharch" must stay 180).
 * Native scripts are unaffected by the `[a-z]` lookahead.
 */
const THOUSAND_WORDS = [
  'k', 'thousands', 'thousand', 'hazaar', 'hazar', 'hajaar', 'hajar',
  'aayiram', 'ayiram', 'saavira', 'savira', 'sahasra', 'vela',
  'हज़ार', 'हजार', 'হাজার', 'ਹਜ਼ਾਰ', 'હજાર', 'ஆயிரம்', 'వేల', 'వెల', 'ಸಾವಿರ', 'ഹജാർ', 'ହଜାର',
];
const LAKH_WORDS = [
  'lakhs', 'lakh', 'lac', 'laksh', 'laksham',
  'लाख', 'ਲੱਖ', 'લાખ', 'ಲಕ್ಷ', 'లక్ష', 'லட்சம்', 'ലക്ഷം', 'ଲକ୍ଷ',
];
const CRORE_WORDS = [
  'crores', 'crore', 'koti', 'kodi',
  'करोड़', 'करोड', 'कोटि', 'ਕਰੋੜ', 'કરોડ', 'ಕೋಟಿ', 'కోటి', 'கோடி', 'കോടി', 'କୋଟି',
];
const THOUSAND_SET = new Set(THOUSAND_WORDS.map((w) => w.trim().toLowerCase()));
const LAKH_SET = new Set(LAKH_WORDS.map((w) => w.trim().toLowerCase()));
const CRORE_SET = new Set(CRORE_WORDS.map((w) => w.trim().toLowerCase()));
const SCALE_SUFFIX = [...THOUSAND_WORDS, ...LAKH_WORDS, ...CRORE_WORDS]
  .map((w) => w.trim())
  .sort((a, b) => b.length - a.length)
  .map(escapeForRegex)
  .join('|');

const SPLIT_RE =
  /\b(?:split(?:\s+(?:with|among))?|divide(?:d)?\s+(?:by|with|among)|share(?:d)?\s+(?:with|among))\s+(\d{1,2})\b/i;
const SPLIT_PEOPLE_RE =
  /\b(?:with|among|between)?\s*(\d{1,2})\s*(?:people|persons?|friends?|of\s+us)\b/i;

/** Words that mark the number AFTER them as the price/amount, not a quantity. */
const PRICE_MARKER =
  /\b(?:for|cost|costs|costing|worth|price|priced|paid|pay|payment|of|@|=|total|bill|amount|spent|spend)\s*$/i;
/** Words/units that mark the number BEFORE them as a quantity, not a price. */
const QUANTITY_UNIT =
  /^\s*(?:x|nos?|pcs?|pieces?|plates?|cups?|glasses?|kg|kgs?|g|grams?|litres?|liters?|l|ml|people|persons?|friends?|times?|months?|years?|days?|weeks?|hours?|hrs?|%|percent)\b/i;

/**
 * Temporal prepositions that, when sitting IMMEDIATELY before a bare 4-digit
 * number, mark it as a YEAR rather than a spend. Anchored with `$` so only the
 * word directly preceding the number is considered ("...from 1850" hits,
 * "from the shop 1850" does not).
 */
const TEMPORAL_PREFIX = /(?:^|[^\p{L}])(?:in|from|by|during|since|year|yr)\s+$/iu;

/**
 * A bare number that is really a calendar/sci-fi YEAR, not an amount. Fires
 * ONLY when ALL hold:
 *   - the token is exactly 4 digits (no comma, no decimal, no scale suffix)
 *   - the value lands in a year band: [1800..2099] (history→near future) or
 *     [3000..3099] (sci-fi, e.g. "in 3024 I will buy a spaceship")
 *   - it is NOT introduced by a price marker ("spent 1850", "for 2020" stay
 *     amounts) — currency-attached forms never reach here, they are matched by
 *     the leading/trailing currency passes in extractAmount
 *   - it IS introduced by a temporal preposition (in/from/by/during/since/year)
 * This is deliberately conservative: "1850" or "₹2020" or "spent 1900" all
 * remain real amounts; only "expense from 1850"-style phrasing is rejected.
 */
function looksLikeYear(
  value: number,
  rawToken: string,
  suffix: string | null,
  before: string,
): boolean {
  if (suffix) return false;
  if (!/^\d{4}$/.test(rawToken)) return false;
  const inBand = (value >= 1800 && value <= 2099) || (value >= 3000 && value <= 3099);
  if (!inBand) return false;
  if (PRICE_MARKER.test(before)) return false;
  return TEMPORAL_PREFIX.test(before);
}

/**
 * Pull an amount out of a sentence. Recognises a leading currency
 * symbol/word, a trailing currency symbol/word, and bare numbers like
 * "450" or "3,200" or "1.5k".
 *
 * When the text has MULTIPLE bare numbers (e.g. "2 coffee for 560",
 * "3 idli 50", "मാല ചായ രണ്ട് വട 140") the first number is usually a
 * quantity and the price comes later. We score every candidate and pick
 * the most price-like one rather than blindly taking the first — that bug
 * logged "₹2" for "I had 2 coffee for 560".
 */
/**
 * Fix common "letter-for-digit" typos inside numeric tokens before amount
 * extraction: "5oo" → "500", "1o0" → "100", "2l" → "21". We only rewrite a
 * token that STARTS with a real digit and whose every non-digit character is
 * a fixable look-alike letter (o/O→0, l/I→1, s/S→5, b/B→8). So real words
 * like "auto", "lunch", "so", "is" are never touched — they don't start with
 * a digit — while "5oo on grocries" becomes "500 on grocries".
 */
const DIGIT_TYPO_TOKEN = /\b[0-9][0-9oOlIsSbB]*[oOlIsSbB][0-9oOlIsSbB]*\b/g;
function normalizeDigitTypos(text: string): string {
  return text.replace(DIGIT_TYPO_TOKEN, (token) =>
    token.replace(/[oO]/g, '0').replace(/[lI]/g, '1').replace(/[sS]/g, '5').replace(/[bB]/g, '8'),
  );
}

/**
 * Map Indic-script digits (Devanagari ०-९, Bengali ০-৯, Gurmukhi, Gujarati,
 * Odia, Tamil, Telugu, Kannada, Malayalam) to ASCII 0-9 so the amount regexes
 * see "৫০"/"૫૦"/"੫੦" as "50". Each script's digit block is contiguous and
 * starts at codepoint + 6 (…66) within the block, so the digit value is just
 * the offset from that base. Latin digits and all other characters pass
 * through untouched.
 */
const INDIC_DIGIT_BASES = [
  0x0966, // Devanagari (Hindi/Marathi)
  0x09e6, // Bengali
  0x0a66, // Gurmukhi (Punjabi)
  0x0ae6, // Gujarati
  0x0b66, // Odia
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
];
function normalizeIndicDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    let mapped = ch;
    for (const base of INDIC_DIGIT_BASES) {
      if (cp >= base && cp <= base + 9) {
        mapped = String(cp - base);
        break;
      }
    }
    out += mapped;
  }
  return out;
}

/**
 * Indian shorthand "1.5L" / "2L" / "50L" means lakh. Rewrite a number glued to
 * an uppercase "L" (no space, end of token) into "<n> lakh" so the scale-word
 * machinery handles it. Deliberately uppercase-and-glued only, so "litres",
 * "2 l of milk", and lowercase "l" are never swept in.
 */
function normalizeLakhLetter(text: string): string {
  return text.replace(/\b(\d+(?:\.\d+)?)L\b/g, '$1 lakh');
}

/**
 * Blank out digit runs that are NOT spendable amounts before extraction:
 * URLs, email addresses, and long (11+ digit) sequences that are phone
 * numbers, card numbers, account/order/invoice IDs. A real rupee amount is
 * never 11+ digits, so this can't eat a legitimate spend — but it stops the
 * bot mining "₹43,210" from a phone number or "₹99,999" from a card. Indian
 * comma amounts ("1,00,000") survive because the comma breaks the run.
 */
function stripNumericNoise(text: string): string {
  let s = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ');
  s = s.replace(/[+(]?\d[\d\s().-]{9,}\d/g, (run) =>
    run.replace(/\D/g, '').length >= 11 ? ' ' : run,
  );
  return s;
}

export function extractAmount(text: string): AmountExtraction {
  if (!text) return { amount: null, currency: null };
  const cleaned = stripNumericNoise(
    normalizeLakhLetter(normalizeDigitTypos(normalizeIndicDigits(text.replace(/[\u00a0]/g, ' ')))),
  );

  // 1) Currency followed by amount: "₹450", "Rs 450", "USD 50", "$50".
  const leading = new RegExp(
    `(?:^|[^A-Za-z])(${CURRENCY_PATTERN})\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${SCALE_SUFFIX})?(?![a-z])`,
    'i',
  );
  const lead = leading.exec(cleaned);
  if (lead) {
    const amt = parseAmount(lead[2]!, lead[3] ?? null);
    if (amt !== null) {
      return { amount: amt, currency: normalizeCurrencyToken(lead[1]!) };
    }
  }

  // 2) Amount followed by currency: "450 rs", "50 dollars", "140 രൂപ".
  const trailing = new RegExp(
    `(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${SCALE_SUFFIX})?(?![a-z])\\s*(${CURRENCY_PATTERN})\\b`,
    'i',
  );
  const trail = trailing.exec(cleaned);
  if (trail) {
    const amt = parseAmount(trail[1]!, trail[2] ?? null);
    if (amt !== null) {
      return { amount: amt, currency: normalizeCurrencyToken(trail[3]!) };
    }
  }

  // 3) No currency attached — score every bare number and pick the price.
  const amt = pickBareAmount(cleaned);
  if (amt !== null) return { amount: amt, currency: null };

  // 4) No digits anywhere — fall back to spelled-out / worded numbers in
  //    English and the supported Indian languages ("നൂറ് രൂപ" → 100,
  //    "five hundred" → 500, "दो सौ" → 200). Digits always win, so this
  //    only runs when steps 1–3 found nothing. This is the fix for the
  //    voice-note bug where "ചായ കുടിച്ചു നൂറ് രൂപായ്" stalled the bot.
  const worded = pickWordedAmount(cleaned);
  if (worded) return { amount: worded.value, currency: worded.currency };

  return { amount: null, currency: null };
}

interface BareCandidate {
  value: number;
  index: number;
  afterPriceMarker: boolean;
  beforeQuantityUnit: boolean;
  isYear: boolean;
  /** 4-digit, in a year band, no price marker, no scale — a YEAR if a sibling
   *  year is confirmed (handles ranges: "from 1999 to 2024" → both years). */
  yearBandEligible: boolean;
}

/**
 * Choose the most price-like bare number from a sentence with one or more
 * figures. Scoring, highest wins:
 *   +5  preceded by a price marker ("for 560", "total 560", "@ 560")
 *   -4  followed by a quantity unit ("2 kg", "3 plates", "4 people")
 *   +1  it is the single largest figure (price usually ≫ quantity)
 * Ties break toward the later number (price tends to come after the item).
 */
function pickBareAmount(text: string): number | null {
  const re = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${SCALE_SUFFIX})?(?![a-z])`, 'gi');
  const candidates: BareCandidate[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = parseAmount(m[1]!, m[2] ?? null);
    if (value === null) continue;
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    // Skip a digit run that is glued to other alphanumerics with no separator
    // — it is a fragment of a longer word or an encoded blob (hex/base64/id),
    // not a spoken amount. NOTE: the `(?![a-z])` lookahead in `re` can force a
    // match to END before a following DIGIT (e.g. "69676" → "6967" then "6"),
    // so we must reject an adjacent digit too, not just a letter. Real amounts
    // are written with a separator ("spent 500", "₹500", "500rs" — the
    // currency-attached forms are handled earlier in extractAmount).
    if (/[A-Za-z0-9]$/.test(before) || /^[A-Za-z0-9]/.test(after)) continue;
    const isYear = looksLikeYear(value, m[1]!, m[2] ?? null, before);
    candidates.push({
      value,
      index: m.index,
      afterPriceMarker: PRICE_MARKER.test(before),
      beforeQuantityUnit: QUANTITY_UNIT.test(after),
      isYear,
      yearBandEligible:
        !m[2] &&
        /^\d{4}$/.test(m[1]!) &&
        ((value >= 1800 && value <= 2099) || (value >= 3000 && value <= 3099)) &&
        !PRICE_MARKER.test(before),
    });
  }
  if (candidates.length === 0) return null;
  // Range handling: once ANY figure is a confirmed year ("from 1999 …"), every
  // other bare year-band figure with no price marker is also a year — so
  // "from 1999 to 2024" drops BOTH, not just the one after "from".
  if (candidates.some((c) => c.isYear)) {
    for (const c of candidates) {
      if (c.yearBandEligible) c.isYear = true;
    }
  }
  // Drop bare years ("from 1850", "in 3024 …"). If EVERY figure was a year,
  // there is no spend to mine — return null rather than logging the year.
  const real = candidates.filter((c) => !c.isYear);
  if (real.length === 0) return null;
  if (real.length === 1) {
    // A lone number that is immediately a QUANTITY ("3 days", "2 years",
    // "5 people") and is NOT introduced by a price marker is a count, not a
    // spend — don't mine it. This stops "headache for 3 days" → ₹3.
    const only = real[0]!;
    if (only.beforeQuantityUnit && !only.afterPriceMarker) return null;
    return only.value;
  }

  const maxValue = Math.max(...real.map((c) => c.value));
  let best: BareCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const c of real) {
    let score = 0;
    if (c.afterPriceMarker) score += 5;
    if (c.beforeQuantityUnit) score -= 4;
    if (c.value === maxValue) score += 1;
    // Later position is a mild tiebreaker (price follows the item).
    score += c.index / (text.length + 1);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ? best.value : null;
}

function parseAmount(numberToken: string, suffix: string | null): number | null {
  const stripped = numberToken.replace(/,/g, '');
  const base = Number(stripped);
  if (!Number.isFinite(base) || base <= 0) return null;
  let multiplier = 1;
  if (suffix) {
    const s = suffix.trim().toLowerCase();
    if (THOUSAND_SET.has(s)) multiplier = 1_000;
    else if (LAKH_SET.has(s)) multiplier = 100_000;
    else if (CRORE_SET.has(s)) multiplier = 10_000_000;
  }
  return Math.round(base * multiplier * 100) / 100;
}

function normalizeCurrencyToken(token: string): Currency | null {
  const lookup = token.trim().toLowerCase();
  return CURRENCY_ALIASES[lookup] ?? null;
}

/* -----------------------------------------------------------------------
 * Worded / spelled-out numbers.
 *
 * Voice notes often carry the amount as a WORD rather than a digit:
 *   "ചായ കുടിച്ചു നൂറ് രൂപായ്"  (Malayalam: drank tea, hundred rupees) → 100
 *   "five hundred for groceries"                                      → 500
 *   "दो सौ का सामान"            (Hindi: two hundred worth of goods)    → 200
 *
 * This is a deterministic fallback that ONLY runs after the digit-based
 * extractors (steps 1–3 in extractAmount) come up empty, so a literal
 * digit always wins over a spelled-out one.
 *
 * Coverage is the common/round numbers and small integers in English plus
 * the six supported languages (English, Hindi, Malayalam, Tamil, Telugu,
 * Kannada): the units 0–20, the round tens (20,30,…,90) and the scale
 * words hundred / thousand / lakh / crore. That is enough to compose the
 * everyday amounts people speak — "two hundred", "fifteen hundred",
 * "five thousand", "one lakh", "twenty five", "നൂറ്", "रണ്ടായിരം"-style
 * round figures — without trying to enumerate every integer.
 */
interface WordedToken {
  value: number;
  /** A scale multiplier (hundred/thousand/lakh/crore) vs an additive unit. */
  scale: boolean;
  /**
   * Indian fractional number-word modifier. Two flavours:
   *   - `whole`  : a COMPLETE multiplier that ignores any following count.
   *                "dhai"/"ढाई" = 2.5, "dedh"/"डेढ़" = 1.5.
   *   - `offset` : a +/- applied to the FOLLOWING count (default count 1).
   *                "sava"/"सवा" = +0.25  → sava lakh = 1.25 lakh
   *                "sadhe"/"साढ़े" = +0.5 → sadhe teen sau = 3.5 × 100 = 350
   *                "pauna"/"पौने" = -0.25 → pauna be lakh = (2−0.25) lakh = 1.75 lakh
   */
  frac?: { whole?: number; offset?: number };
  /**
   * "Weak" units are romanised Indic transliterations (do=2, teen=3, char=4…)
   * that collide with everyday English ("do", "char", "teen"). They only count
   * inside a run that ALSO carries a scale or fraction word — a run made of
   * weak units alone is discarded so "what to do today" never logs ₹2. Native
   * scripts and English number words stay strong.
   */
  weak?: boolean;
}

/** Additive units (value < 100), keyed by lower-cased word in every language. */
const WORDED_UNITS: Record<string, number> = {
  // --- English ---------------------------------------------------------
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  // --- Hindi (Devanagari) ---------------------------------------------
  शून्य: 0,
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पाँच: 5,
  पांच: 5,
  छह: 6,
  छः: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  बीस: 20,
  तीस: 30,
  चालीस: 40,
  पचास: 50,
  साठ: 60,
  सत्तर: 70,
  अस्सी: 80,
  नब्बे: 90,
  // --- Malayalam -------------------------------------------------------
  പൂജ്യം: 0,
  ഒന്ന്: 1,
  രണ്ട്: 2,
  മൂന്ന്: 3,
  നാല്: 4,
  അഞ്ച്: 5,
  ആറ്: 6,
  ഏഴ്: 7,
  എട്ട്: 8,
  ഒമ്പത്: 9,
  ഒൻപത്: 9,
  പത്ത്: 10,
  ഇരുപത്: 20,
  മുപ്പത്: 30,
  നാല്പത്: 40,
  നാൽപത്: 40,
  അമ്പത്: 50,
  അറുപത്: 60,
  എഴുപത്: 70,
  എൺപത്: 80,
  എണ്പത്: 80,
  തൊണ്ണൂറ്: 90,
  // --- Tamil -----------------------------------------------------------
  பூஜ்ஜியம்: 0,
  ஒன்று: 1,
  இரண்டு: 2,
  மூன்று: 3,
  நான்கு: 4,
  ஐந்து: 5,
  ஆறு: 6,
  ஏழு: 7,
  எட்டு: 8,
  ஒன்பது: 9,
  பத்து: 10,
  இருபது: 20,
  முப்பது: 30,
  நாற்பது: 40,
  ஐம்பது: 50,
  அறுபது: 60,
  எழுபது: 70,
  எண்பது: 80,
  தொண்ணூறு: 90,
  // --- Telugu ----------------------------------------------------------
  సున్నా: 0,
  ఒకటి: 1,
  రెండు: 2,
  మూడు: 3,
  నాలుగు: 4,
  ఐదు: 5,
  ఆరు: 6,
  ఏడు: 7,
  ఎనిమిది: 8,
  తొమ్మిది: 9,
  పది: 10,
  ఇరవై: 20,
  ముప్పై: 30,
  నలభై: 40,
  యాభై: 50,
  అరవై: 60,
  డెబ్బై: 70,
  ఎనభై: 80,
  తొంభై: 90,
  // --- Kannada ---------------------------------------------------------
  ಸೊನ್ನೆ: 0,
  ಒಂದು: 1,
  ಎರಡು: 2,
  ಮೂರು: 3,
  ನಾಲ್ಕು: 4,
  ಐದು: 5,
  ಆರು: 6,
  ಏಳು: 7,
  ಎಂಟು: 8,
  ಒಂಬತ್ತು: 9,
  ಹತ್ತು: 10,
  ಇಪ್ಪತ್ತು: 20,
  ಮೂವತ್ತು: 30,
  ನಲವತ್ತು: 40,
  ಐವತ್ತು: 50,
  ಅರವತ್ತು: 60,
  ಎಪ್ಪತ್ತು: 70,
  ಎಂಬತ್ತು: 80,
  ತೊಂಬತ್ತು: 90,
  // --- Marathi (Devanagari; shares Hindi digits, distinct "two"/"hundred") ---
  दोन: 2,
  बे: 2,
  // --- Bengali ---------------------------------------------------------
  শূন্য: 0,
  এক: 1,
  দুই: 2,
  তিন: 3,
  চার: 4,
  পাঁচ: 5,
  ছয়: 6,
  সাত: 7,
  আট: 8,
  নয়: 9,
  দশ: 10,
  বিশ: 20,
  ত্রিশ: 30,
  পঞ্চাশ: 50,
  // --- Gujarati --------------------------------------------------------
  એક: 1,
  બે: 2,
  ત્રણ: 3,
  ચાર: 4,
  પાંચ: 5,
  દસ: 10,
  વીસ: 20,
  પચાસ: 50,
  // --- Punjabi (Gurmukhi) ---------------------------------------------
  ਇੱਕ: 1,
  ਦੋ: 2,
  ਤਿੰਨ: 3,
  ਚਾਰ: 4,
  ਪੰਜ: 5,
  ਦਸ: 10,
  ਵੀਹ: 20,
  ਪੰਜਾਹ: 50,
  // --- Odia ------------------------------------------------------------
  ଏକ: 1,
  ଦୁଇ: 2,
  ତିନି: 3,
  ଚାରି: 4,
  ପାଞ୍ଚ: 5,
  ଦଶ: 10,
  କୋଡ଼ିଏ: 20,
  ପଚାଶ: 50,
};

/** Scale multipliers, keyed by lower-cased word in every language. */
const WORDED_SCALES: Record<string, number> = {
  // --- English ---------------------------------------------------------
  hundred: 100,
  thousand: 1_000,
  lakh: 100_000,
  lac: 100_000,
  lakhs: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
  million: 1_000_000,
  billion: 1_000_000_000,
  // --- Hindi -----------------------------------------------------------
  सौ: 100,
  हज़ार: 1_000,
  हजार: 1_000,
  लाख: 100_000,
  करोड़: 10_000_000,
  करोड: 10_000_000,
  // --- Malayalam -------------------------------------------------------
  നൂറ്: 100,
  നൂറു: 100,
  ആയിരം: 1_000,
  ലക്ഷം: 100_000,
  കോടി: 10_000_000,
  // --- Tamil -----------------------------------------------------------
  நூறு: 100,
  ஆயிரம்: 1_000,
  இலட்சம்: 100_000,
  லட்சம்: 100_000,
  கோடி: 10_000_000,
  // --- Telugu ----------------------------------------------------------
  వంద: 100,
  వెయ్యి: 1_000,
  వేయి: 1_000,
  లక్ష: 100_000,
  కోటి: 10_000_000,
  // --- Kannada ---------------------------------------------------------
  ನೂರು: 100,
  ಸಾವಿರ: 1_000,
  ಲಕ್ಷ: 100_000,
  ಕೋಟಿ: 10_000_000,
  // --- Romanised scales (all langs; needed for worded fractions like
  //     "dedh hazaar", "sadhe teen sau"). "so" is intentionally OMITTED —
  //     it collides with the English word "so"; only "sau"/"sao" map to 100. ---
  sau: 100,
  sao: 100,
  hazaar: 1_000,
  hazar: 1_000,
  hajaar: 1_000,
  hajar: 1_000,
  saavira: 1_000,
  savira: 1_000,
  aayiram: 1_000,
  ayiram: 1_000,
  laksh: 100_000,
  laksham: 100_000,
  koti: 10_000_000,
  kodi: 10_000_000,
  // --- Bengali ---------------------------------------------------------
  শো: 100,
  একশো: 100,
  হাজার: 1_000,
  লাখ: 100_000,
  লক্ষ: 100_000,
  কোটি: 10_000_000,
  // --- Marathi ---------------------------------------------------------
  शंभर: 100,
  // --- Gujarati --------------------------------------------------------
  સો: 100,
  હજાર: 1_000,
  લાખ: 100_000,
  કરોડ: 10_000_000,
  // --- Punjabi ---------------------------------------------------------
  ਸੌ: 100,
  ਹਜ਼ਾਰ: 1_000,
  ਲੱਖ: 100_000,
  ਕਰੋੜ: 10_000_000,
  // --- Odia ------------------------------------------------------------
  ଶହ: 100,
  ଶହେ: 100,
  ହଜାର: 1_000,
  ଲକ୍ଷ: 100_000,
  କୋଟି: 10_000_000,
};

/**
 * Fractional/compound Indian number words. They sit IN FRONT of a count and/or
 * a scale word and bend the value by a quarter or a half:
 *   "ढाई सौ"        = 2.5 × 100      = 250
 *   "सवा लाख"       = 1.25 × 100000  = 125000
 *   "पौने बे लाख"   = (2−0.25) lakh  = 175000
 *   "dedh hazaar"   = 1.5 × 1000     = 1500
 *   "sadhe teen sau"= (3+0.5) × 100  = 350
 * `whole` is a complete multiplier (ignores a following count); `offset` is a
 * +/- applied to the following count (which defaults to 1 when none follows).
 * Romanised forms are safe (none are English words); "be"/"so" are left out of
 * the romanised set on purpose — only their native forms (बे/બે/সো…) are mapped.
 */
const WORDED_FRACTIONS: Record<string, { whole?: number; offset?: number }> = {
  // ── 2.5  "two and a half" ──────────────────────────────────────────
  dhai: { whole: 2.5 },
  dhaai: { whole: 2.5 },
  adhai: { whole: 2.5 },
  adhaai: { whole: 2.5 },
  ढाई: { whole: 2.5 },
  अढाई: { whole: 2.5 },
  ढ़ाई: { whole: 2.5 },
  adich: { whole: 2.5 }, // Marathi अडीच
  adhich: { whole: 2.5 },
  अडीच: { whole: 2.5 },
  adhi: { whole: 2.5 }, // Gujarati અઢી
  અઢી: { whole: 2.5 },
  araai: { whole: 2.5 }, // Bengali আড়াই
  আড়াই: { whole: 2.5 },
  ਢਾਈ: { whole: 2.5 }, // Punjabi
  ଅଢେଇ: { whole: 2.5 }, // Odia
  // ── 1.5  "one and a half" ──────────────────────────────────────────
  dedh: { whole: 1.5 },
  ded: { whole: 1.5 },
  derh: { whole: 1.5 },
  देढ़: { whole: 1.5 },
  डेढ़: { whole: 1.5 },
  डेढ: { whole: 1.5 },
  deed: { whole: 1.5 }, // Marathi दीड
  दीड: { whole: 1.5 },
  dodh: { whole: 1.5 }, // Gujarati દોઢ
  દોઢ: { whole: 1.5 },
  der: { whole: 1.5 }, // Bengali দেড়
  দেড়: { whole: 1.5 },
  ਡੇਢ: { whole: 1.5 }, // Punjabi
  ଦେଢ଼: { whole: 1.5 }, // Odia
  // ── +0.25  "sava" (a quarter past) ─────────────────────────────────
  sava: { offset: 0.25 },
  sawa: { offset: 0.25 },
  savaa: { offset: 0.25 },
  savva: { offset: 0.25 }, // Marathi सव्वा
  सवा: { offset: 0.25 },
  सव्वा: { offset: 0.25 },
  સવા: { offset: 0.25 },
  soya: { offset: 0.25 }, // Bengali সোয়া
  সোয়া: { offset: 0.25 },
  ਸਵਾ: { offset: 0.25 }, // Punjabi
  ସୱା: { offset: 0.25 }, // Odia
  // ── +0.5  "sadhe" (and a half) ─────────────────────────────────────
  sadhe: { offset: 0.5 },
  saadhe: { offset: 0.5 },
  sade: { offset: 0.5 },
  साढ़े: { offset: 0.5 },
  साढे: { offset: 0.5 },
  साडे: { offset: 0.5 }, // Marathi साडे
  sada: { offset: 0.5 }, // Gujarati સાડા
  સાડા: { offset: 0.5 },
  sare: { offset: 0.5 }, // Bengali সাড়ে
  সাড়ে: { offset: 0.5 },
  ਸਾਢੇ: { offset: 0.5 }, // Punjabi
  ସାଢେ: { offset: 0.5 }, // Odia
  // ── −0.25  "pauna" (a quarter to) ──────────────────────────────────
  pauna: { offset: -0.25 },
  paune: { offset: -0.25 },
  pona: { offset: -0.25 },
  poona: { offset: -0.25 },
  paun: { offset: -0.25 }, // Marathi पाऊण
  पौना: { offset: -0.25 },
  पौने: { offset: -0.25 },
  पोणा: { offset: -0.25 },
  पाऊण: { offset: -0.25 },
  પોણા: { offset: -0.25 },
  poune: { offset: -0.25 }, // Bengali পৌনে
  পৌনে: { offset: -0.25 },
  ਪੌਣਾ: { offset: -0.25 }, // Punjabi
  ପୌଣା: { offset: -0.25 }, // Odia
};

/** Connector words that join number words without breaking a run or adding value. */
const WORDED_CONNECTORS = new Set(['and']);

/**
 * Romanised Indic unit words (do=2, teen=3, char=4 …). They collide with
 * English, so they are registered as WEAK: a worded run consisting only of
 * weak units is dropped; they only contribute when bound to a scale/fraction
 * ("sava do lakh", "sadhe teen sau", "paanch sau"). Native-script equivalents
 * live in WORDED_UNITS and are strong.
 */
const WORDED_WEAK_UNITS: Record<string, number> = {
  ek: 1,
  do: 2,
  be: 2, // gu/mr "two"
  bey: 2,
  teen: 3,
  char: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  chha: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  // romanised round tens used with hundred/scale ("pachas hazaar" = 50000)
  bees: 20,
  tees: 30,
  chalis: 40,
  pachas: 50,
  saath: 60,
};

const WORDED_LOOKUP: Map<string, WordedToken> = (() => {
  const map = new Map<string, WordedToken>();
  for (const [word, value] of Object.entries(WORDED_UNITS)) {
    map.set(word, { value, scale: false });
  }
  for (const [word, value] of Object.entries(WORDED_SCALES)) {
    // Scale words take precedence if a key ever collides with a unit.
    map.set(word, { value, scale: true });
  }
  for (const [word, frac] of Object.entries(WORDED_FRACTIONS)) {
    // Fraction modifiers carry no standalone additive/scale value; the
    // composer reads `frac` and applies it to the following count/scale.
    map.set(word, { value: 0, scale: false, frac });
  }
  for (const [word, value] of Object.entries(WORDED_WEAK_UNITS)) {
    // Don't clobber a strong/native mapping if one already exists for the key.
    if (!map.has(word)) map.set(word, { value, scale: false, weak: true });
  }
  return map;
})();

/**
 * Split text into word tokens while KEEPING combining marks (vowel signs,
 * the Malayalam/Indic virama "chandrakkala", etc.) attached to their base
 * letter. A naive split on \p{L} alone would tear "നൂറ്" into "നൂ" + "റ"
 * because the virana U+0D4D is a non-spacing mark (\p{M}), not a letter.
 */
function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Fold a left-to-right sequence of unit/scale tokens into a single number.
 *   two hundred fifty  → 2 → 200 → 250
 *   five thousand      → 5 → 5000
 *   one lakh           → 1 → 100000
 *   twenty five        → 20 → 25
 *   നൂറ് (alone)        → 100
 */
function composeWordedNumber(parts: WordedToken[]): number {
  let result = 0;
  let current = 0;
  let fracWhole: number | null = null; // dhai=2.5, dedh=1.5 — complete multiplier
  let fracOffset: number | null = null; // sava=+0.25, sadhe=+0.5, pauna=-0.25

  // The base a scale word multiplies: a pending whole-fraction wins, else a
  // pending offset over an implied count of 1, else the group built so far.
  const takeBase = (): number => {
    if (fracWhole !== null) {
      const b = fracWhole;
      fracWhole = null;
      return b;
    }
    if (fracOffset !== null) {
      const b = 1 + fracOffset;
      fracOffset = null;
      return b;
    }
    return current === 0 ? 1 : current;
  };

  for (const part of parts) {
    if (part.frac) {
      if (part.frac.whole != null) fracWhole = part.frac.whole;
      else fracOffset = part.frac.offset ?? 0;
      continue;
    }
    if (!part.scale) {
      if (fracOffset !== null) {
        // "sava do" → 2.25, "pauna be" → 1.75, "sadhe teen" → 3.5.
        current += part.value + fracOffset;
        fracOffset = null;
      } else if (fracWhole !== null) {
        // A bare count after a whole-fraction is unusual; fold additively.
        current += fracWhole + part.value;
        fracWhole = null;
      } else if (current > 0 && current < part.value) {
        current = current * part.value;
      } else {
        current += part.value;
      }
    } else if (part.value === 100) {
      // "hundred" multiplies the group/fraction built so far (default one).
      current = takeBase() * 100;
    } else {
      // thousand / lakh / crore flush the current group and scale it up.
      result += takeBase() * part.value;
      current = 0;
    }
  }
  // Flush a dangling fraction with no following scale ("dhai" alone = 2.5).
  if (fracWhole !== null) current += fracWhole;
  else if (fracOffset !== null) current += 1 + fracOffset;
  return result + current;
}

/**
 * Last-resort amount extractor for spelled-out numbers. Scans the text for
 * runs of consecutive number words (connectors like "and" are allowed
 * inside a run) and returns the largest composed value — the price is
 * almost always the biggest figure spoken. Currency is filled in from any
 * alias present in the text, mirroring extractCurrency.
 */
function pickWordedAmount(text: string): { value: number; currency: Currency | null } | null {
  const tokens = tokenizeWords(text);
  const runs: WordedToken[][] = [];
  let current: WordedToken[] | null = null;
  for (const token of tokens) {
    const hit = WORDED_LOOKUP.get(token);
    if (hit) {
      if (current === null) current = [];
      current.push(hit);
    } else if (WORDED_CONNECTORS.has(token) && current !== null) {
      // Keep the run open across "two hundred AND fifty"; adds no value.
    } else if (current !== null) {
      runs.push(current);
      current = null;
    }
  }
  if (current !== null) runs.push(current);
  if (runs.length === 0) return null;

  let best: number | null = null;
  for (const run of runs) {
    // A run must carry a real magnitude to count. Valid signals:
    //   - a scale word (hundred/thousand/lakh/…), OR
    //   - a STRONG additive unit (English/native number word, not a romanised
    //     weak unit, not a bare fraction).
    // A run of ONLY fraction words ("sava", "der", "pona") and/or weak units
    // ("do", "be") fabricates a 0.75–2.5 amount from a name or interjection —
    // discard it. "sava lakh"/"ढाई सौ" survive via their scale word; "fifty"
    // and "twenty five" survive via strong units.
    const hasStrongSignal = run.some(
      (t) => t.scale || (!t.weak && !t.frac && t.value > 0),
    );
    if (!hasStrongSignal) continue;
    const value = composeWordedNumber(run);
    if (value > 0 && (best === null || value > best)) best = value;
  }
  if (best === null) return null;
  return { value: Math.round(best * 100) / 100, currency: extractCurrency(text) };
}

/**
 * Pull the currency out of a sentence even when it isn't attached to
 * the amount, e.g. "lunch in dollars 50". Returns the first currency
 * alias hit.
 */
export function extractCurrency(text: string): Currency | null {
  if (!text) return null;
  const re = new RegExp(`(?:^|[^A-Za-z])(${CURRENCY_PATTERN})(?:[^A-Za-z]|$)`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  return normalizeCurrencyToken(m[1]!);
}

/**
 * Resolve "today" / "yesterday" / "last monday" / "dd/mm/yyyy" /
 * "yyyy-mm-dd" into an ISO YYYY-MM-DD string. Returns null if nothing
 * matched. The reference date defaults to "now" for production but
 * tests can pin it.
 */
export function extractDate(text: string, now: Date = new Date()): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const shift = (days: number): string => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return toIsoDate(d);
  };

  // --- "today" and same-day synonyms ---
  if (
    /\b(today|just\s+now|right\s+now|this\s+morning|this\s+afternoon|this\s+evening|tonight|last\s+night|earlier\s+today)\b/.test(
      lower,
    )
  ) {
    return toIsoDate(now);
  }

  // --- relative day words (longer phrases FIRST to avoid sub-matches) ---
  if (/\bday\s+after\s+tomorrow\b/.test(lower)) return shift(2);
  if (/\bday\s+before\s+yesterday\b/.test(lower)) return shift(-2);
  if (/\btomorrow\b/.test(lower)) return shift(1);
  if (/\byesterday\b/.test(lower)) return shift(-1);

  // --- "N days/weeks ago" (also "a/couple/few days back/earlier") ---
  const daysAgo = /\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple(?:\s+of)?|few)\s+days?\s+(?:ago|back|earlier|before)\b/.exec(
    lower,
  );
  if (daysAgo) {
    const n = smallWordToInt(daysAgo[1]!);
    if (n !== null) return shift(-n);
  }
  const weeksAgo = /\b(\d{1,2}|a|an|one|two|three|four|couple(?:\s+of)?)\s+weeks?\s+(?:ago|back|earlier)\b/.exec(
    lower,
  );
  if (weeksAgo) {
    const n = smallWordToInt(weeksAgo[1]!);
    if (n !== null) return shift(-7 * n);
  }
  if (/\b(a|one)\s+week\s+(?:ago|back)\b/.test(lower)) return shift(-7);

  // --- last / this / previous / next <weekday> ---
  const dayWord =
    /\b(last|this|previous|next|past|coming)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(
      text,
    );
  if (dayWord) {
    const target = WEEKDAY_INDEX[dayWord[2]!.toLowerCase()];
    if (typeof target === 'number') {
      const word = dayWord[1]!.toLowerCase();
      const d = new Date(now);
      const cur = d.getDay();
      if (word === 'next' || word === 'coming') {
        let diff = (target - cur + 7) % 7;
        if (diff === 0) diff = 7;
        d.setDate(d.getDate() + diff);
      } else {
        let diff = (cur - target + 7) % 7;
        if (diff === 0) diff = word === 'this' ? 0 : 7;
        d.setDate(d.getDate() - diff);
      }
      return toIsoDate(d);
    }
  }

  // --- month-name dates: "14 may", "may 14", "14th of may", "jan 5 2025" ---
  const monthDate = parseMonthNameDate(lower, now);
  if (monthDate) return monthDate;

  // --- "on the 5th" / "on 21st" — a day-of-month in the current month (or the
  //     previous month if that day is still in the future). Requires "on" so we
  //     don't misread "the 1st time" or "2nd coffee" as a date. ---
  const domMatch = /\bon\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/.exec(lower);
  if (domMatch) {
    const dom = Number(domMatch[1]);
    if (dom >= 1 && dom <= 31) {
      let y = now.getFullYear();
      let mo = now.getMonth(); // 0-based
      const probe = new Date(y, mo, dom);
      if (probe.getMonth() === mo && probe.getTime() > now.getTime() + 86_400_000) {
        // That day this month is in the future → assume last month.
        mo -= 1;
        if (mo < 0) {
          mo = 11;
          y -= 1;
        }
      }
      if (validateDate(y, mo + 1, dom)) return formatIso(y, mo + 1, dom);
    }
  }

  // --- ISO yyyy-mm-dd ---
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (validateDate(y, m, d)) return formatIso(y, m, d);
  }

  // --- dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy ---
  const dmy = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/.exec(text);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    if (validateDate(y, m, d)) return formatIso(y, m, d);
  }

  return null;
}

/** Small spelled-out / article counts used by "N days ago" etc. */
function smallWordToInt(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n > 0 && n <= 366 ? n : null;
  }
  const map: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    few: 3,
    couple: 2,
    'couple of': 2,
  };
  return map[t] ?? null;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_PATTERN = Object.keys(MONTH_INDEX).join('|');

/**
 * Parse "14 may", "may 14", "14th of may", "jan 5 2025". Year defaults to the
 * current year; if that lands clearly in the future we roll back a year (an
 * expense is almost always for a past/near date).
 */
function parseMonthNameDate(lower: string, now: Date): string | null {
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN})\\b(?:\\s+(\\d{4}))?`,
    'i',
  ).exec(lower);
  const monthFirst = new RegExp(
    `\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`,
    'i',
  ).exec(lower);

  let day: number | null = null;
  let mon: number | null = null;
  let year: number | null = null;
  if (dayFirst) {
    day = Number(dayFirst[1]);
    mon = MONTH_INDEX[dayFirst[2]!.toLowerCase()] ?? null;
    year = dayFirst[3] ? Number(dayFirst[3]) : null;
  } else if (monthFirst) {
    mon = MONTH_INDEX[monthFirst[1]!.toLowerCase()] ?? null;
    day = Number(monthFirst[2]);
    year = monthFirst[3] ? Number(monthFirst[3]) : null;
  }
  if (day === null || mon === null) return null;
  if (year === null) {
    year = now.getFullYear();
    const probe = new Date(year, mon - 1, day);
    if (probe.getTime() > now.getTime() + 2 * 86_400_000) year -= 1;
  }
  if (validateDate(year, mon, day)) return formatIso(year, mon, day);
  return null;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function validateDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 2000 || y > 2100) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

function toIsoDate(d: Date): string {
  return formatIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function formatIso(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

/**
 * Detect a split count: "split with 4 people", "between 3 of us",
 * "divided by 2". Returns null if there's no clear split.
 */
export function extractSplitCount(text: string): number | null {
  if (!text) return null;
  const split = SPLIT_RE.exec(text);
  if (split) {
    const n = Number(split[1]);
    if (Number.isFinite(n) && n >= 2 && n <= 50) return n;
  }
  const people = SPLIT_PEOPLE_RE.exec(text);
  if (people) {
    const n = Number(people[1]);
    if (Number.isFinite(n) && n >= 2 && n <= 50) return n;
  }
  return null;
}
