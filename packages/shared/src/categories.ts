/**
 * The 23 expense categories used across the system.
 *
 * The set is intentionally aligned with the labels that the local categorizer
 * model emits, so a prediction from the model maps 1:1 to a UI tile, an icon,
 * and a display colour without any translation step. Any change here must be
 * mirrored in the model artifact's id2label.
 *
 * `Income` is included so a top-level classifier can route credits without a
 * separate enum, but expense flows filter it out.
 */

export const CATEGORIES = [
  'Bills & Utilities',
  'Cash & ATM',
  'Childcare',
  'Coffee & Beverages',
  'Convenience',
  'Education',
  'Entertainment',
  'Fast Food',
  'Food Delivery',
  'Gas & Fuel',
  'Giving',
  'Groceries',
  'Healthcare',
  'Housing',
  'Income',
  'Insurance',
  'Other',
  'Restaurants',
  'Shopping & Retail',
  'Subscriptions',
  'Transfers',
  'Transportation',
  'Travel',
] as const;

export type Category = (typeof CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(CATEGORIES);

export function isCategory(value: string): value is Category {
  return CATEGORY_SET.has(value);
}

/**
 * Display metadata: emoji icon + tailwind hue for chips and chart colours.
 * The hue keys map to a 50→900 ramp the web app turns into actual hex codes,
 * keeping this file framework-free.
 */
export const CATEGORY_META: Record<
  Category,
  { icon: string; hue: 'slate' | 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan' | 'orange' | 'lime' | 'pink' }
> = {
  'Bills & Utilities': { icon: '🧾', hue: 'amber' },
  'Cash & ATM': { icon: '🏧', hue: 'slate' },
  Childcare: { icon: '🧒', hue: 'pink' },
  'Coffee & Beverages': { icon: '☕', hue: 'orange' },
  Convenience: { icon: '🏪', hue: 'lime' },
  Education: { icon: '📚', hue: 'cyan' },
  Entertainment: { icon: '🎬', hue: 'violet' },
  'Fast Food': { icon: '🍔', hue: 'rose' },
  'Food Delivery': { icon: '🛵', hue: 'rose' },
  'Gas & Fuel': { icon: '⛽', hue: 'amber' },
  Giving: { icon: '🤲', hue: 'emerald' },
  Groceries: { icon: '🛒', hue: 'lime' },
  Healthcare: { icon: '🩺', hue: 'rose' },
  Housing: { icon: '🏠', hue: 'blue' },
  Income: { icon: '💰', hue: 'emerald' },
  Insurance: { icon: '🛡️', hue: 'cyan' },
  Other: { icon: '•', hue: 'slate' },
  Restaurants: { icon: '🍽️', hue: 'rose' },
  'Shopping & Retail': { icon: '🛍️', hue: 'violet' },
  Subscriptions: { icon: '🔁', hue: 'cyan' },
  Transfers: { icon: '↔️', hue: 'slate' },
  Transportation: { icon: '🚖', hue: 'blue' },
  Travel: { icon: '✈️', hue: 'cyan' },
};

/** Categories shown in the budget allocator (everything except non-budgetable rows). */
export const BUDGETABLE_CATEGORIES: ReadonlyArray<Category> = CATEGORIES.filter(
  (c) => c !== 'Income' && c !== 'Transfers' && c !== 'Cash & ATM',
) as ReadonlyArray<Category>;
