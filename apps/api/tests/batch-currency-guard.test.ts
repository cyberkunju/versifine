/**
 * Per-item foreign-currency guard for the batch parser.
 *
 * Locks in the P0 correctness bug found in the brutal review: the old guard
 * ran `textHasForeignCurrencyToken` against the WHOLE message, so a mixed
 * "$100 hotel and 2000 food" kept a hallucinated USD on the ₹2000 food item
 * and booked it as USD 2000 (~₹1.66 lakh). The guard now scopes the check to
 * each item's own `sourceText` span, with a safe fallback to the whole
 * message when no usable span was provided.
 */
import { describe, expect, test } from 'bun:test';
import { __parserFallbacksForTests } from '../src/services/ai/parser.ts';

const { parsedFromLlmData, itemSpan } = __parserFallbacksForTests;

describe('itemSpan — trust echoed sourceText only when it is a real substring', () => {
  const full = '$100 hotel and 2000 food';

  test('substring span is trusted', () => {
    expect(itemSpan({ sourceText: '2000 food' } as never, full)).toBe('2000 food');
  });

  test('substring match is case/whitespace-insensitive', () => {
    expect(itemSpan({ sourceText: '$100   HOTEL' } as never, full)).toBe('$100   HOTEL');
  });

  test('paraphrase that is NOT a substring falls back to whole text', () => {
    expect(itemSpan({ sourceText: 'hotel stay one hundred dollars' } as never, full)).toBe(full);
  });

  test('missing/empty sourceText falls back to whole text', () => {
    expect(itemSpan({} as never, full)).toBe(full);
    expect(itemSpan({ sourceText: '' } as never, full)).toBe(full);
    expect(itemSpan({ sourceText: null } as never, full)).toBe(full);
  });
});

describe('parsedFromLlmData — mixed-currency batch (THE P0 FIX)', () => {
  const full = '$100 hotel and 2000 food';

  test('the rupee item does NOT inherit USD from a sibling item', () => {
    // food item: LLM hallucinated USD, but its own span has no foreign token.
    const food = parsedFromLlmData(
      { type: 'expense', amount: 2000, currency: 'USD', description: 'food', sourceText: '2000 food' } as never,
      full,
    );
    expect(food.currency).toBeNull(); // stripped → defaults to INR downstream
    expect(food.currencyStripped).toBe(true);
    expect(food.originalCurrency).toBeNull();
  });

  test('the foreign item KEEPS its currency (token is in its own span)', () => {
    const hotel = parsedFromLlmData(
      { type: 'expense', amount: 100, currency: 'USD', description: 'hotel', sourceText: '$100 hotel' } as never,
      full,
    );
    expect(hotel.currency).toBe('USD');
    expect(hotel.currencyStripped).toBe(false);
  });
});

describe('parsedFromLlmData — global currency declaration', () => {
  // "in dollars: 100 hotel, 50 food" — the model is instructed to repeat the
  // currency word into each item's sourceText, so both keep USD.
  test('both items keep USD when the currency word is repeated into each span', () => {
    const a = parsedFromLlmData(
      { type: 'expense', amount: 100, currency: 'USD', description: 'hotel', sourceText: '$100 hotel' } as never,
      'in dollars: 100 hotel, 50 food',
    );
    const b = parsedFromLlmData(
      { type: 'expense', amount: 50, currency: 'USD', description: 'food', sourceText: '$50 food' } as never,
      'in dollars: 100 hotel, 50 food',
    );
    expect(a.currency).toBe('USD');
    expect(b.currency).toBe('USD');
  });
});

describe('parsedFromLlmData — pure INR batch is unaffected', () => {
  test('plain rupee items stay INR (null currency)', () => {
    const item = parsedFromLlmData(
      { type: 'expense', amount: 450, currency: null, description: 'auto', sourceText: '450 auto' } as never,
      '450 auto and 200 chai',
    );
    expect(item.currency).toBeNull();
    expect(item.currencyStripped).toBe(false);
  });
});

describe('parsedFromLlmData — fallback to whole text (no span) preserves old behaviour', () => {
  test('single foreign item with no sourceText still honours its currency', () => {
    const item = parsedFromLlmData(
      { type: 'expense', amount: 50, currency: 'USD', description: 'lunch' } as never,
      'spent 50 dollars on lunch',
    );
    expect(item.currency).toBe('USD');
  });
});
