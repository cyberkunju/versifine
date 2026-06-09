/**
 * Correction flow — "fix the last transaction".
 *
 * Handles four kinds of correction on the most recent transaction
 * (`lastTransactionId`, set on every successful capture):
 *   • amount       "no it was 500 not 50", "actually make that 250"
 *   • category     "last one was Food not Transport", "change it to groceries"
 *   • description  "change last to dinner", "make that an Uber ride"
 *   • currency     "its omr not inr", "make it sar", "actually USD not INR"
 *
 * A category change goes through the dedicated endpoint (records an audit
 * correction + upserts an override so similar future entries learn). Amount,
 * description and currency changes use the general PATCH. Several can apply
 * at once. Corrections ARE applied immediately (act-with-undo) — never gated
 * behind a CONFIRM/CANCEL prompt; if the user mistyped they say "undo".
 */
import type { Session } from '../../types.ts';
import {
  type Category,
  type Currency,
  CURRENCY_ALIASES,
  isCategory,
  normalizeCurrency,
} from '@versifine/shared';
import {
  ApiClientError,
  patchTransaction,
  patchTransactionCategory,
} from '../../services/apiClient.ts';
import { log } from '../../utils/logger.ts';
import { getMessages } from '../messages/index.ts';

/** Phrases that signal the user is correcting the previous entry. */
const TRIGGER_RE =
  /\b(should\s+be|that\s+was|it\s+was|it'?s\s+actually|it'?s\s+(?:not|in)|actually|instead|rather|not\s+\w+|change\s+(it|that|the|last|to)|make\s+(it|that)|correct\s+(it|that|the)|wrong|mistake|meant|i\s+mean|no\s+it|no,)\b/i;

/**
 * Currency-token alternation built from the canonical alias list (riyal, rial,
 * sar, dinar, kwd, omr, qar, dirham, aed, dollar, usd, euro, eur, pound, gbp,
 * inr, rupees, …) plus every uppercase ISO code. Sorted longest-first so
 * "rs." matches before "rs" and ISO codes win over generic words.
 */
const CURRENCY_KEYS = Array.from(
  new Set<string>([
    ...Object.keys(CURRENCY_ALIASES),
    'aud',
    'cad',
    'jpy',
    'sgd',
    'myr',
    'thb',
    'cny',
    'krw',
    'hkd',
    'chf',
    'zar',
    'brl',
    'npr',
    'lkr',
    'pkr',
    'bdt',
    'omr',
    'sar',
    'qar',
    'kwd',
    'bhd',
  ]),
);
CURRENCY_KEYS.sort((a, b) => b.length - a.length);
const CURRENCY_PATTERN = CURRENCY_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(
  '|',
);
/** "<CURR> not <CURR>" / "<CURR> instead of <CURR>" — currency-only correction. */
const CURRENCY_NOT_RE = new RegExp(
  `(?:^|[^A-Za-z])(${CURRENCY_PATTERN})\\s+(?:not|instead\\s+of|rather\\s+than)\\s+(${CURRENCY_PATTERN})\\b`,
  'i',
);
/** "its X" / "make it X" / "actually X" / "change to X" / "should be X" / "in X" — single currency. */
const CURRENCY_SINGLE_RE = new RegExp(
  `\\b(?:it'?s|make\\s+it|actually|change(?:\\s+to)?|should\\s+be|set\\s+to|use|in)\\s+(${CURRENCY_PATTERN})\\b(?!\\s*\\d)`,
  'i',
);
const ALIAS_TO_CATEGORY: Record<string, Category> = {
  groceries: 'Groceries',
  grocery: 'Groceries',
  food: 'Restaurants',
  restaurant: 'Restaurants',
  restaurants: 'Restaurants',
  dining: 'Restaurants',
  delivery: 'Food Delivery',
  transport: 'Transportation',
  transportation: 'Transportation',
  fuel: 'Gas & Fuel',
  petrol: 'Gas & Fuel',
  diesel: 'Gas & Fuel',
  rent: 'Housing',
  housing: 'Housing',
  bills: 'Bills & Utilities',
  utilities: 'Bills & Utilities',
  shopping: 'Shopping & Retail',
  retail: 'Shopping & Retail',
  entertainment: 'Entertainment',
  subscription: 'Subscriptions',
  subscriptions: 'Subscriptions',
  coffee: 'Coffee & Beverages',
  beverages: 'Coffee & Beverages',
  travel: 'Travel',
  health: 'Healthcare',
  healthcare: 'Healthcare',
  medical: 'Healthcare',
  education: 'Education',
};

/**
 * Find a category mentioned in the text, but ignore any category that comes
 * right after "not" (that's the WRONG one the user is rejecting). So
 * "Food not Transport" → Restaurants, and "Transport not Food" → Transportation.
 */
