/**
 * Open-frame primitive — pure unit tests.
 *
 * Covers the frame lifecycle (open / read / TTL expiry / clear), the verdict
 * matrix (consumed / unknown / unrelated), the universal-cancel guard, and
 * the retry counter / max-retries auto-clear.
 *
 * No DB. No network. No bot engine. We use the REAL state.ts module so we
 * don't pollute other test files' module-mock state — `_resetAllSessions`
 * keeps the in-memory map clean between tests. Resolvers are registered
 * locally (we don't call bootstrapResolvers, which would pull in the real
 * currencyPick → apiClient chain).
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import {
  _resetAllSessions,
  getSession,
  updateSession,
} from '../src/conversations/state.ts';
import type { FrameKind } from '../src/conversations/openFrame.ts';
import {
  clearOpenFrame,
  getOpenFrame,
  hasOpenFrame,
  openFrame,
  registerResolver,
  tryResolveFrame,
} from '../src/conversations/openFrame.ts';

let phoneCounter = 0;
function freshSession(language: 'en' | 'hi' | 'ml' = 'en') {
  phoneCounter += 1;
  const phone = `91999990${String(phoneCounter).padStart(4, '0')}`;
  const s = getSession(phone, { language, state: 'LINKED_MAIN' });
  s.linked = true;
  return s;
}

beforeAll(() => {
  _resetAllSessions();
});

afterEach(() => {
  _resetAllSessions();
});

describe('openFrame primitive — lifecycle', () => {
  test('open + read returns the same frame', () => {
    const s = freshSession();
    openFrame(s, {
      kind: 'currency_choice',
      prompt: 'which riyal?',
      options: [{ id: 'SAR', label: 'Saudi Riyal' }],
      context: { draftId: 'd1' },
    });
    const f = getOpenFrame(s);
    expect(f).not.toBeNull();
    expect(f!.kind).toBe('currency_choice');
    expect(f!.prompt).toBe('which riyal?');
    expect(f!.context.draftId).toBe('d1');
    expect(f!.retries).toBe(0);
    expect(f!.v).toBe(1);
  });

  test('hasOpenFrame mirrors getOpenFrame', () => {
    const s = freshSession();
    expect(hasOpenFrame(s)).toBe(false);
    openFrame(s, { kind: 'wallet_choice', prompt: 'which wallet?', context: {} });
    expect(hasOpenFrame(s)).toBe(true);
    clearOpenFrame(s, 'test');
    expect(hasOpenFrame(s)).toBe(false);
  });

  test('expired frame reads as null', () => {
    const s = freshSession();
    openFrame(s, {
      kind: 'currency_choice',
      prompt: 'which riyal?',
      ttlMs: 1,
      context: {},
    });
    (s.pending.openFrame as any).ts = Date.now() - 1000;
    expect(getOpenFrame(s)).toBeNull();
  });

  test('frame with mismatched version reads as null', () => {
    const s = freshSession();
    openFrame(s, { kind: 'currency_choice', prompt: 'which?', context: {} });
    (s.pending.openFrame as any).v = 999;
    expect(getOpenFrame(s)).toBeNull();
  });

  test('clearOpenFrame is safe when no frame is set', () => {
    const s = freshSession();
    expect(() => clearOpenFrame(s)).not.toThrow();
    expect(s.pending.openFrame).toBeUndefined();
  });

  test('open replaces an existing frame', () => {
    const s = freshSession();
    openFrame(s, { kind: 'currency_choice', prompt: 'first', context: { i: 1 } });
    openFrame(s, { kind: 'wallet_choice', prompt: 'second', context: { i: 2 } });
    const f = getOpenFrame(s);
    expect(f!.kind).toBe('wallet_choice');
    expect(f!.context.i).toBe(2);
  });
});

// Use a kind that DOESN'T have a real resolver registered so we can register
// our fake without colliding with the production currency_choice resolver
// (which wouldn't be registered anyway since we don't bootstrap, but using
// `amount_clarify` is defensive against future bootstrap leakage).
const TEST_KIND: FrameKind = 'amount_clarify';

describe('openFrame primitive — tryResolveFrame', () => {
  test('returns null when no frame is open', async () => {
    const s = freshSession();
    const res = await tryResolveFrame(s, 'anything');
    expect(res).toBeNull();
  });

  test('universal cancel always wins, regardless of resolver', async () => {
    const s = freshSession();
    let resolverCalled = false;
    registerResolver(TEST_KIND, async () => {
      resolverCalled = true;
      return { kind: 'consumed', text: 'should not see this' };
    });
    openFrame(s, { kind: TEST_KIND, prompt: 'how much?', context: {} });
    const res = await tryResolveFrame(s, 'cancel');
    expect(res).not.toBeNull();
    expect(res!.text).toContain('Cancelled');
    expect(resolverCalled).toBe(false);
    expect(hasOpenFrame(s)).toBe(false);
  });

  test('cancel is case-insensitive and tolerates trailing punctuation', async () => {
    const s = freshSession();
    registerResolver(TEST_KIND, async () => ({
      kind: 'consumed',
      text: 'unreachable',
    }));
    openFrame(s, { kind: TEST_KIND, prompt: 'how much?', context: {} });
    const res = await tryResolveFrame(s, '  CANCEL!! ');
    expect(res!.text).toContain('Cancelled');
    expect(hasOpenFrame(s)).toBe(false);
  });

  test('Malayalam "venda" cancels the frame', async () => {
    const s = freshSession('ml');
    registerResolver(TEST_KIND, async () => ({
      kind: 'consumed',
      text: 'unreachable',
    }));
    openFrame(s, { kind: TEST_KIND, prompt: 'how much?', context: {} });
    const res = await tryResolveFrame(s, 'venda');
    expect(res!.text).toContain('Cancelled');
    expect(hasOpenFrame(s)).toBe(false);
  });

  test('consumed verdict clears the frame', async () => {
    const s = freshSession();
    registerResolver(TEST_KIND, async () => ({ kind: 'consumed', text: 'logged' }));
    openFrame(s, { kind: TEST_KIND, prompt: 'how much?', context: {} });
    const res = await tryResolveFrame(s, '500');
    expect(res!.text).toBe('logged');
    expect(res!.consumed).toBe(true);
    expect(hasOpenFrame(s)).toBe(false);
  });

  test('unknown verdict keeps the frame open and increments retries', async () => {
    const s = freshSession();
    registerResolver(TEST_KIND, async () => ({ kind: 'unknown', text: 'try again' }));
    openFrame(s, { kind: TEST_KIND, prompt: 'how much?', context: {} });
    const r1 = await tryResolveFrame(s, 'maybe');
    expect(r1!.text).toBe('try again');
    expect(hasOpenFrame(s)).toBe(true);
    expect(getOpenFrame(s)!.retries).toBe(1);
    const r2 = await tryResolveFrame(s, 'still vague');
    expect(r2!.text).toBe('try again');
    expect(getOpenFrame(s)!.retries).toBe(2);
  });

  test('unknown verdict at MAX_RETRIES auto-clears the frame', async () => {
    const s = freshSession();
    registerResolver(TEST_KIND, async () => ({ kind: 'unknown', text: 'try again' }));
    openFrame(s, { kind: TEST_KIND, prompt: 'how much?', context: {} });
    await tryResolveFrame(s, 'one');
    await tryResolveFrame(s, 'two');
    const r3 = await tryResolveFrame(s, 'three');
    expect(r3!.text).toContain('Cancelled');
    expect(hasOpenFrame(s)).toBe(false);
  });

  test('unrelated verdict clears the frame and returns null (engine continues)', async () => {
    const s = freshSession();
    registerResolver(TEST_KIND, async () => ({ kind: 'unrelated' }));
    openFrame(s, { kind: TEST_KIND, prompt: 'how much?', context: {} });
    const res = await tryResolveFrame(s, 'spent 50 on chai');
    expect(res).toBeNull();
    expect(hasOpenFrame(s)).toBe(false);
  });

  test('resolver crash is logged + frame retained + safe error reply', async () => {
    const s = freshSession();
    registerResolver(TEST_KIND, async () => {
      throw new Error('boom');
    });
    openFrame(s, { kind: TEST_KIND, prompt: 'how much?', context: {} });
    const res = await tryResolveFrame(s, 'anything');
    expect(res).not.toBeNull();
    expect(res!.text).toMatch(/try again/i);
    expect(hasOpenFrame(s)).toBe(true);
  });

  test('frame with no registered resolver clears + returns null', async () => {
    const s = freshSession();
    openFrame(s, { kind: 'category_choice', prompt: 'which category?', context: {} });
    const res = await tryResolveFrame(s, 'food');
    expect(res).toBeNull();
    expect(hasOpenFrame(s)).toBe(false);
  });

  test('expired frame is treated as no-frame', async () => {
    const s = freshSession();
    let resolverCalled = false;
    registerResolver(TEST_KIND, async () => {
      resolverCalled = true;
      return { kind: 'consumed', text: 'unreachable' };
    });
    openFrame(s, { kind: TEST_KIND, prompt: 'how much?', context: {}, ttlMs: 1 });
    (s.pending.openFrame as any).ts = Date.now() - 1000;
    const res = await tryResolveFrame(s, '500');
    expect(res).toBeNull();
    expect(resolverCalled).toBe(false);
  });
});

// Suppress unused-variable warnings for the imported helper that's only used
// implicitly via getSession (state.ts owns the in-memory map; updateSession is
// called by the primitive itself).
void updateSession;
