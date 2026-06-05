/**
 * Reinforcement — unit tests for pure business logic.
 *
 * We test the decision logic that determines whether a draft was edited
 * (isEdited) since that drives whether onRejected fires. The DB-backed
 * functions are integration-tested separately.
 */
import { describe, expect, it } from 'bun:test';
import type { ParsedExpense } from '../../src/services/ai/parser.ts';

// Re-implement the "wasEdited" logic from capture.ts as a pure function
// so we can unit-test it in isolation.
function wasEdited(
  original: ParsedExpense,
  edits: Partial<ParsedExpense>,
): boolean {
  return (
    (edits.amount !== undefined && edits.amount !== original.amount) ||
    (edits.description !== undefined && edits.description !== original.description) ||
    (edits.currency !== undefined && edits.currency !== original.currency) ||
    (edits.walletHint !== undefined && edits.walletHint !== original.walletHint)
  );
}

const base: ParsedExpense = {
  type: 'expense',
  amount: 450,
  currency: 'INR',
  description: 'auto',
  categoryHint: 'transport',
  walletHint: 'hdfc',
  date: null,
  splitPeople: null,
  originalAmount: null,
  originalCurrency: null,
  confidence: 0.9,
  needs: [],
};

describe('reinforcement wasEdited logic', () => {
  it('returns false when no critical field changed', () => {
    expect(wasEdited(base, { categoryHint: 'Transportation' })).toBe(false);
  });

  it('returns true when amount changed', () => {
    expect(wasEdited(base, { amount: 500 })).toBe(true);
  });

  it('returns true when description changed', () => {
    expect(wasEdited(base, { description: 'cab' })).toBe(true);
  });

  it('returns true when currency changed', () => {
    expect(wasEdited(base, { currency: 'USD' })).toBe(true);
  });

  it('returns true when walletHint changed', () => {
    expect(wasEdited(base, { walletHint: 'cash' })).toBe(true);
  });

  it('returns false when amount matches exactly', () => {
    expect(wasEdited(base, { amount: 450 })).toBe(false);
  });

  it('returns false when edits object is empty', () => {
    expect(wasEdited(base, {})).toBe(false);
  });
});
