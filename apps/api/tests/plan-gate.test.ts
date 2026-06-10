/**
 * Compound-plan execution gate (isExecutablePlan).
 *
 * The live planner must ONLY fire for grounded, confident baskets of
 * supported money movements. Everything else falls back to the proven
 * single-intent legacy router. These are pure-function gate tests — no DB.
 */
import { describe, expect, test } from 'bun:test';
import { isExecutablePlan, __planInternals } from '../src/services/capture/plan.ts';
import type { PlannerResult, PlannedAction } from '../src/services/ai/planner.ts';

const { spanOf, resolveCurrency } = __planInternals;

function plan(actions: PlannedAction[], confidence = 0.9, grounded = true): PlannerResult {
  return { actions, confidence, allAmountsGrounded: grounded };
}

const exp = (amount: number): PlannedAction => ({
  kind: 'log_expense',
  amount,
  currency: null,
  description: 'x',
  walletHint: null,
  categoryHint: null,
  date: null,
});
const inc = (amount: number): PlannedAction => ({
  kind: 'log_income',
  amount,
  currency: null,
  description: 'salary',
  walletHint: null,
  date: null,
});
const lend = (amount: number): PlannedAction => ({
  kind: 'lend',
  amount,
  counterparty: 'ravi',
  currency: null,
  date: null,
});

describe('isExecutablePlan — accepts grounded confident money baskets', () => {
  test('expense + income', () => {
    expect(isExecutablePlan(plan([exp(500), inc(2000)]))).toBe(true);
  });
  test('expense + income + lend (the headline case)', () => {
    expect(isExecutablePlan(plan([exp(500), inc(2000), lend(300)]))).toBe(true);
  });
});

describe('isExecutablePlan — rejects', () => {
  test('single action (legacy handles it)', () => {
    expect(isExecutablePlan(plan([exp(500)]))).toBe(false);
  });
  test('ungrounded amounts', () => {
    expect(isExecutablePlan(plan([exp(500), inc(2000)], 0.9, false))).toBe(false);
  });
  test('low confidence', () => {
    expect(isExecutablePlan(plan([exp(500), inc(2000)], 0.4))).toBe(false);
  });
  test('an unsupported action kind in the basket (set_goal)', () => {
    const goal: PlannedAction = { kind: 'set_goal', name: 'trip', targetAmount: 5000, deadline: null };
    expect(isExecutablePlan(plan([exp(500), goal]))).toBe(false);
  });
  test('a query mixed in', () => {
    const q: PlannedAction = { kind: 'query', subject: 'summary' };
    expect(isExecutablePlan(plan([exp(500), q]))).toBe(false);
  });
  test('correct_last mixed in (never auto-execute a mutation in a basket)', () => {
    const corr: PlannedAction = { kind: 'correct_last', newAmount: 230, newCategory: null };
    expect(isExecutablePlan(plan([exp(500), corr]))).toBe(false);
  });
});

describe('per-leg currency guard (P0 — no cross-leg currency bleed)', () => {
  const full = '$100 hotel and 2000 food';

  test('spanOf trusts a real substring, falls back otherwise', () => {
    expect(spanOf('2000 food', full)).toBe('2000 food');
    expect(spanOf('paraphrased hundred dollars', full)).toBe(full);
    expect(spanOf(null, full)).toBe(full);
  });

  test('rupee leg does NOT inherit USD from the $ elsewhere in the message', () => {
    // span "2000 food" has no foreign token → INR even though the LLM said USD.
    expect(resolveCurrency('USD', spanOf('2000 food', full))).toBe('INR');
  });

  test('foreign leg keeps its currency (token in its own span)', () => {
    expect(resolveCurrency('USD', spanOf('$100 hotel', full))).toBe('USD');
  });

  test('invalid / INR codes resolve to INR', () => {
    expect(resolveCurrency('ZZZ', full)).toBe('INR');
    expect(resolveCurrency(null, full)).toBe('INR');
    expect(resolveCurrency('INR', full)).toBe('INR');
  });
});
