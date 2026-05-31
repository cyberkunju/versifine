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

const SPLIT_RE = /\b(?:split(?:\s+(?:with|among))?|divide(?:d)?\s+(?:by|with|among)|share(?:d)?\s+(?:with|among))\s+(\d{1,2})\b/i;
const SPLIT_PEOPLE_RE =
  /\b(?:with|among|between)?\s*(\d{1,2})\s*(?:people|persons?|friends?|of\s+us)\b/i;

/** Words that mark the number AFTER them as the price/amount, not a quantity. */
const PRICE_MARKER = /\b(?:for|cost|costs|costing|worth|price|priced|paid|pay|payment|of|@|=|total|bill|amount|spent|spend)\s*$/i;
/** Words/units that mark the number BEFORE them as a quantity, not a price. */
const QUANTITY_UNIT = /^\s*(?:x|nos?|pcs?|pieces?|plates?|cups?|glasses?|kg|kgs?|g|grams?|litres?|liters?|l|ml|people|persons?|friends?|times?|months?|years?|days?|weeks?|hours?|hrs?|%|percent)\b/i;

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
    token
      .replace(/[oO]/g, '0')
      .replace(/[lI]/g, '1')
      .replace(/[sS]/g, '5')
      .replace(/[bB]/g, '8'),
  );
}

export function extractAmount(text: string): AmountExtraction {
  if (!text) return { amount: null, currency: null };
  const cleaned = normalizeDigitTypos(text.replace(/[\u00a0]/g, ' '));

  // 1) Currency followed by amount: "₹450", "Rs 450", "USD 50", "$50".
  const leading = new RegExp(
    `(?:^|[^A-Za-z])(${CURRENCY_PATTERN})\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|thousand|lakh|crore)?\\b`,
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
    `(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|thousand|lakh|crore)?\\s*(${CURRENCY_PATTERN})\\b`,
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
  return { amount: null, currency: null };
}

interface BareCandidate {
  value: number;
  index: number;
  afterPriceMarker: boolean;
  beforeQuantityUnit: boolean;
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
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakh|crore)?/gi;
  const candidates: BareCandidate[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = parseAmount(m[1]!, m[2] ?? null);
    if (value === null) continue;
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    candidates.push({
      value,
      index: m.index,
      afterPriceMarker: PRICE_MARKER.test(before),
      beforeQuantityUnit: QUANTITY_UNIT.test(after),
    });
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.value;

  const maxValue = Math.max(...candidates.map((c) => c.value));
  let best: BareCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
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
    const s = suffix.toLowerCase();
    if (s === 'k' || s === 'thousand') multiplier = 1_000;
    else if (s === 'lakh') multiplier = 100_000;
    else if (s === 'crore') multiplier = 10_000_000;
  }
  return Math.round(base * multiplier * 100) / 100;
}

function normalizeCurrencyToken(token: string): Currency | null {
  const lookup = token.trim().toLowerCase();
  return CURRENCY_ALIASES[lookup] ?? null;
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

  if (/\btoday\b/.test(lower)) return toIsoDate(now);
  // Check "day before yesterday" BEFORE the bare "yesterday" pattern; the
  // shorter token would otherwise greedy-match inside the longer phrase
  // and we'd report off-by-one.
  if (/\bday\s+before\s+yesterday\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 2);
    return toIsoDate(d);
  }
  if (/\byesterday\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return toIsoDate(d);
  }

  const dayWord = /\b(last|this|previous)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(
    text,
  );
  if (dayWord) {
    const target = WEEKDAY_INDEX[dayWord[2]!.toLowerCase()];
    if (typeof target === 'number') {
      const d = new Date(now);
      const cur = d.getDay();
      const isLast = dayWord[1]!.toLowerCase() !== 'this';
      let diff = (cur - target + 7) % 7;
      if (diff === 0) diff = isLast ? 7 : 0;
      d.setDate(d.getDate() - diff);
      return toIsoDate(d);
    }
  }

  // ISO yyyy-mm-dd
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (validateDate(y, m, d)) return formatIso(y, m, d);
  }

  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
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
