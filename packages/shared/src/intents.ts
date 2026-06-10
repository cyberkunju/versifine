/**
 * Intents the omnibar / bot can resolve a user's message to.
 *
 * `expense | income | transfer` route into the parse + persist path.
 * `query_*` intents are answered by the API immediately without storing data.
 * `chat` flows into the copilot RAG endpoint.
 * `unknown` triggers a clarification prompt instead of guessing.
 */

export const INTENTS = [
  'expense',
  'income',
  'transfer',
  'set_budget',
  'set_goal',
  'query_spending',
  'query_summary',
  'query_forecast',
  'query_debts',
  /**
   * "What was my last transaction?" / "show me my last entry" — returns the
   * single most-recent row, NOT a period summary. Production failure:
   * `enthayirunnu ente last transaction` was being mapped to query_summary
   * which returned this month's total (₹8,261, top: Restaurants) instead of
   * the actual last row. The empath subagent named this the "wrong question
   * answered" failure mode.
   */
  'query_last',
  'ask_advice',
  'lend',
  'borrow',
  'settle_debt',
  'correct_last',
  'delete_last',
  'change_language',
  'chat',
  'unknown',
] as const;

export type Intent = (typeof INTENTS)[number];

export const TRANSACTION_INTENTS: ReadonlyArray<Intent> = [
  'expense',
  'income',
  'transfer',
] as const;

export function isTransactionIntent(value: Intent): boolean {
  return TRANSACTION_INTENTS.includes(value);
}

const INTENT_SET = new Set<string>(INTENTS);
export function isIntent(value: string): value is Intent {
  return INTENT_SET.has(value);
}
