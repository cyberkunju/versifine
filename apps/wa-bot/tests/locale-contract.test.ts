/**
 * Regression test for the bot → API `locale` contract.
 *
 * The API's /capture/* `locale` field is a short language enum
 * (en/hi/ml/ta/te/kn). The bot once sent a BCP-47 tag (`en-IN`) from
 * LANGUAGE_META.bcp47, which the API rejected with a 400 ZodError whose
 * envelope carried no code/message — so the bot surfaced an empty-error
 * "Couldn't log that." for EVERY message.
 *
 * `normalizeLocale` is the guard that collapses any tag to a supported
 * short code (or drops it). We assert it accepts every short code, maps
 * every LANGUAGE_META.bcp47 tag back to a valid enum value, and discards
 * anything unsupported instead of letting it reach the wire.
 *
 * NOTE: normalizeLocale lives in utils/locale.ts (not apiClient.ts) so this
 * test is immune to flow.test.ts's global `mock.module('apiClient')`.
 */
import { expect, test } from 'bun:test';
import { LANGUAGES, LANGUAGE_META, type Language } from '@versifine/shared';
import { normalizeLocale } from '../src/utils/locale.ts';

test('normalizeLocale passes through every supported short code', () => {
  for (const lang of LANGUAGES) {
    expect(normalizeLocale(lang)).toBe(lang);
  }
});

test('every LANGUAGE_META.bcp47 tag normalizes to a valid API enum value', () => {
  for (const lang of LANGUAGES) {
    const tag = LANGUAGE_META[lang as Language].bcp47; // e.g. "en-IN"
    const normalized = normalizeLocale(tag);
    expect(normalized).toBe(lang);
    expect(LANGUAGES as readonly string[]).toContain(normalized);
  }
});

test('normalizeLocale drops unsupported or empty locales', () => {
  expect(normalizeLocale('fr-FR')).toBeUndefined();
  expect(normalizeLocale('zh')).toBeUndefined();
  expect(normalizeLocale('')).toBeUndefined();
  expect(normalizeLocale(undefined)).toBeUndefined();
});

test('normalizeLocale is case- and separator-insensitive', () => {
  expect(normalizeLocale('EN-in')).toBe('en');
  expect(normalizeLocale('hi_IN')).toBe('hi');
  expect(normalizeLocale('  ta-IN  ')).toBe('ta');
});