function findCorrectedCategory(text: string): Category | null {
  const cleaned = text.replace(/\bnot\s+[a-z& ]+/gi, ' ');
  const lower = ` ${cleaned.toLowerCase()} `;
  for (const alias of Object.keys(ALIAS_TO_CATEGORY)) {
    if (new RegExp(`\\b${alias}\\b`).test(lower)) return ALIAS_TO_CATEGORY[alias]!;
  }
  const tokens = cleaned.split(/[,.\s]+/);
  for (const t of tokens) {
    if (isCategory(t)) return t as Category;
  }
  return null;
}

interface ParsedCorrection {
  amount?: number;
  category?: Category;
  description?: string;
  currency?: Currency;
}

/**
 * Resolve a token like "omr"/"OMR"/"riyal"/"rs" into an ISO code, but ONLY when
 * it actually maps to a real currency. Returns null on unknown input so an
 * arbitrary noun ("not pizza") is never silently coerced to INR.
 */
function tokenToCurrency(raw: string): Currency | null {
  const lookup = raw.trim().toLowerCase();
  if (CURRENCY_ALIASES[lookup]) return CURRENCY_ALIASES[lookup];
  const upper = raw.trim().toUpperCase();
  // normalizeCurrency falls back to INR for unknowns; we only want a hit when
  // the upper-cased form is genuinely a 3-letter ISO code that's in our list.
  if (/^[A-Z]{3}$/.test(upper)) {
    const resolved = normalizeCurrency(upper);
    // normalizeCurrency returns 'INR' for unknown codes too, so accept the
    // result only when it equals what we asked for OR the input was 'INR'.
    if (resolved === upper || upper === 'INR') return resolved;
  }
  return null;
}

