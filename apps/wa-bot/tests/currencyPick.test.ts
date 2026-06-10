/**
 * Currency-picker resolver — pure unit tests for `resolvePick`.
 *
 * Locks in the production failure that motivated the L2-2 follow-up fix:
 *   user typed "Omr i think" while the riyal picker was open and the bot
 *   fell through to chat-copilot instead of resolving OMR. The earlier
 *   resolver only matched a WHOLE-message ISO code (`^[a-z]{3}$`); this
 *   suite exercises the new token-level + multi-token tolerance.
 *
 * No DB. No network. No engine. Just the pure resolver.
 */
import { describe, expect, test } from 'bun:test';
import { resolvePick } from '../src/conversations/flows/currencyPick.ts';
import type { CurrencyOption } from '@versifine/shared';

const RIYAL_OPTIONS: CurrencyOption[] = [
  { code: 'SAR', country: 'Saudi Arabia', name: 'Saudi Riyal' },
  { code: 'OMR', country: 'Oman', name: 'Omani Rial' },
  { code: 'QAR', country: 'Qatar', name: 'Qatari Riyal' },
  { code: 'YER', country: 'Yemen', name: 'Yemeni Rial' },
  { code: 'IRR', country: 'Iran', name: 'Iranian Rial' },
];

const DINAR_OPTIONS: CurrencyOption[] = [
  { code: 'KWD', country: 'Kuwait', name: 'Kuwaiti Dinar' },
  { code: 'BHD', country: 'Bahrain', name: 'Bahraini Dinar' },
  { code: 'JOD', country: 'Jordan', name: 'Jordanian Dinar' },
];

describe('resolvePick — bare numeric pick', () => {
  test('"1" → first option (SAR)', () => {
    const v = resolvePick('1', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('SAR');
  });

  test('"5" → fifth option (IRR)', () => {
    const v = resolvePick('5', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('IRR');
  });

  test('"6" → unknown (out of range)', () => {
    expect(resolvePick('6', RIYAL_OPTIONS).kind).toBe('unknown');
  });
});

describe('resolvePick — hedged numeric pick (multi-token)', () => {
  test('"1 i think" → SAR', () => {
    const v = resolvePick('1 i think', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('SAR');
  });

  test('"no 2" → OMR', () => {
    const v = resolvePick('no 2', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('OMR');
  });

  test('"maybe 3 please" → QAR', () => {
    const v = resolvePick('maybe 3 please', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('QAR');
  });

  test('"1 or 2" → unknown (two numeric tokens, ambiguous)', () => {
    expect(resolvePick('1 or 2', RIYAL_OPTIONS).kind).not.toBe('option');
  });
});

describe('resolvePick — country/adjective whole-message', () => {
  test('"saudi" → SAR', () => {
    const v = resolvePick('saudi', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('SAR');
  });

  test('"omani" → OMR', () => {
    const v = resolvePick('omani', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('OMR');
  });

  test('"saudi arabia" → SAR (multi-word country)', () => {
    const v = resolvePick('saudi arabia', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('SAR');
  });

  test('"saudi please!" → SAR (punctuation tolerated)', () => {
    const v = resolvePick('saudi please!', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('SAR');
  });
});

describe('resolvePick — token-level country/adjective', () => {
  test('"i think saudi" → SAR', () => {
    const v = resolvePick('i think saudi', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('SAR');
  });

  test('"omani please" → OMR', () => {
    const v = resolvePick('omani please', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('OMR');
  });
});

describe('resolvePick — token-level ISO code (PRODUCTION FIX)', () => {
  // The production failure: user replied "Omr i think" to a riyal picker
  // and the bot fell through to chat instead of resolving OMR.
  test('"Omr i think" → OMR', () => {
    const v = resolvePick('Omr i think', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('OMR');
  });

  test('"i want OMR" → OMR', () => {
    const v = resolvePick('i want OMR', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('OMR');
  });

  test('"no SAR" → SAR', () => {
    const v = resolvePick('no SAR', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('SAR');
  });

  test('lowercase "qar please" → QAR', () => {
    const v = resolvePick('qar please', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('QAR');
  });

  test('"KWD" bare with dinar options → KWD', () => {
    const v = resolvePick('KWD', DINAR_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('KWD');
  });
});

describe('resolvePick — out-of-set ISO code', () => {
  test('"USD" with riyal options → unknown (re-prompt)', () => {
    expect(resolvePick('USD', RIYAL_OPTIONS).kind).toBe('unknown');
  });

  test('"INR i think" with riyal options → unrelated (release frame)', () => {
    // Multi-token with no country/option match → engine releases the frame
    // and tries to parse "INR i think" fresh. The user can re-trigger the
    // picker by re-stating the original expense if needed.
    expect(resolvePick('INR i think', RIYAL_OPTIONS).kind).toBe('unrelated');
  });
});

describe('resolvePick — bare ambiguous word re-prompt', () => {
  test('"riyal" again → unknown (user is confused, re-prompt)', () => {
    expect(resolvePick('riyal', RIYAL_OPTIONS).kind).toBe('unknown');
  });

  test('"rial" → unknown', () => {
    expect(resolvePick('rial', RIYAL_OPTIONS).kind).toBe('unknown');
  });
});

describe('resolvePick — release frame for unrelated input', () => {
  test('"spent 50 on chai" → unrelated (release the frame)', () => {
    expect(resolvePick('spent 50 on chai', RIYAL_OPTIONS).kind).toBe('unrelated');
  });

  test('long sentence → unrelated', () => {
    expect(
      resolvePick(
        'actually I changed my mind let me think about it more carefully',
        RIYAL_OPTIONS,
      ).kind,
    ).toBe('unrelated');
  });

  test('multi-line collapses to spaces — first matching token wins', () => {
    // tidyAnswer normalises whitespace, so "saudi\nactually no" becomes
    // "saudi actually no" → 3 tokens, "saudi" matches SAR. Documenting
    // the behaviour rather than asserting a particular philosophical
    // stance — short hedged answers always favour the optimistic match.
    const v = resolvePick('saudi\nactually no', RIYAL_OPTIONS);
    expect(v.kind).toBe('option');
    if (v.kind === 'option') expect(v.code).toBe('SAR');
  });

  test('empty/whitespace → unrelated', () => {
    expect(resolvePick('   ', RIYAL_OPTIONS).kind).toBe('unrelated');
  });
});
