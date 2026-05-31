/**
 * Parser regex extractors — pure, no LLM, no DB.
 *
 * The parser merges these results with the LLM output; the LLM is
 * non-deterministic and rate-limited so we can't depend on it in unit
 * tests. The regex layer is the contract that holds whether the LLM
 * runs or not — every claim in this file is reproducible offline.
 */
import { describe, expect, test } from 'bun:test';
import {
  extractAmount,
  extractCurrency,
  extractDate,
  extractSplitCount,
} from '../src/services/ai/parserRegex.ts';

const FROZEN_NOW = new Date('2026-05-28T12:00:00Z');

describe('extractAmount', () => {
  test('catches a bare number with no currency', () => {
    expect(extractAmount('spent 450 on auto')).toEqual({ amount: 450, currency: null });
  });

  test('catches an Indian rupee symbol prefix', () => {
    expect(extractAmount('₹120 coffee')).toEqual({ amount: 120, currency: 'INR' });
  });

  test('catches "Rs." prefix', () => {
    expect(extractAmount('Rs. 95 metro')).toEqual({ amount: 95, currency: 'INR' });
  });

  test('catches "rs" suffix', () => {
    expect(extractAmount('90 rs sandwich')).toEqual({ amount: 90, currency: 'INR' });
  });

  test('catches USD via "$"', () => {
    expect(extractAmount('$50 lunch')).toEqual({ amount: 50, currency: 'USD' });
  });

  test('catches "dollars" suffix', () => {
    expect(extractAmount('spent 50 dollars on lunch')).toEqual({ amount: 50, currency: 'USD' });
  });

  test('catches GBP word', () => {
    expect(extractAmount('GBP 80 hotel in london')).toEqual({ amount: 80, currency: 'GBP' });
  });

  test('expands "k" suffix to thousands', () => {
    expect(extractAmount('spent 1.5k on shoes')).toEqual({ amount: 1500, currency: null });
  });

  test('expands "lakh" suffix to 100_000', () => {
    expect(extractAmount('1.5 lakh investment')).toEqual({ amount: 150_000, currency: null });
  });

  test('expands "crore" suffix to 10_000_000', () => {
    expect(extractAmount('2 crore property')).toEqual({ amount: 20_000_000, currency: null });
  });

  test('strips thousand separators', () => {
    expect(extractAmount('₹3,200 dinner')).toEqual({ amount: 3200, currency: 'INR' });
  });

  test('returns null for empty input', () => {
    expect(extractAmount('')).toEqual({ amount: null, currency: null });
  });

  test('returns null when no number is present', () => {
    expect(extractAmount('feeling broke today')).toEqual({ amount: null, currency: null });
  });

  test('rejects negative numbers in raw text', () => {
    // The regex picks the first positive figure; a leading minus is
    // text-only here and never produces a negative amount.
    expect(extractAmount('refund of 200 today')).toEqual({ amount: 200, currency: null });
  });

  // --- multi-number "quantity vs price" disambiguation -----------------
  // Regression for the "I had 2 coffee for 560 → logged ₹2" bug.
  test('picks the price after "for", not the leading quantity', () => {
    expect(extractAmount('I had 2 coffee for 560')).toEqual({ amount: 560, currency: null });
  });

  test('picks the price after "for" even with small price', () => {
    expect(extractAmount('2 coffie for 50')).toEqual({ amount: 50, currency: null });
  });

  test('ignores a quantity with a unit and takes the standalone amount', () => {
    expect(extractAmount('3 plates biryani 450')).toEqual({ amount: 450, currency: null });
  });

  test('prefers the currency-tagged figure over a leading quantity', () => {
    expect(extractAmount('2 chai ₹40')).toEqual({ amount: 40, currency: 'INR' });
  });

  test('single number is unaffected', () => {
    expect(extractAmount('auto 80')).toEqual({ amount: 80, currency: null });
  });

  test('Malayalam-style "2 vada 140" picks the price', () => {
    expect(extractAmount('mala chaya randu vada 140')).toEqual({ amount: 140, currency: null });
  });
});

describe('extractCurrency', () => {
  test('finds currency mentioned away from the amount', () => {
    expect(extractCurrency('lunch in dollars cost 50')).toBe('USD');
  });

  test('returns null when no currency token is present', () => {
    expect(extractCurrency('groceries 4500 dmart')).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(extractCurrency('')).toBeNull();
  });
});

describe('extractDate', () => {
  test('today resolves to the reference now', () => {
    expect(extractDate('today 250 cab', FROZEN_NOW)).toBe('2026-05-28');
  });

  test('yesterday resolves to one day before now', () => {
    expect(extractDate('yesterday biryani 320', FROZEN_NOW)).toBe('2026-05-27');
  });

  test('day before yesterday resolves to two days before now', () => {
    expect(extractDate('day before yesterday i paid 800', FROZEN_NOW)).toBe('2026-05-26');
  });

  test('parses dd/mm/yyyy format', () => {
    expect(extractDate('rent paid 18000 on 01/06/2026', FROZEN_NOW)).toBe('2026-06-01');
  });

  test('parses dd-mm-yyyy format', () => {
    expect(extractDate('paid on 15-03-2026', FROZEN_NOW)).toBe('2026-03-15');
  });

  test('parses ISO yyyy-mm-dd format', () => {
    expect(extractDate('on 2026-04-01 we spent', FROZEN_NOW)).toBe('2026-04-01');
  });

  test('returns null when no date is present', () => {
    expect(extractDate('spent 450 on auto', FROZEN_NOW)).toBeNull();
  });

  test('rejects invalid day/month combinations', () => {
    expect(extractDate('on 32/13/2026', FROZEN_NOW)).toBeNull();
  });

  test('this monday returns today when reference is monday', () => {
    // FROZEN_NOW (May 28 2026) is a Thursday. "last monday" = May 25.
    expect(extractDate('last monday', FROZEN_NOW)).toBe('2026-05-25');
  });
});

describe('extractSplitCount', () => {
  test('catches "split with N people"', () => {
    expect(extractSplitCount('dinner 3000 split with 4 people')).toBe(4);
  });

  test('catches "between N of us"', () => {
    expect(extractSplitCount('snacks between 3 of us')).toBe(3);
  });

  test('catches "divided by N"', () => {
    expect(extractSplitCount('rent divided by 2')).toBe(2);
  });

  test('returns null when no split language is present', () => {
    expect(extractSplitCount('spent 450 on auto')).toBeNull();
  });

  test('rejects counts below 2', () => {
    expect(extractSplitCount('split with 1 person')).toBeNull();
  });

  test('rejects counts above 50', () => {
    expect(extractSplitCount('split with 99 people')).toBeNull();
  });
});
