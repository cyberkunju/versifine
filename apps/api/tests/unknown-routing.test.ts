/**
 * Regression: the "unknown intent → copilot" hallucination.
 *
 * Production repro (from logs): a linked user sends a bare food/expense word
 * like "chai" (no amount) or a bare number like "100". The intent classifier
 * returns intent="unknown" (confidence ~0.2). The capture route then routed
 * EVERY non-transaction, non-query intent — including "unknown" — to the
 * finance copilot. Result:
 *   - "chai" → copilot HALLUCINATED "you've spent ₹100 on chai today" (it
 *     invented an amount — unacceptable for a finance app).
 *   - "100"  → copilot refused with "I can't assist with that."
 *
 * Correct behavior: a clear spend word or a bare amount must NEVER reach the
 * copilot. "chai" should become an expense DRAFT that asks "How much was it?";
 * "100" must not be refused or hallucinated.
 *
 * The fix adds a deterministic, offline routing guard — `isExpenseLike(text)`
 * in routes/capture.ts — that the pipeline consults BEFORE deferring an
 * unknown/chat message to the copilot. This file unit-tests that pure helper
 * (no DB, no network) plus the classifier's offline regex fallback, so the
 * routing DECISION is proven deterministically without calling the real model.
 *
 * We mock the OpenAI client to be UNCONFIGURED before importing anything that
 * touches it, so `parseExpense` runs its deterministic offline path and the
 * whole suite is hermetic — exactly what the bug-repro note asks for ("many
 * tests can't call the real LLM — structure your test around the routing
 * decision").
 */
import { describe, expect, mock, test } from 'bun:test';

// Force the AI surface offline so every assertion below is deterministic and
// network-free. `isExpenseLike` never needs the LLM (it uses the regex amount
// extractor + the curated merchant catalogue); `parseExpense` falls back to
// its deterministic regex/description path. Both are what production relies on
// when the model is unavailable, so this also proves the offline guarantee.
mock.module('../src/services/ai/client.ts', () => ({
  isAIConfigured: () => false,
  getOpenAI: () => null,
  normalizeChatParams: (p: unknown) => p,
  withLatency: async <T>(_label: string, fn: () => Promise<T>) => fn(),
}));

const { isExpenseLike } = await import('../src/routes/capture.ts');
const { extractAmount } = await import('../src/services/ai/parserRegex.ts');
const { parseExpense } = await import('../src/services/ai/parser.ts');
const { categorizeFromMerchantDB } = await import('../src/services/categorize/merchants.ts');
const { normalizeMerchant } = await import('../src/services/transactions/normalize.ts');
const { classifyIntent, __clearIntentCacheForTests } = await import(
  '../src/services/ai/intent.ts'
);

describe('isExpenseLike — a bare spend word is an expense, NOT chat/copilot', () => {
  // The headline bug: each of these used to be classified "unknown" and shipped
  // to the copilot. They are clear food/drink/transport/shopping words and must
  // be recognized as expense-like so the route turns them into a draft instead.
  const spendWords = ['chai', 'dosa', 'auto', 'groceries', 'petrol', 'lunch', 'swiggy'];
  for (const word of spendWords) {
    test(`"${word}" is expense-like`, () => {
      expect(isExpenseLike(word)).toBe(true);
    });
  }

  test('the curated catalogue is the offline discriminator for "chai"', () => {
    // Documents WHY "chai" is expense-like with no amount and no LLM: the
    // India-first merchant/category catalogue recognizes it as a real spend.
    const hit = categorizeFromMerchantDB(normalizeMerchant('chai'));
    expect(hit).not.toBeNull();
    expect(hit?.category).not.toBe('Other');
  });

  test('a clear food word is never sent to the copilot (no amount invented)', () => {
    // "chai" has no number in it — the guard must NOT manufacture one.
    expect(extractAmount('chai').amount).toBeNull();
    // …yet it is still expense-like, so the route drafts + asks "how much?".
    expect(isExpenseLike('chai')).toBe(true);
  });
});

describe('isExpenseLike — a bare number is expense-like, NEVER a copilot refusal', () => {
  const bareNumbers = ['100', '250', '₹120', 'rs 90', '1.5k'];
  for (const text of bareNumbers) {
    test(`"${text}" is expense-like`, () => {
      expect(isExpenseLike(text)).toBe(true);
      // And it carries a real extracted amount — nothing is invented.
      expect(extractAmount(text).amount).not.toBeNull();
    });
  }
});

describe('isExpenseLike — real expense utterances stay expense-like', () => {
  const utterances = ['spent 450 on auto', 'swiggy 425', '₹120 coffee', '200 chai pe kharch'];
  for (const text of utterances) {
    test(`"${text}" is expense-like`, () => {
      expect(isExpenseLike(text)).toBe(true);
    });
  }
});

describe('isExpenseLike — genuine chat / finance questions stay chat', () => {
  // These have no amount and hit no spend word, so they are NOT expense-like
  // and the route correctly defers them to the finance copilot.
  const chatty = [
    'hi',
    'hello',
    'how do i save money',
    'how do i start an emergency fund',
    'should i invest in mutual funds',
    'explain SIP to me',
  ];
  for (const text of chatty) {
    test(`"${text}" is NOT expense-like`, () => {
      expect(isExpenseLike(text)).toBe(false);
    });
  }
});

describe('parseExpense — a bare food word drafts a description but no amount', () => {
  // The draft path the route runs for a rescued "chai": offline, the parser's
  // deterministic fallback still yields a usable description and leaves amount
  // null so the clarifier asks "How much was it?" — it must NOT fabricate one.
  test('"chai" → description present, amount null, needs amount', async () => {
    const parsed = await parseExpense({ text: 'chai' });
    expect(parsed.amount).toBeNull();
    expect(parsed.description).toBe('chai');
    expect(parsed.needs).toContain('amount');
  });
});

describe('classifyIntent (offline regex fallback) — bare spend words lean expense, not chat', () => {
  test('"chai" classifies as expense, never chat/unknown', async () => {
    __clearIntentCacheForTests();
    const result = await classifyIntent({ text: 'chai' });
    expect(result.source).toBe('regex'); // proves we exercised the offline path
    expect(result.intent).toBe('expense');
    expect(result.amount).toBeNull(); // never invents an amount
  });

  test('"100" (bare number) classifies as expense, never chat', async () => {
    __clearIntentCacheForTests();
    const result = await classifyIntent({ text: '100' });
    expect(result.intent).toBe('expense');
  });

  test('"how do i save money" stays chat', async () => {
    __clearIntentCacheForTests();
    const result = await classifyIntent({ text: 'how do i save money' });
    expect(result.intent).toBe('chat');
  });

  test('"hi" stays a greeting (unknown), not an expense', async () => {
    __clearIntentCacheForTests();
    const result = await classifyIntent({ text: 'hi' });
    expect(result.intent).toBe('unknown');
  });
});
