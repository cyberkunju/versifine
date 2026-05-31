/**
 * Dynamic demo allowlist + demo-request phrase detection.
 *
 * Covers the "Chat on WhatsApp" demo-access flow:
 *   - the exact landing-page phrase is recognised (and tolerant of case,
 *     punctuation, smart quotes, and stray whitespace),
 *   - ordinary messages are NOT mistaken for the phrase,
 *   - adding a number persists to disk and survives a "restart" (re-import
 *     via the in-memory reset + reload from the same file).
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the store at a throwaway temp file BEFORE importing config/allowlist.
const TMP_DIR = mkdtempSync(join(tmpdir(), 'vf-allowlist-'));
const STORE = join(TMP_DIR, 'allowlist.json');
process.env.DEMO_ALLOWLIST_FILE = STORE;
process.env.BOT_SECRET = process.env.BOT_SECRET ?? 'test-secret-1234';

let mod: typeof import('../src/services/allowlist.ts');

beforeAll(async () => {
  mod = await import('../src/services/allowlist.ts');
  mod._resetAllowlistForTests();
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

test('isDemoRequest matches the exact phrase', () => {
  expect(mod.isDemoRequest('Hi, Requesting whatsapp demo for versifine.')).toBe(true);
});

test('isDemoRequest is tolerant of case, punctuation, and whitespace', () => {
  expect(mod.isDemoRequest('hi requesting whatsapp demo for versifine')).toBe(true);
  expect(mod.isDemoRequest('  Hi,   Requesting   whatsapp  demo  for  versifine.  ')).toBe(true);
  expect(mod.isDemoRequest('Hi, Requesting whatsapp demo for versifine')).toBe(true); // no period
  // Smart-quote / fancy comma variants collapse to the same normalized form.
  expect(mod.isDemoRequest('Hi， Requesting whatsapp demo for versifine。')).toBe(true);
});

test('isDemoRequest rejects ordinary messages', () => {
  expect(mod.isDemoRequest('hi')).toBe(false);
  expect(mod.isDemoRequest('spent 200 on coffee')).toBe(false);
  expect(mod.isDemoRequest('requesting a demo please')).toBe(false);
  expect(mod.isDemoRequest('')).toBe(false);
  expect(mod.isDemoRequest(null)).toBe(false);
});

test('addToAllowlist adds a normalized number and reports newness', () => {
  expect(mod.isDynamicallyAllowed('919876543210')).toBe(false);
  // 10-digit input normalizes to the 91-prefixed form.
  expect(mod.addToAllowlist('9876543210')).toBe(true);
  expect(mod.isDynamicallyAllowed('919876543210')).toBe(true);
  // Idempotent: same number (any accepted format) is not "newly added" again.
  expect(mod.addToAllowlist('+91 98765 43210')).toBe(false);
});

test('the allowlist persists to disk and reloads after a restart', () => {
  expect(existsSync(STORE)).toBe(true);
  // Simulate a process restart: clear in-memory state, force a fresh load.
  mod._resetAllowlistForTests();
  expect(mod.isDynamicallyAllowed('919876543210')).toBe(true);
});
