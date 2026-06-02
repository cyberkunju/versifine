/**
 * Natural-language settings / account-action detection.
 *
 * "Change language to malayalam", "voice off", and "link my email" (text or
 * transcribed voice) must be ACTED ON — never refused as "outside my lane."
 * The email-linking calls the API, which is mocked here so the test is offline.
 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

// Mock the API client so email-linking doesn't hit the network.
mock.module('../src/services/apiClient.ts', () => ({
  ApiClientError: class ApiClientError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  botEnsureUser: async (_phone: string, language: string, email?: string) => ({
    userId: 'u_test',
    spaceId: 's_test',
    isNew: false,
    displayName: null,
    language,
    email: email ?? null,
    linkedExisting: false,
  }),
}));

const { detectSettingsIntent } = await import('../src/conversations/flows/settings.ts');
const { getSession, _resetAllSessions } = await import('../src/conversations/state.ts');

const PHONE = '919998887777';
function session() {
  return getSession(PHONE, { language: 'en' });
}

beforeEach(() => _resetAllSessions());
afterEach(() => _resetAllSessions());

test('changes language: "change language to malayalam"', async () => {
  const out = await detectSettingsIntent(session(), 'change language to malayalam');
  expect(out).not.toBeNull();
  expect(out?.language).toBe('ml');
  expect(getSession(PHONE).language).toBe('ml');
});

test('changes language via "speak in hindi"', async () => {
  const out = await detectSettingsIntent(session(), 'speak in hindi');
  expect(out?.language).toBe('hi');
});

test('changes language from a native-script name (malayalam word)', async () => {
  const out = await detectSettingsIntent(session(), 'മലയാളം');
  expect(out?.language).toBe('ml');
});

test('bare language name switches', async () => {
  const out = await detectSettingsIntent(session(), 'tamil');
  expect(out?.language).toBe('ta');
});

test('voice off → text reply mode', async () => {
  const out = await detectSettingsIntent(session(), 'voice off');
  expect(out).not.toBeNull();
  expect(getSession(PHONE).replyMode).toBe('text');
});

test('"speak to me" → voice reply mode', async () => {
  const out = await detectSettingsIntent(session(), 'speak to me');
  expect(out).not.toBeNull();
  expect(getSession(PHONE).replyMode).toBe('voice');
});

test('links a bare email address', async () => {
  const out = await detectSettingsIntent(session(), 'asha@gmail.com');
  expect(out).not.toBeNull();
  expect(out?.text.toLowerCase()).toContain('link');
  expect(getSession(PHONE).userId).toBe('u_test');
  expect(getSession(PHONE).spaceId).toBe('s_test');
});

test('"now i need to link email" asks for it, then links the follow-up', async () => {
  const ask = await detectSettingsIntent(session(), 'now i need to link email');
  expect(ask).not.toBeNull();
  expect(getSession(PHONE).pending?.awaitingEmailLink).toBe(true);
  const linked = await detectSettingsIntent(getSession(PHONE), 'asha@gmail.com');
  expect(linked).not.toBeNull();
  expect(linked?.text.toLowerCase()).toContain('link');
});

test('a plain expense is NOT treated as a settings/email action', async () => {
  const out = await detectSettingsIntent(session(), 'spent 450 on auto');
  expect(out).toBeNull();
});

test('a finance question is NOT treated as a settings command', async () => {
  const out = await detectSettingsIntent(session(), 'how much did I spend on food');
  expect(out).toBeNull();
});
