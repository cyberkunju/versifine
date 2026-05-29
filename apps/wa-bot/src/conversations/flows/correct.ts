/**
 * "Last one was X not Y" correction flow.
 *
 * The user just logged a transaction and realises it landed in the wrong
 * category. We patch `lastTransactionId` (set on every successful capture)
 * with the new category. The API records a `category_corrections` audit
 * row + upserts a `category_overrides` row, so future similar entries get
 * the corrected label automatically.
 */
import type { Session } from '../../types.ts';
import { type Category, isCategory } from '@versifine/shared';
import { ApiClientError, patchTransactionCategory } from '../../services/apiClient.ts';
import { log } from '../../utils/logger.ts';
import { getMessages } from '../messages/index.ts';

const TRIGGER_RE =
  /\b(should\s+be|that\s+was|actually|is\s+actually|not\s+\w+\s*,?\s*\w+|change\s+(it|the)\s+(category|to))\b/i;

const ALIAS_TO_CATEGORY: Record<string, Category> = {
  groceries: 'Groceries',
  grocery: 'Groceries',
  food: 'Restaurants',
  restaurants: 'Restaurants',
  dining: 'Restaurants',
  delivery: 'Food Delivery',
  transport: 'Transportation',
  transportation: 'Transportation',
  fuel: 'Gas & Fuel',
  petrol: 'Gas & Fuel',
  rent: 'Housing',
  bills: 'Bills & Utilities',
  utilities: 'Bills & Utilities',
  shopping: 'Shopping & Retail',
  entertainment: 'Entertainment',
  subscriptions: 'Subscriptions',
  coffee: 'Coffee & Beverages',
  travel: 'Travel',
  health: 'Healthcare',
  healthcare: 'Healthcare',
  education: 'Education',
};

function findCategoryInText(text: string): Category | null {
  // First, try an exact category-name match anywhere in the message.
  for (const lower of Object.keys(ALIAS_TO_CATEGORY)) {
    const re = new RegExp(`\\b${lower}\\b`, 'i');
    if (re.test(text)) return ALIAS_TO_CATEGORY[lower]!;
  }
  // Then try canonical category strings verbatim.
  const tokens = text.split(/[,.\s]+/);
  for (const t of tokens) {
    if (isCategory(t)) return t as Category;
  }
  return null;
}

export function looksLikeCorrection(text: string): boolean {
  return TRIGGER_RE.test(text) && findCategoryInText(text) !== null;
}

export async function handleCorrection(session: Session, body: string): Promise<{ text: string }> {
  const m = getMessages(session.language);
  if (!session.lastTransactionId) {
    return { text: m.correctNotPossible };
  }
  const newCategory = findCategoryInText(body);
  if (!newCategory) {
    return { text: m.correctNotPossible };
  }
  try {
    await patchTransactionCategory(session.phone, session.lastTransactionId, newCategory);
    return { text: m.correctApplied(newCategory) };
  } catch (err) {
    log.warn('CORRECT_FAIL', {
      phone: session.phone,
      error: err instanceof ApiClientError ? `${err.code}:${err.message}` : String(err),
    });
    return { text: m.error };
  }
}
