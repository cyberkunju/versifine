/**
 * LLM categorizer tier — unit tests.
 *
 * The LLM tier is the "smart" fallback that rescues free-text / code-mixed
 * Indic slang the deterministic tiers miss. We mock the OpenAI client so the
 * test is offline and deterministic, and assert:
 *   1. a valid category in the model's JSON is returned with a confidence;
 *   2. an unknown / hallucinated label falls through to null (never tagged);
 *   3. an expense-disallowed label (Income/Transfers) falls through to null;
 *   4. results are cached (a repeat call doesn't hit the client again).
 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

// We mock the shared OpenAI client module BEFORE importing the tier so the
// tier picks up the fake getOpenAI/isAIConfigured.
let scriptedContent = '{}';
let callCount = 0;

mock.module('../src/services/ai/client.ts', () => ({
  isAIConfigured: () => true,
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          callCount += 1;
          return { choices: [{ message: { content: scriptedContent } }] };
        },
      },
    },
  }),
  normalizeChatParams: (p: unknown) => p,
  withLatency: async <T>(_label: string, fn: () => Promise<T>) => fn(),
}));

const { categorizeWithLLM, __clearLlmCategoryCacheForTests } = await import(
  '../src/services/categorize/llm.ts'
);

beforeEach(() => {
  __clearLlmCategoryCacheForTests();
  callCount = 0;
});

afterEach(() => {
  __clearLlmCategoryCacheForTests();
});

test('returns a valid category from the model JSON', async () => {
  scriptedContent = JSON.stringify({ category: 'Coffee & Beverages', confidence: 0.9 });
  const hit = await categorizeWithLLM('2 cutting chai with the team');
  expect(hit).not.toBeNull();
  expect(hit?.category).toBe('Coffee & Beverages');
  expect(hit?.score).toBeCloseTo(0.9, 5);
});

test('falls through (null) on a hallucinated/unknown label', async () => {
  scriptedContent = JSON.stringify({ category: 'Chai & Snacks', confidence: 0.8 });
  const hit = await categorizeWithLLM('something weird');
  expect(hit).toBeNull();
});

test('falls through (null) on an expense-disallowed label', async () => {
  scriptedContent = JSON.stringify({ category: 'Income', confidence: 0.95 });
  const hit = await categorizeWithLLM('salary credited');
  expect(hit).toBeNull();
});

test('caches results — a repeat call does not hit the client again', async () => {
  scriptedContent = JSON.stringify({ category: 'Transportation', confidence: 0.88 });
  const a = await categorizeWithLLM('auto to office');
  expect(callCount).toBe(1);
  const b = await categorizeWithLLM('auto to office');
  expect(callCount).toBe(1); // served from cache
  expect(a?.category).toBe('Transportation');
  expect(b?.category).toBe('Transportation');
});

test('empty input returns null without calling the client', async () => {
  scriptedContent = JSON.stringify({ category: 'Other', confidence: 0.1 });
  const hit = await categorizeWithLLM('   ');
  expect(hit).toBeNull();
  expect(callCount).toBe(0);
});