function parseCorrection(text: string): ParsedCorrection {
  const out: ParsedCorrection = {};
  const lower = text.toLowerCase();

  // --- currency ---
  // "<CURR> not <CURR>" — most explicit; the FIRST token is the desired one.
  // "actually omr" / "make it sar" / "its dollar" — single currency.
  const notMatch = CURRENCY_NOT_RE.exec(text);
  if (notMatch) {
    const cur = tokenToCurrency(notMatch[1]!);
    if (cur) out.currency = cur;
  } else {
    const single = CURRENCY_SINGLE_RE.exec(text);
    if (single) {
      const cur = tokenToCurrency(single[1]!);
      if (cur) out.currency = cur;
    }
  }

  // --- category ---
  const cat = findCorrectedCategory(text);
  if (cat) out.category = cat;

  // --- amount ---
  // "<X> not <Y>" → X is the correct value (Y is the rejected one). Tightened
  // to require a digit on BOTH sides so currency-corrections like "OMR not INR"
  // don't get mined as a phantom amount-correction.
  const notAmt = lower.match(/(\d[\d,]*(?:\.\d+)?)\s+not\s+\d/);
  const nums = (lower.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => Number(s.replace(/,/g, '')));
  if (notAmt) {
    out.amount = Number(notAmt[1]!.replace(/,/g, ''));
  } else if (nums.length === 1) {
    out.amount = nums[0]!;
  } else if (nums.length > 1 && /\b(was|make it|actually|should be|now|rather|instead|to)\b/.test(lower)) {
    // Ambiguous multi-number correction — take the last figure mentioned.
    out.amount = nums[nums.length - 1]!;
  }
  if (out.amount !== undefined && (!Number.isFinite(out.amount) || out.amount <= 0)) {
    delete out.amount;
  }

  // --- description ---
  // "change/make/set/rename ... to <text>" or a trailing "to <text>", where the
  // target is words (not a number) and not just a category we already captured.
  const descMatch =
    text.match(
      /\b(?:change|make|set|rename|correct)\b[^.\n]*?\bto\s+(?:a\s+|an\s+|the\s+)?["']?([a-zA-Z][\w &/-]{1,40})["']?\s*$/i,
    ) ?? text.match(/\bto\s+(?:a\s+|an\s+)?["']?([a-zA-Z][\w &/-]{1,40})["']?\s*$/i);
  if (descMatch) {
    const d = descMatch[1]!.trim();
    if (
      d &&
      !/^\d/.test(d) &&
      !findCorrectedCategory(d) &&
      // Don't mine a currency token as a description ("change to OMR").
      !tokenToCurrency(d.split(/\s+/)[0] ?? '')
    ) {
      out.description = d;
    }
  }

  return out;
}

export function looksLikeCorrection(text: string): boolean {
  const parsed = parseCorrection(text);
  // A currency-correction pattern ("its omr not inr", "OMR not INR", "make it
  // sar") is self-evident — the regexes ALREADY require a correction trigger
  // ("its"/"not"/"make it"/"actually"/etc.) AND a real currency token, so we
  // honour it regardless of the broader TRIGGER_RE.
  if (parsed.currency !== undefined) return true;
  if (!TRIGGER_RE.test(text)) return false;
  return parsed.amount !== undefined || parsed.category !== undefined || Boolean(parsed.description);
}

export async function handleCorrection(session: Session, body: string): Promise<{ text: string }> {
  const parsed = parseCorrection(body);
  const last = session.pending?.lastTx as
    | { amount?: unknown; currency?: unknown }
    | undefined;
  const prev = last?.amount;
  const prevCur = last?.currency;
  return applyParsedCorrection(session, parsed, {
    previousAmount: typeof prev === 'number' ? prev : null,
    previousCurrency: typeof prevCur === 'string' ? prevCur : null,
  });
}

/**
 * Apply an ALREADY-RESOLVED correction to the user's last transaction. Shared
 * by the English regex path (handleCorrection → parseCorrection) and the
 * language-agnostic LLM path (the API's context-aware classifier resolves the
 * new amount/category/currency from any language and the bot hands them
 * straight here). Accepts loose input (number|null, string|null) and validates
 * internally.
 *
 * Acts immediately — no CONFIRM gate. If the user mistyped they say "undo".
 */
export async function applyParsedCorrection(
  session: Session,
  fields: {
    amount?: number | null;
    category?: string | null;
    description?: string | null;
    currency?: string | null;
  },
  opts: { previousAmount?: number | null; previousCurrency?: string | null } = {},
): Promise<{ text: string }> {
  const m = getMessages(session.language);
  if (!session.lastTransactionId) {
    return { text: m.correctNotPossible };
  }
  const amount =
    typeof fields.amount === 'number' && Number.isFinite(fields.amount) && fields.amount > 0
      ? fields.amount
      : undefined;
  const category =
    fields.category && isCategory(fields.category) ? (fields.category as Category) : undefined;
  const description = fields.description?.trim() ? fields.description.trim() : undefined;
  // Validate currency: must be a known token. Passing an unknown string would
  // make the API reject the PATCH (the schema enforces the enum), so resolving
  // here gives the user a deterministic outcome instead of a generic error.
  let currency: Currency | undefined;
  if (fields.currency) {
    const resolved = tokenToCurrency(fields.currency);
    if (resolved) currency = resolved;
  }
  if (amount === undefined && !category && !description && !currency) {
    return { text: m.correctNotPossible };
  }

  try {
    // Category-only change goes through the dedicated endpoint (audit + override learning).
    if (category && amount === undefined && !description && !currency) {
      await patchTransactionCategory(session.phone, session.lastTransactionId, category);
      return { text: m.correctApplied(category) };
    }

    const patch: { amount?: number; description?: string; category?: string; currency?: string } = {};
    if (amount !== undefined) patch.amount = amount;
    if (description) patch.description = description;
    if (category) patch.category = category;
    if (currency) patch.currency = currency;

    const { transaction } = await patchTransaction(session.phone, session.lastTransactionId, patch);

    const parts: string[] = [];
    // Amount and currency render together so the user sees the same shape they
    // entered ("OMR 4" instead of two disjoint pieces).
    const showAmount = amount !== undefined || currency !== undefined;
    if (showAmount) {
      const newCur = transaction.currency ?? currency ?? opts.previousCurrency ?? 'INR';
      const newAmt = formatMoney(transaction.amount, newCur);
      const prevAmt = opts.previousAmount;
      const prevCur = opts.previousCurrency ?? newCur;
      const prevStr =
        prevAmt != null ? formatMoney(prevAmt, prevCur) : null;
      const changed =
        prevAmt == null ||
        Math.abs(prevAmt - transaction.amount) >= 0.005 ||
        prevCur !== newCur;
      parts.push(prevStr && changed ? `${prevStr} → ${newAmt}` : newAmt);
    }
    if (description) parts.push(`"${transaction.description}"`);
    if (category) parts.push(transaction.category ?? category);
    return { text: m.correctUpdated(parts.join(' · ')) };
  } catch (err) {
    log.warn('CORRECT_FAIL', {
      phone: session.phone,
      error: err instanceof ApiClientError ? `${err.code}:${err.message}` : String(err),
    });
    return { text: m.error };
  }
}

/** Render an amount in its currency: ₹/$/€/£/¥ glyph or trailing 3-letter code. */
function formatMoney(amount: number, currency: string): string {
  const cur = currency.toUpperCase();
  const num = amount.toLocaleString('en-IN');
  switch (cur) {
    case 'INR':
      return `₹${num}`;
    case 'USD':
      return `$${num}`;
    case 'EUR':
      return `€${num}`;
    case 'GBP':
      return `£${num}`;
    case 'JPY':
      return `¥${num}`;
    default:
      return `${cur} ${num}`;
  }
}
