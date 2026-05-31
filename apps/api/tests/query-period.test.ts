/**
 * Period detection + category canonicalization unit tests.
 *
 * Regression guards for the WhatsApp "how much did I spend today" bug:
 *   1. Malayalam "today" (ഇന്ന്) must not be shadowed by being a script
 *      prefix of "yesterday" (ഇന്നലെ) — yesterday is checked first.
 *   2. A loose category hint ("food", "petrol") must map to a canonical
 *      category so the spending query actually filters correctly.
 *
 * Both are pure functions — no DB, no API key needed.
 */
import { expect, test, describe } from 'bun:test';
import { detectPeriod, canonicalizeCategory } from '../src/services/capture/queryStubs.ts';

// Fixed reference: Wed 2026-05-20 14:00 local.
const NOW = new Date(2026, 4, 20, 14, 0, 0);

describe('detectPeriod — English', () => {
  test('today', () => {
    expect(detectPeriod('how much did I spend today', NOW).key).toBe('today');
  });
  test('yesterday', () => {
    expect(detectPeriod('what did I spend yesterday', NOW).key).toBe('yesterday');
  });
  test('this week / last week', () => {
    expect(detectPeriod('this week total', NOW).key).toBe('this_week');
    expect(detectPeriod('last week spend', NOW).key).toBe('last_week');
  });
  test('this month / last month', () => {
    expect(detectPeriod('spend this month', NOW).key).toBe('this_month');
    expect(detectPeriod('last month expenses', NOW).key).toBe('last_month');
  });
  test('defaults to this month', () => {
    expect(detectPeriod('how much have I spent', NOW).key).toBe('this_month');
  });
});

describe('detectPeriod — Malayalam (prefix-collision regression)', () => {
  test('today (ഇന്ന്) resolves to today, not yesterday', () => {
    const p = detectPeriod('ഇന്ന് എത്ര ചെലവായി', NOW);
    expect(p.key).toBe('today');
    expect(p.range.from).toBe('2026-05-20');
  });
  test('yesterday (ഇന്നലെ) resolves to yesterday', () => {
    const p = detectPeriod('ഇന്നലെ എത്ര ചെലവായി', NOW);
    expect(p.key).toBe('yesterday');
    expect(p.range.from).toBe('2026-05-19');
    expect(p.range.to).toBe('2026-05-19');
  });
  test('this month (ഈ മാസം) and last month (കഴിഞ്ഞ മാസം)', () => {
    expect(detectPeriod('ഈ മാസം എത്ര ചെലവായി', NOW).key).toBe('this_month');
    expect(detectPeriod('കഴിഞ്ഞ മാസം എത്ര ചെലവായി', NOW).key).toBe('last_month');
  });
});

describe('detectPeriod — Hindi', () => {
  test('today (आज) and yesterday (कल)', () => {
    expect(detectPeriod('आज कितना खर्च हुआ', NOW).key).toBe('today');
    expect(detectPeriod('कल कितना खर्च हुआ', NOW).key).toBe('yesterday');
  });
});

describe('canonicalizeCategory', () => {
  test('maps common aliases', () => {
    expect(canonicalizeCategory('food')).toBe('Restaurants');
    expect(canonicalizeCategory('petrol')).toBe('Gas & Fuel');
    expect(canonicalizeCategory('auto')).toBe('Transportation');
    expect(canonicalizeCategory('groceries')).toBe('Groceries');
  });
  test('passes through canonical names', () => {
    expect(canonicalizeCategory('Healthcare')).toBe('Healthcare');
  });
  test('null for unknown / empty', () => {
    expect(canonicalizeCategory('asdf')).toBeNull();
    expect(canonicalizeCategory('')).toBeNull();
    expect(canonicalizeCategory(null)).toBeNull();
  });
});
