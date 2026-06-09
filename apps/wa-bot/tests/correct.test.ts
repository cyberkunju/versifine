/**
 * Correction-flow detection tests — pure functions, no DB / network.
 *
 * Covers the "act-with-undo" surface the bot exposes for correcting the last
 * transaction:
 *   • amount   ("50 not 40", "actually 230")
 *   • category ("Food not Transport", "change to groceries")
 *   • currency ("its OMR not INR", "make it sar", "actually USD not rupees")
 *
 * Currency corrections are the new path — they used to fall through to the
 * capture flow and force a CONFIRM gate. Now they are recognised here AND
 * applied immediately, with undo as the user's recovery affordance.
 */
import { describe, expect, test } from 'bun:test';
import { looksLikeCorrection } from '../src/conversations/flows/correct.ts';

describe('looksLikeCorrection — currency corrections', () => {
  const yes = [
    'its omr not inr',
    "it's OMR not INR",
    'OMR not INR',
    'omr not inr',
    'sar not rupees',
    'actually USD',
    'actually OMR',
    'make it sar',
    'make it dollars',
    'change to euro',
    'change to OMR',
    'should be SAR',
    'in dollars not rupees',
  ];
  for (const text of yes) {
    test(`detects correction in "${text}"`, () => {
      expect(looksLikeCorrection(text)).toBe(true);
    });
  }

  // Negative — must NOT trigger correction:
  const no = [
    'lent ravi 200',
    'spent 50 on chai',
    'how much did i spend',
    'switch to malayalam', // language change, not currency
    'change language to hindi',
    'I had 4 OMR for coffee', // capture, not correction (no trigger)
    'paid 50 dollars on lunch', // capture, not correction
  ];
  for (const text of no) {
    test(`does NOT trigger correction in "${text}"`, () => {
      expect(looksLikeCorrection(text)).toBe(false);
    });
  }
});

describe('looksLikeCorrection — amount/category corrections still work', () => {
  test('"it was 50 not 40"', () => {
    expect(looksLikeCorrection('it was 50 not 40')).toBe(true);
  });
  test('"sorry 230 ayirunnu"', () => {
    // No English trigger word, so the English regex returns false here —
    // the LLM context-aware path covers Malayalam corrections separately.
    expect(looksLikeCorrection('sorry 230 ayirunnu')).toBe(false);
  });
  test('"actually 250"', () => {
    expect(looksLikeCorrection('actually 250')).toBe(true);
  });
  test('"change to groceries"', () => {
    expect(looksLikeCorrection('change to groceries')).toBe(true);
  });
  test('"that was Food not Transport"', () => {
    expect(looksLikeCorrection('that was Food not Transport')).toBe(true);
  });
});
