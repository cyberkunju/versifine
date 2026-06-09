/**
 * Correction flow — "fix the last transaction".
 *
 * Handles three kinds of correction on the most recent transaction
 * (`lastTransactionId`, set on every successful capture):
 *   • amount       "no it was 500 not 50", "actually make that 250"
 *   • category     "last one was Food not Transport", "change it to groceries"
 *   • description  "change last to dinner", "make that an Uber ride"
 *
 * A category change goes through the dedicated endpoint (records an audit
 * correction + upserts an override so similar future entries learn). Amount
 * and description changes use the general PATCH. Several can apply at once.
 */
import type { Session } from '../../types.ts';
import { type Category, isCategory } from '@versifine/shared';
import {
  ApiClientError,
  patchTransaction,
  patchTransactionCategory,
} from '../../services/apiClient.ts';
import { log } from '../../utils/logger.ts';
import { getMessages } from '../messages/index.ts';

/** Phrases that signal the user is correcting the previous entry. */
const TRIGGER_RE =
  /\b(should\s+be|that\s+was|it\s+was|it'?s\s+actually|actually|instead|rather|not\s+\w+|change\s+(it|that|the|last|to)|make\s+(it|that)|correct\s+(it|that|the)|wrong|mistake|meant|i\s+mean|no\s+it|no,)\b/i;

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
}

function parseCorrection(text: string): ParsedCorrection {
  const out: ParsedCorrection = {};
  const lower = text.toLowerCase();

  // --- category ---
  const cat = findCorrectedCategory(text);
  if (cat) out.category = cat;

  // --- amount ---
  // "<X> not <Y>" → X is the correct value (Y is the rejected one).
  const notMatch = lower.match(/(\d[\d,]*(?:\.\d+)?)\s+not\s+\d/);
  const nums = (lower.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((s) => Number(s.replace(/,/g, '')));
  if (notMatch) {
    out.amount = Number(notMatch[1]!.replace(/,/g, ''));
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
    if (d && !/^\d/.test(d) && !findCorrectedCategory(d)) {
      out.description = d;
    }
  }

  return out;
}

export function looksLikeCorrection(text: string): boolean {
  if (!TRIGGER_RE.test(text)) return false;
  const parsed = parseCorrection(text);
  return parsed.amount !== undefined || parsed.category !== undefined || Boolean(parsed.description);
}

export async function handleCorrection(session: Session, body: string): Promise<{ text: string }> {
  const parsed = parseCorrection(body);
  const prev = (session.pending?.lastTx as { amount?: unknown } | undefined)?.amount;
  return applyParsedCorrection(session, parsed, {
    previousAmount: typeof prev === 'number' ? prev : null,
  });
}

/**
 * Apply an ALREADY-RESOLVED correction to the user's last transaction. Shared
 * by the English regex path (handleCorrection → parseCorrection) and the
 * language-agnostic LLM path (the API's context-aware classifier resolves the
 * new amount/category from any language and the bot hands them straight here).
 * Accepts loose input (number|null, string|null) and validates internally.
 */
export async function applyParsedCorrection(
  session: Session,
  fields: { amount?: number | null; category?: string | null; description?: string | null },
  opts: { previousAmount?: number | null } = {},
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
  if (amount === undefined && !category && !description) {
    return { text: m.correctNotPossible };
  }

  try {
    // Category-only change goes through the dedicated endpoint (audit + override learning).
    if (category && amount === undefined && !description) {
      await patchTransactionCategory(session.phone, session.lastTransactionId, category);
      return { text: m.correctApplied(category) };
    }

    const patch: { amount?: number; description?: string; category?: string } = {};
    if (amount !== undefined) patch.amount = amount;
    if (description) patch.description = description;
    if (category) patch.category = category;

    const { transaction } = await patchTransaction(session.phone, session.lastTransactionId, patch);

    const parts: string[] = [];
    if (amount !== undefined) {
      const newAmt = `₹${transaction.amount.toLocaleString('en-IN')}`;
      const prev = opts.previousAmount;
      // Show old → new so the user always sees exactly what changed.
      parts.push(
        prev != null && Math.abs(prev - transaction.amount) >= 0.005
          ? `₹${prev.toLocaleString('en-IN')} → ${newAmt}`
          : newAmt,
      );
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
