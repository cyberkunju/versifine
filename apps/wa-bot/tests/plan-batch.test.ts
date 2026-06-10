/**
 * planBatchLogged rendering — the compound-basket reply.
 *
 * Verifies every leg type renders (expense/income/lend/borrow), undo tokens
 * appear on tx legs, the income sign shows, and no currency is summed across
 * legs (each leg prints its own amount).
 */
import { describe, expect, test } from 'bun:test';
import { getMessages } from '../src/conversations/messages/index.ts';
import type { PlanLegView } from '../src/conversations/messages/types.ts';

const legs: PlanLegView[] = [
  {
    kind: 'tx',
    actionKind: 'log_expense',
    amount: 500,
    currency: 'INR',
    description: 'rent',
    category: 'Bills & Utilities',
    counterparty: null,
    direction: null,
    undoToken: 'K7P2A9',
  },
  {
    kind: 'tx',
    actionKind: 'log_income',
    amount: 2000,
    currency: 'INR',
    description: 'salary',
    category: null,
    counterparty: null,
    direction: null,
    undoToken: 'Q3M9X2',
  },
  {
    kind: 'ledger',
    actionKind: 'lend',
    amount: 300,
    currency: 'INR',
    description: null,
    category: null,
    counterparty: 'ravi',
    direction: 'lent',
    undoToken: null,
  },
];

for (const lang of ['en', 'hi', 'ml'] as const) {
  describe(`planBatchLogged — ${lang}`, () => {
    const m = getMessages(lang);
    const out = m.planBatchLogged(legs);

    test('renders every leg amount', () => {
      expect(out).toContain('₹500');
      expect(out).toContain('₹2,000');
      expect(out).toContain('₹300');
    });
    test('income leg shows a + sign', () => {
      expect(out).toContain('+₹2,000');
    });
    test('tx legs carry their undo token; ledger leg does not', () => {
      expect(out).toContain('undo K7P2A9');
      expect(out).toContain('undo Q3M9X2');
      expect(out).toContain('ravi');
      // ledger leg has no token
      expect(out).not.toMatch(/ravi[^\n]*undo/);
    });
    test('lists exactly three legs', () => {
      expect(out.split('•').length - 1).toBe(3);
    });
  });
}

describe('planBatchLogged — mixed currency legs print each own currency', () => {
  const m = getMessages('en');
  const out = m.planBatchLogged([
    { kind: 'tx', actionKind: 'log_expense', amount: 100, currency: 'USD', description: 'hotel', category: null, counterparty: null, direction: null, undoToken: 'AB12CD' },
    { kind: 'tx', actionKind: 'log_expense', amount: 2000, currency: 'INR', description: 'food', category: null, counterparty: null, direction: null, undoToken: 'EF34GH' },
  ]);
  test('USD and INR both rendered, never merged', () => {
    expect(out).toContain('$100');
    expect(out).toContain('₹2,000');
    expect(out).not.toContain('$2,100');
  });
});
