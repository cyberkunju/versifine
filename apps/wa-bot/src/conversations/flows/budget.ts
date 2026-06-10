/**
 * "Set budget" multi-step flow.
 *
 * Trigger: a message that starts with "set budget" (or its localized
 * variants the engine maps). Three states:
 *   1. SET_BUDGET_CATEGORY — user picks the category (free text matched
 *      against `BUDGETABLE_CATEGORIES` from @versifine/shared).
 *   2. SET_BUDGET_AMOUNT — user sends a number.
 *   3. Submit to /budgets, return localized confirmation.
 *
 * Single-message shortcut: "set budget groceries 8000" parses both
 * fields up-front and skips straight to the API call.
 */
import type { Session } from '../../types.ts';
import { BUDGETABLE_CATEGORIES, isCategory, type Category } from '@versifine/shared';
import { ApiClientError, createBudget } from '../../services/apiClient.ts';
import { log } from '../../utils/logger.ts';
import { getMessages } from '../messages/index.ts';
import { setState, updateSession } from '../state.ts';
import { effectiveLanguage } from '../../utils/langDetect.ts';

export interface BudgetResult {
  text: string;
  done: boolean;
}

const TRIGGER_RE =
  /\b(set|create|make|add|start|update|change|put|allocate|cap|limit)\b[^.\n]{0,30}\bbudget\b|\bbudget\b\s*(?:for|of|to|is|:|=|\d)/i;

const ALIAS_TO_CATEGORY: Record<string, Category> = {
  groceries: 'Groceries',
  grocery: 'Groceries',
  food: 'Restaurants',
  restaurants: 'Restaurants',
  dining: 'Restaurants',
  fooddelivery: 'Food Delivery',
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
  subscriptions: 'Subscriptions',
  coffee: 'Coffee & Beverages',
  travel: 'Travel',
  health: 'Healthcare',
  healthcare: 'Healthcare',
  education: 'Education',
};

export function pickCategory(input: string): Category | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  if (isCategory(input.trim())) return input.trim() as Category;
  if (ALIAS_TO_CATEGORY[trimmed]) return ALIAS_TO_CATEGORY[trimmed]!;
  // Try a fuzzy contains match against canonical names.
  for (const cat of BUDGETABLE_CATEGORIES) {
    if (cat.toLowerCase().includes(trimmed) || trimmed.includes(cat.toLowerCase())) return cat;
  }
  return null;
}

/**
 * Find a budgetable category mentioned ANYWHERE in a free-form message
 * ("set a monthly grocery budget of 8000" → Groceries). Whole-word matches
 * only, so "transport" in "transportation" doesn't double-fire oddly.
 */
function findCategoryInText(text: string): Category | null {
  const lower = ` ${text.toLowerCase()} `;
  for (const alias of Object.keys(ALIAS_TO_CATEGORY)) {
    if (new RegExp(`\\b${alias}\\b`).test(lower)) return ALIAS_TO_CATEGORY[alias]!;
  }
  for (const cat of BUDGETABLE_CATEGORIES) {
    if (new RegExp(`\\b${cat.toLowerCase().replace(/[&]/g, '\\&')}\\b`).test(lower)) return cat;
  }
  return null;
}

