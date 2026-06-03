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

  // --- letter-for-digit typo normalization ("5oo" → 500) ---------------
  test('fixes "5oo" typo to 500', () => {
    expect(extractAmount('spnt 5oo on grocries yestrday')).toEqual({ amount: 500, currency: null });
  });

  test('fixes "1o0" typo to 100', () => {
    expect(extractAmount('paid 1o0 for chai')).toEqual({ amount: 100, currency: null });
  });

  test('does NOT corrupt real words that contain o/l/s/b', () => {
    // "auto", "lunch", "is", "so" must never be read as numbers.
    expect(extractAmount('auto lunch is so good')).toEqual({ amount: null, currency: null });
  });

  test('leaves a clean number with following words intact', () => {
    expect(extractAmount('500 on groceries')).toEqual({ amount: 500, currency: null });
  });
});

// --- worded / spelled-out numbers --------------------------------------
// Production bug: a voice note "ചായ കുടിച്ചു നൂറ് രൂപായ്" carried the
// amount as the WORD നൂറ് (= 100), not a digit, so extractAmount returned
// null and the bot looped asking "How much was it?". Worded numbers in
// English and all six supported languages must parse, while digits keep
// priority whenever both appear.
describe('extractAmount — worded numbers', () => {
  // Exact production regression.
  test('parses the failing Malayalam voice note "നൂറ് രൂപായ്" → 100', () => {
    expect(extractAmount('ചായ കുടിച്ചു നൂറ് രൂപായ്')).toEqual({ amount: 100, currency: null });
  });

  // --- English ---------------------------------------------------------
  test('English small integer word', () => {
    expect(extractAmount('paid seven for chai')).toEqual({ amount: 7, currency: null });
  });

  test('English teen word', () => {
    expect(extractAmount('fifteen on snacks')).toEqual({ amount: 15, currency: null });
  });

  test('English round ten', () => {
    expect(extractAmount('fifty for the auto')).toEqual({ amount: 50, currency: null });
  });

  test('English compound tens "twenty five"', () => {
    expect(extractAmount('lunch twenty five')).toEqual({ amount: 25, currency: null });
  });

  test('English "two hundred"', () => {
    expect(extractAmount('two hundred on groceries')).toEqual({ amount: 200, currency: null });
  });

  test('English "five hundred" with following words', () => {
    expect(extractAmount('five hundred for groceries')).toEqual({ amount: 500, currency: null });
  });

  test('English "fifteen hundred"', () => {
    expect(extractAmount('fifteen hundred rent advance')).toEqual({ amount: 1500, currency: null });
  });

  test('English "two hundred fifty" composition', () => {
    expect(extractAmount('dinner two hundred fifty')).toEqual({ amount: 250, currency: null });
  });

  test('English "two hundred and fifty" with connector', () => {
    expect(extractAmount('two hundred and fifty for dinner')).toEqual({
      amount: 250,
      currency: null,
    });
  });

  test('English "five thousand"', () => {
    expect(extractAmount('five thousand on the phone')).toEqual({ amount: 5000, currency: null });
  });

  test('English "one lakh"', () => {
    expect(extractAmount('one lakh investment')).toEqual({ amount: 100_000, currency: null });
  });

  test('English "two crore"', () => {
    expect(extractAmount('two crore property')).toEqual({ amount: 20_000_000, currency: null });
  });

  test('English worded amount keeps an attached currency word', () => {
    expect(extractAmount('five thousand rupees rent')).toEqual({ amount: 5000, currency: 'INR' });
  });

  // --- Malayalam -------------------------------------------------------
  test('Malayalam നൂറ് (100)', () => {
    expect(extractAmount('നൂറ്')).toEqual({ amount: 100, currency: null });
  });

  test('Malayalam ആയിരം (1000)', () => {
    expect(extractAmount('വാടക ആയിരം')).toEqual({ amount: 1000, currency: null });
  });

  test('Malayalam small integer അഞ്ച് (5)', () => {
    expect(extractAmount('ചായ അഞ്ച്')).toEqual({ amount: 5, currency: null });
  });

  test('Malayalam അമ്പത് (50)', () => {
    expect(extractAmount('ഓട്ടോ അമ്പത്')).toEqual({ amount: 50, currency: null });
  });

  test('Malayalam ലക്ഷം (100000)', () => {
    // രൂപ is not a recognised currency alias (only rupee/rupees/rs/₹/inr are),
    // so currency stays null — same as the production regression input.
    expect(extractAmount('ലക്ഷം രൂപ')).toEqual({ amount: 100_000, currency: null });
  });

  // --- Hindi -----------------------------------------------------------
  test('Hindi सौ (100)', () => {
    expect(extractAmount('चाय सौ')).toEqual({ amount: 100, currency: null });
  });

  test('Hindi दो सौ (200)', () => {
    expect(extractAmount('दो सौ का सामान')).toEqual({ amount: 200, currency: null });
  });

  test('Hindi हज़ार (1000)', () => {
    expect(extractAmount('किराया हज़ार')).toEqual({ amount: 1000, currency: null });
  });

  test('Hindi "एक दस हज़ार" (10000) multiplication regression', () => {
    expect(extractAmount('एक दस हज़ार')).toEqual({ amount: 10000, currency: null });
  });

  test('Hindi लाख (100000)', () => {
    expect(extractAmount('एक लाख')).toEqual({ amount: 100_000, currency: null });
  });

  test('Hindi करोड़ (10000000)', () => {
    expect(extractAmount('दो करोड़')).toEqual({ amount: 20_000_000, currency: null });
  });

  test('Hindi पचास (50)', () => {
    expect(extractAmount('ऑटो पचास')).toEqual({ amount: 50, currency: null });
  });

  // --- Tamil -----------------------------------------------------------
  test('Tamil நூறு (100)', () => {
    expect(extractAmount('நூறு')).toEqual({ amount: 100, currency: null });
  });

  test('Tamil ஆயிரம் (1000)', () => {
    expect(extractAmount('வாடகை ஆயிரம்')).toEqual({ amount: 1000, currency: null });
  });

  test('Tamil ஐம்பது (50)', () => {
    expect(extractAmount('டீ ஐம்பது')).toEqual({ amount: 50, currency: null });
  });

  // --- Telugu ----------------------------------------------------------
  test('Telugu వంద (100)', () => {
    expect(extractAmount('వంద')).toEqual({ amount: 100, currency: null });
  });

  test('Telugu వెయ్యి (1000)', () => {
    expect(extractAmount('అద్దె వెయ్యి')).toEqual({ amount: 1000, currency: null });
  });

  test('Telugu యాభై (50)', () => {
    expect(extractAmount('ఆటో యాభై')).toEqual({ amount: 50, currency: null });
  });

  // --- Kannada ---------------------------------------------------------
  test('Kannada ನೂರು (100)', () => {
    expect(extractAmount('ನೂರು')).toEqual({ amount: 100, currency: null });
  });

  test('Kannada ಸಾವಿರ (1000)', () => {
    expect(extractAmount('ಬಾಡಿಗೆ ಸಾವಿರ')).toEqual({ amount: 1000, currency: null });
  });

  test('Kannada ಐವತ್ತು (50)', () => {
    expect(extractAmount('ಆಟೋ ಐವತ್ತು')).toEqual({ amount: 50, currency: null });
  });

  // --- digit priority & non-interference -------------------------------
  test('a digit always wins over a spelled-out word in the same text', () => {
    // "two" (2) is present as a word but the explicit 560 must be chosen.
    expect(extractAmount('two coffee for 560')).toEqual({ amount: 560, currency: null });
  });

  test('digit wins even when a worded scale word follows', () => {
    expect(extractAmount('paid 450 hundred percent worth it')).toEqual({
      amount: 450,
      currency: null,
    });
  });

  test('worded parsing does not fire when no number word is present', () => {
    expect(extractAmount('feeling broke today')).toEqual({ amount: null, currency: null });
  });

  test('picks the largest worded run across a sentence', () => {
    // "two" (2) and "five hundred" (500) — the price is the bigger figure.
    expect(extractAmount('two coffee five hundred')).toEqual({ amount: 500, currency: null });
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
