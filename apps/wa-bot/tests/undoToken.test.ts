/**
 * Token-undo extraction (L2-2) — pure unit tests.
 *
 * The detector must recognise a 6-char undo token (bare or prefixed with
 * "undo"/"oops"/etc.) WITHOUT false-positiving on real expenses or 6-letter
 * English words that happen to use the token alphabet.
 */
import { describe, expect, test } from 'bun:test';
import { extractUndoToken, looksLikeUndoToken } from '../src/conversations/flows/undoToken.ts';

describe('extractUndoToken — valid tokens', () => {
  // Every real token has ≥1 digit (API guarantee) and ≥1 letter.
  const tokens = ['K7P2A9', 'XYZ234', 'HJ2KMN', 'A2B3C4', 'P9Q8R7'];
  for (const t of tokens) {
    test(`bare "${t}" → ${t}`, () => {
      expect(extractUndoToken(t)).toBe(t);
    });
  }

  test('lowercase is upper-cased', () => {
    expect(extractUndoToken('k7p2a9')).toBe('K7P2A9');
  });

  test('surrounding whitespace tolerated', () => {
    expect(extractUndoToken('  K7P2A9  ')).toBe('K7P2A9');
  });

  test('"undo K7P2A9" prefix', () => {
    expect(extractUndoToken('undo K7P2A9')).toBe('K7P2A9');
  });

  test('"oops K7P2A9" prefix', () => {
    expect(extractUndoToken('oops K7P2A9')).toBe('K7P2A9');
  });

  test('"revert A2B3C4" prefix', () => {
    expect(extractUndoToken('revert A2B3C4')).toBe('A2B3C4');
  });

  test('case-insensitive prefix + token', () => {
    expect(extractUndoToken('UNDO k7p2a9')).toBe('K7P2A9');
  });
});

describe('extractUndoToken — rejections (no false positives)', () => {
  const nonTokens = [
    'spent 50 on coffee',
    'CONFIRM',
    'CANCEL',
    'hello',
    '5 riyal coffee',
    'BUDGET', // all-letters — no digit → never a token (the key false-positive guard)
    'ABCDEF', // all-letters, valid glyphs, but no digit → rejected
    'K7P2A', // 5 chars
    'K7P2A99', // 7 chars
    'K7P2A0', // contains 0 (excluded glyph)
    'K7P2AO', // contains O (excluded glyph)
    'K7P2A1', // contains 1 (excluded glyph)
    'K7P2AI', // contains I (excluded glyph)
    'K7P2AL', // contains L (excluded glyph)
    '123456', // contains 1 (excluded glyph)
    '234567', // all-digits, no letter → an amount/OTP, not a token
    'how much did I spend',
    'undo', // bare undo, no token (goes to the normal undo flow)
    'undo my last expense', // not a token
    'undo BUDGET', // prefixed but no digit → not a real token
  ];
  for (const t of nonTokens) {
    test(`"${t}" → null`, () => {
      expect(extractUndoToken(t)).toBeNull();
    });
  }
});

describe('looksLikeUndoToken', () => {
  test('true for a bare token', () => {
    expect(looksLikeUndoToken('K7P2A9')).toBe(true);
  });
  test('true for a prefixed token', () => {
    expect(looksLikeUndoToken('undo K7P2A9')).toBe(true);
  });
  test('false for a plain expense', () => {
    expect(looksLikeUndoToken('spent 50 on chai')).toBe(false);
  });
  test('false for bare "undo" (handled by the recency-undo flow)', () => {
    expect(looksLikeUndoToken('undo')).toBe(false);
  });
});
