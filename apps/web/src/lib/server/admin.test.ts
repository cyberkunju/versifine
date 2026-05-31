/**
 * Unit tests for the admin session crypto + credential check.
 *
 * These don't touch SvelteKit; they import the pure functions. We stub the
 * $env/dynamic/private module so the helper reads test creds.
 */
import { afterAll, expect, test, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({
  env: {
    ADMIN_USER: 'cyberkunju',
    ADMIN_PASS: '*Nk*creation*2348',
    ADMIN_SESSION_SECRET: 'unit-test-secret',
    BOT_SECRET: 'bot-secret',
    WABOT_INTERNAL_URL: 'http://127.0.0.1:5001',
  },
}));

const mod = await import('./admin.ts');

test('checkCredentials accepts the exact pair', () => {
  expect(mod.checkCredentials('cyberkunju', '*Nk*creation*2348')).toBe(true);
});

test('checkCredentials rejects wrong username or password', () => {
  expect(mod.checkCredentials('cyberkunju', 'wrong')).toBe(false);
  expect(mod.checkCredentials('nope', '*Nk*creation*2348')).toBe(false);
  expect(mod.checkCredentials('', '')).toBe(false);
});

test('a freshly issued session verifies', () => {
  const cookie = mod.issueSession();
  expect(mod.verifySession(cookie)).toBe(true);
});

test('tampered or malformed cookies fail verification', () => {
  const cookie = mod.issueSession();
  expect(mod.verifySession(cookie + 'x')).toBe(false);
  expect(mod.verifySession('garbage')).toBe(false);
  expect(mod.verifySession(undefined)).toBe(false);
  expect(mod.verifySession(`${Date.now()}.deadbeef`)).toBe(false);
});

test('a clearly-old timestamp with a bad signature fails', () => {
  // 13h ago — past the 12h TTL. Even ignoring the (invalid) signature, an
  // expired token must never verify.
  const old = (Date.now() - 13 * 60 * 60 * 1000).toString();
  expect(mod.verifySession(`${old}.0000`)).toBe(false);
});

afterAll(() => {
  /* no teardown needed */
});
