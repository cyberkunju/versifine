/**
 * Regression: the "How much was it?" infinite loop.
 *
 * Production repro (from screenshots): a voice note became a low-confidence
 * expense draft with a description ("chai") but no amount, so the bot asked
 * "How much was it?". The user replied "100". The bot asked "How much was
 * it?" AGAIN — forever.
 *
 * Root cause: POST /capture/confirm received the clarifier in the `text`
 * field and did `JSON.parse(text)`. A bare "100" is itself VALID JSON — it
 * parses to the NUMBER 100, not an object — so the `typeof === 'object'`
 * guard failed, the clarifier was silently dropped, `amount` stayed null, and
 * the route re-stashed the draft and re-asked the same question every round.
 *
 * The fix routes a free-form clarifier through `resolveClarifier`, which runs
 * the deterministic regex extractors so a bare number ALWAYS fills the amount
 * and a bare noun ALWAYS fills the description — no LLM required. These tests
 * exercise that pure path plus the draft-store loop-cap fields, with no DB and
 * no network.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { resolveClarifier } from '../src/routes/capture.ts';
import type { ParsedExpense } from '../src/services/ai/parser.ts';
import { _resetDraftStoreForTests, getDraft, storeDraft } from '../src/services/capture/drafts.ts';

/** A pending draft from a low-confidence voice note: has a description, no amount. */
function draftMissingAmount(overrides: Partial<ParsedExpense> = {}): ParsedExpense {
  return {
    type: 'expense',
    amount: null,
    currency: null,
    description: 'chai',
    categoryHint: 'coffee',
    walletHint: null,
    date: null,
    splitPeople: null,
    originalAmount: null,
    originalCurrency: null,
    confidence: 0.4,
    needs: ['amount', 'wallet', 'currency'],
    ...overrides,
  };
}

/** The route's loop guard: it only re-asks while amount or description is null. */
function wouldLoop(draft: ParsedExpense): boolean {
  return draft.amount === null || !draft.description;
}

function applyEdits(draft: ParsedExpense, edits: Partial<ParsedExpense>): ParsedExpense {
  return { ...draft, ...edits } as ParsedExpense;
}

describe('resolveClarifier — bare-number clarifier fills the missing amount (no loop)', () => {
  test('"100" on a draft missing the amount sets amount=100', () => {
    const draft = draftMissingAmount();
    const { isJsonEdits, edits } = resolveClarifier(draft, '100');

    // A bare number is NOT treated as a JSON edits object …
    expect(isJsonEdits).toBe(false);
    // … and the deterministic pass fills the amount the user just gave.
    expect(edits.amount).toBe(100);

    const merged = applyEdits(draft, edits);
    expect(merged.amount).toBe(100);
    expect(merged.description).toBe('chai');
    // The whole point: after answering "100" the draft is no longer stuck.
    expect(wouldLoop(merged)).toBe(false);
  });

  test('the OLD JSON.parse-only logic would have dropped "100" (documents the bug)', () => {
    // This is exactly what the buggy code did. It is here to prove the bug was
    // real and that the regex path is what saves us.
    const parsed = JSON.parse('100');
    const treatedAsEdits = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    expect(treatedAsEdits).toBe(false); // object guard fails → clarifier dropped

    // Our resolver, by contrast, extracts the amount.
    expect(resolveClarifier(draftMissingAmount(), '100').edits.amount).toBe(100);
  });

  const numericForms: Array<[string, number, string | null]> = [
    ['100', 100, null],
    ['200', 200, null],
    ['rs 100', 100, 'INR'],
    ['₹100', 100, 'INR'],
    ['200 rupees', 200, 'INR'],
    ['1.5k', 1500, null],
    ['rs.50', 50, 'INR'],
  ];
  for (const [text, amount, currency] of numericForms) {
    test(`"${text}" → amount ${amount}${currency ? `, currency ${currency}` : ''}`, () => {
      const draft = draftMissingAmount();
      const { edits } = resolveClarifier(draft, text);
      expect(edits.amount).toBe(amount);
      if (currency) expect(edits.currency).toBe(currency);
      expect(wouldLoop(applyEdits(draft, edits))).toBe(false);
    });
  }
});

describe('resolveClarifier — noun clarifier fills the missing description', () => {
  test('"groceries" on a draft missing the description sets it', () => {
    const draft = draftMissingAmount({ amount: 450, description: null, needs: ['description'] });
    const { isJsonEdits, edits } = resolveClarifier(draft, 'groceries');
    expect(isJsonEdits).toBe(false);
    expect(edits.description).toBe('groceries');
    const merged = applyEdits(draft, edits);
    expect(merged.amount).toBe(450);
    expect(wouldLoop(merged)).toBe(false);
  });

  test('"auto" never overwrites an amount the draft already had', () => {
    const draft = draftMissingAmount({ amount: 80, description: null });
    const { edits } = resolveClarifier(draft, 'auto');
    expect(edits.amount).toBe(80);
    expect(edits.description).toBe('auto');
  });
});

describe('resolveClarifier — preserves the web omnibar JSON-edits path', () => {
  test('a JSON object is still parsed as structured edits', () => {
    const draft = draftMissingAmount();
    const { isJsonEdits, edits } = resolveClarifier(draft, '{"amount": 250, "category": "food"}');
    expect(isJsonEdits).toBe(true);
    expect(edits.amount).toBe(250);
    expect(edits.categoryHint).toBe('food');
  });

  test('an existing draft amount is never clobbered by a clarifier', () => {
    const draft = draftMissingAmount({ amount: 999, description: null });
    const { edits } = resolveClarifier(draft, '100');
    // amount already known → keep it; the "100" cannot overwrite it.
    expect(edits.amount).toBe(999);
  });
});

describe('anti-loop — the bot never re-asks the field the user just answered', () => {
  test('a draft missing both amount and description converges in two rounds', () => {
    // Round 1: draft missing both. Bot asked for amount first (priority order).
    let draft = draftMissingAmount({ description: null, needs: ['amount', 'description'] });
    expect(wouldLoop(draft)).toBe(true);

    // User answers the amount: "100".
    draft = applyEdits(draft, resolveClarifier(draft, '100').edits);
    expect(draft.amount).toBe(100);
    // Still missing description, so it MUST now ask for description — not amount.
    expect(draft.description).toBeNull();

    // Round 2: user answers the description: "groceries".
    draft = applyEdits(draft, resolveClarifier(draft, 'groceries').edits);
    expect(draft.description).toBe('groceries');
    expect(draft.amount).toBe(100);
    // Both required fields present → no further looping.
    expect(wouldLoop(draft)).toBe(false);
  });
});

describe('draft store — carries the loop-cap counter across re-stashes', () => {
  afterEach(() => {
    _resetDraftStoreForTests();
  });

  test('clarifyRounds defaults to 0 and lastAsked to null', () => {
    const rec = storeDraft({
      spaceId: 'space-1',
      userId: 'user-1',
      origin: 'voice',
      source: 'chai',
      draft: draftMissingAmount(),
    });
    expect(rec.clarifyRounds).toBe(0);
    expect(rec.lastAsked).toBeNull();
  });

  test('a re-stash can advance the round counter and record the asked field', () => {
    const rec = storeDraft({
      spaceId: 'space-1',
      userId: 'user-1',
      origin: 'voice',
      source: 'chai',
      draft: draftMissingAmount(),
      clarifyRounds: 2,
      lastAsked: 'amount',
    });
    const fetched = getDraft(rec.id);
    expect(fetched?.clarifyRounds).toBe(2);
    expect(fetched?.lastAsked).toBe('amount');
  });
});