export function pickAmount(input: string): number | null {
  // Scale-aware: "5k"→5000, "1.5 lakh"→150000, "2 crore"→2e7. Mirrors the API
  // parser so the budget path agrees with expense parsing (the old regex
  // stopped at the digit and logged "5k" as ₹5).
  const m = input
    .toLowerCase()
    .replace(/,/g, '')
    .match(/(\d+(?:\.\d+)?)\s*(k|thousand|thousands|lakhs?|lac|crores?)?\b/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const suf = m[2];
  if (suf === 'k' || suf === 'thousand' || suf === 'thousands') n *= 1_000;
  else if (suf === 'lakh' || suf === 'lakhs' || suf === 'lac') n *= 100_000;
  else if (suf === 'crore' || suf === 'crores') n *= 10_000_000;
  return Math.round(n * 100) / 100;
}

export function looksLikeBudgetTrigger(text: string): boolean {
  return TRIGGER_RE.test(text);
}

async function submitBudget(
  session: Session,
  category: Category,
  amount: number,
): Promise<BudgetResult> {
  const m = getMessages(effectiveLanguage(session));
  try {
    await createBudget(session.phone, {
      name: `${category} budget`,
      recurrence: 'monthly',
      allocations: { [category]: amount },
    });
    setState(session.phone, 'LINKED_MAIN');
    updateSession(session.phone, { pending: {} });
    return { text: m.budgetSet(category, amount), done: true };
  } catch (err) {
    log.warn('BUDGET_CREATE_FAIL', {
      phone: session.phone,
      error: err instanceof ApiClientError ? `${err.code}:${err.message}` : String(err),
    });
    setState(session.phone, 'LINKED_MAIN');
    return { text: m.error, done: true };
  }
}

async function submitOverallBudget(session: Session, amount: number): Promise<BudgetResult> {
  const m = getMessages(effectiveLanguage(session));
  try {
    await createBudget(session.phone, {
      name: 'Monthly budget',
      recurrence: 'monthly',
      overallLimit: amount,
    });
    setState(session.phone, 'LINKED_MAIN');
    updateSession(session.phone, { pending: {} });
    return { text: m.budgetSetOverall(amount), done: true };
  } catch (err) {
    log.warn('BUDGET_CREATE_FAIL', {
      phone: session.phone,
      error: err instanceof ApiClientError ? `${err.code}:${err.message}` : String(err),
    });
    setState(session.phone, 'LINKED_MAIN');
    return { text: m.error, done: true };
  }
}

export async function handleBudget(session: Session, body: string): Promise<BudgetResult> {
  const m = getMessages(effectiveLanguage(session));
  const text = body.trim();

  // First-touch: a set-budget message in any phrasing ("set a budget for food
  // 5000", "budget 3000 for transport", "set a monthly grocery budget of
  // 8000"). Pull category + amount from anywhere in the text rather than
  // assuming they follow a fixed "set budget <cat> <amt>" order.
  if (TRIGGER_RE.test(text)) {
    const category = findCategoryInText(text);
    const amount = pickAmount(text);
    if (category && amount) {
      return submitBudget(session, category, amount);
    }
    if (category && !amount) {
      setState(session.phone, 'SET_BUDGET_AMOUNT');
      updateSession(session.phone, { pending: { budgetCategory: category } });
      return { text: m.budgetAskAmount(category), done: false };
    }
    // No category but an amount → an OVERALL (all-spending) cap. "set a monthly
    // budget 30000", "overall budget 30k". Useful and least-surprising rather
    // than interrogating for a category the user didn't give.
    if (!category && amount) {
      return submitOverallBudget(session, amount);
    }
    // Nothing concrete yet — start the multi-step ask.
    setState(session.phone, 'SET_BUDGET_CATEGORY');
    return { text: m.budgetAskCategory, done: false };
  }

  // SET_BUDGET_CATEGORY → user just typed the category name.
  if (session.state === 'SET_BUDGET_CATEGORY') {
    const category = pickCategory(text);
    if (!category) {
      return { text: m.budgetAskCategory, done: false };
    }
    setState(session.phone, 'SET_BUDGET_AMOUNT');
    updateSession(session.phone, { pending: { budgetCategory: category } });
    return { text: m.budgetAskAmount(category), done: false };
  }

  // SET_BUDGET_AMOUNT → user just typed the number.
  if (session.state === 'SET_BUDGET_AMOUNT') {
    const category = (session.pending.budgetCategory as Category | undefined) ?? null;
    const amount = pickAmount(text);
    if (!category || !amount) {
      // Reset cleanly if we lost track.
      setState(session.phone, 'LINKED_MAIN');
      return { text: m.unknown, done: true };
    }
    return submitBudget(session, category, amount);
  }

  return { text: m.unknown, done: true };
}
