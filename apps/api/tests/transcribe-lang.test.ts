/**
 * Transcription language resolution — pure helpers.
 *
 * The native-script `/speech-to-text` switch is what keeps a Malayalam voice
 * note from coming back as English (the register-destroying cardinal sin on
 * the voice path). These tests pin the language-code request + the
 * script-authoritative resolution of the returned transcript. The actual
 * Sarvam call is exercised by scripts/smoke-transcribe.ts against real audio.
 */
import { describe, expect, test } from 'bun:test';
import { __transcribeInternals } from '../src/services/ai/transcribe.ts';

const { sarvamLanguageCode, languageFromTranscript } = __transcribeInternals;

describe('sarvamLanguageCode — request hint', () => {
  test('a known Indic hint → its BCP47 code', () => {
    expect(sarvamLanguageCode('ml')).toBe('ml-IN');
    expect(sarvamLanguageCode('hi')).toBe('hi-IN');
    expect(sarvamLanguageCode('ta')).toBe('ta-IN');
  });
  test('English or no hint → unknown (Sarvam auto-detects)', () => {
    expect(sarvamLanguageCode('en')).toBe('unknown');
    expect(sarvamLanguageCode(undefined)).toBe('unknown');
  });
});

describe('languageFromTranscript — native script is authoritative', () => {
  test('Malayalam-script transcript → ml regardless of hint', () => {
    expect(languageFromTranscript('ഞാൻ നാല് പൊറോട്ട വാങ്ങി', 'ml-IN', undefined)).toBe('ml');
    expect(languageFromTranscript('ഞാൻ നാല് പൊറോട്ട', 'unknown', 'en')).toBe('ml');
  });
  test('Hindi-script transcript → hi', () => {
    expect(languageFromTranscript('मैंने आज पाँच रियाल खर्च किए', 'hi-IN', undefined)).toBe('hi');
  });
  test('Tamil-script transcript → ta', () => {
    expect(languageFromTranscript('நான் இன்று ஐந்து ரூபாய்', undefined, undefined)).toBe('ta');
  });
  test('Devanagari + Marathi signal → mr (not hi) — review P1', () => {
    expect(languageFromTranscript('मी आज पाचशे रुपये खर्च केले', 'mr-IN', undefined)).toBe('mr');
    expect(languageFromTranscript('मी आज पाचशे रुपये खर्च केले', undefined, 'mr')).toBe('mr');
  });
  test('Devanagari with no Marathi signal stays hi', () => {
    expect(languageFromTranscript('मैंने आज खर्च किया', undefined, 'hi')).toBe('hi');
  });
});

describe('languageFromTranscript — translate fallback (English text)', () => {
  test('English transcript + Indic hint → reply in the user language', () => {
    // saaras fallback returns English, but the user spoke Malayalam → ml reply.
    expect(languageFromTranscript('I bought four porottas', undefined, 'ml')).toBe('ml');
  });
  test('English transcript + no Indic hint → English', () => {
    expect(languageFromTranscript('spent fifty on coffee', undefined, undefined)).toBe('en');
    expect(languageFromTranscript('spent fifty on coffee', 'en-IN', 'en')).toBe('en');
  });
  test('Sarvam language_code rescues when text is romanized Indic', () => {
    // No native script in the text, but Sarvam reports ml → trust it.
    expect(languageFromTranscript('njan porotta vangi', 'ml-IN', undefined)).toBe('ml');
  });
});
