/**
 * Natural-language settings detection.
 *
 * "Change language to malayalam" (text or transcribed voice) must change the
 * setting — never get refused as "outside my lane." Covers language changes
 * (English names + native scripts) and reply-mode changes, and confirms a
 * plain expense is NOT mistaken for a settings command.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { detectSettingsIntent } from '../src/conversations/flows/settings.ts';
import { getSession, _resetAllSessions } from '../src/conversations/state.ts';

const PHONE = '919998887777';

function session() {
  return getSession(PHONE, { language: 'en' });
}

beforeEach(() => _resetAllSessions());
afterEach(() => _resetAllSessions());

test('changes language: "change language to malayalam"', () => {
  const out = detectSettingsIntent(session(), 'change language to malayalam');
  expect(out).not.toBeNull();
  expect(out?.language).toBe('ml');
  expect(getSession(PHONE).language).toBe('ml');
});

test('changes language via "speak in hindi"', () => {
  const out = detectSettingsIntent(session(), 'speak in hindi');
  expect(out?.language).toBe('hi');
});

test('changes language from a native-script name (malayalam word)', () => {
  const out = detectSettingsIntent(session(), 'മലയാളം');
  expect(out?.language).toBe('ml');
});

test('bare language name switches', () => {
  const out = detectSettingsIntent(session(), 'tamil');
  expect(out?.language).toBe('ta');
});

test('voice off → text reply mode', () => {
  const out = detectSettingsIntent(session(), 'voice off');
  expect(out).not.toBeNull();
  expect(getSession(PHONE).replyMode).toBe('text');
});

test('"speak to me" → voice reply mode', () => {
  const out = detectSettingsIntent(session(), 'speak to me');
  expect(out).not.toBeNull();
  expect(getSession(PHONE).replyMode).toBe('voice');
});

test('a plain expense is NOT treated as a settings command', () => {
  const out = detectSettingsIntent(session(), 'spent 450 on auto');
  expect(out).toBeNull();
});

test('a finance question is NOT treated as a settings command', () => {
  const out = detectSettingsIntent(session(), 'how much did I spend on food');
  expect(out).toBeNull();
});
