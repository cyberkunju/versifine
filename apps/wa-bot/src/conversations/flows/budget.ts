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

export interface BudgetResult {
  text: string;
  done: boolean;
}

const TRIGGER_RE = /^\s*(set\s+budget|budget\s+for)\b/i;

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

function pickCategory(input: string): Category | null {
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

function pickAmount(input: string): number | null {
  const match = input.replace(/[,\s]/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function looksLikeBudgetTrigger(text: string): boolean {
  return TRIGGER_RE.test(text);
}

async function submitBudget(
  session: Session,
  category: Category,
  amount: number,
): Promise<BudgetResult> {
  const m = getMessages(session.language);
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

export async function handleBudget(session: Session, body: string): Promise<BudgetResult> {
  const m = getMessages(session.language);
  const text = body.trim();

  // First-touch shortcut: "set budget groceries 8000" — parse both fields.
  if (TRIGGER_RE.test(text)) {
    const stripped = text.replace(TRIGGER_RE, '').trim();
    // Split on whitespace; first word(s) until a number begin = category, rest = amount.
    const numMatch = stripped.match(/(\d+(?:\.\d+)?)/);
    if (numMatch) {
      const amount = Number(numMatch[1]);
      const catText = stripped.slice(0, numMatch.index ?? stripped.length).trim();
      const category = catText ? pickCategory(catText) : null;
      if (category && Number.isFinite(amount) && amount > 0) {
        return submitBudget(session, category, amount);
      }
      if (category) {
        // Got the category but the amount wasn't usable.
        setState(session.phone, 'SET_BUDGET_AMOUNT');
        updateSession(session.phone, { pending: { budgetCategory: category } });
        return { text: m.budgetAskAmount(category), done: false };
      }
    }
    // Not enough info — start the multi-step ask.
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
