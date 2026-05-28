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
import { CURRENCY_ALIASES, type Currency } from '@finehance/shared';

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

/**
 * Pull an amount out of a sentence. Recognises a leading currency
 * symbol/word, a trailing currency symbol/word, and bare numbers like
 * "450" or "3,200" or "1.5k".
 */
export function extractAmount(text: string): AmountExtraction {
  if (!text) return { amount: null, currency: null };
  const cleaned = text.replace(/[\u00a0]/g, ' ');

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

  // 2) Amount followed by currency: "450 rs", "50 dollars".
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

  // 3) Bare number — accept the FIRST sensible figure.
  const bare = /(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakh|crore)?/i.exec(cleaned);
  if (bare) {
    const amt = parseAmount(bare[1]!, bare[2] ?? null);
    if (amt !== null) return { amount: amt, currency: null };
  }
  return { amount: null, currency: null };
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
