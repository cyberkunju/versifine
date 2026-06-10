/**
 * Per-turn language detection — pure unit tests.
 *
 * Covers native script detection, romanized indicator words, the priority
 * (script > roman, multi-hit ties), and the conservative null fallback for
 * ambiguous short messages.
 *
 * No DB. No network. Deterministic.
 */
import { describe, expect, test } from 'bun:test';
import {
  clearTurnLanguage,
  commitTurnLanguage,
  detectInputLanguage,
  effectiveLanguage,
} from '../src/utils/langDetect.ts';

describe('detectInputLanguage — native scripts', () => {
  test('Malayalam script', () => {
    expect(detectInputLanguage('ഞാൻ ഇന്നു അഞ്ച് റിയാൽ കൊടുത്തു')).toBe('ml');
  });
  test('Hindi (Devanagari) script', () => {
    expect(detectInputLanguage('मैंने आज पाँच रियाल खर्च किए')).toBe('hi');
  });
  test('Tamil script', () => {
    expect(detectInputLanguage('நான் இன்று ஐந்து ரியால் கொடுத்தேன்')).toBe('ta');
  });
  test('Telugu script', () => {
    expect(detectInputLanguage('నేను ఈరోజు ఐదు రియాల్ ఖర్చు చేశాను')).toBe('te');
  });
  test('Kannada script', () => {
    expect(detectInputLanguage('ನಾನು ಇಂದು ಐದು ರಿಯಾಲ್ ಖರ್ಚು ಮಾಡಿದೆ')).toBe('kn');
  });
  test('Bengali script', () => {
    expect(detectInputLanguage('আমি আজ পাঁচ রিয়াল খরচ করেছি')).toBe('bn');
  });
  test('Gujarati script', () => {
    expect(detectInputLanguage('મેં આજે પાંચ રિયાલ ખર્ચ્યા')).toBe('gu');
  });
  test('Punjabi (Gurmukhi) script', () => {
    expect(detectInputLanguage('ਮੈਂ ਅੱਜ ਪੰਜ ਰਿਯਾਲ ਖਰਚੇ')).toBe('pa');
  });
  test('Odia script', () => {
    expect(detectInputLanguage('ମୁଁ ଆଜି ପାଞ୍ଚ ରିୟାଲ୍ ଖର୍ଚ କଲି')).toBe('od');
  });
  test('mixed script: Malayalam + English keeps Malayalam', () => {
    expect(detectInputLanguage('I want രണ്ട് chai please')).toBe('ml');
  });
  test('mixed script: Devanagari + English keeps Hindi', () => {
    expect(detectInputLanguage('Spent 100 on आज ka chai')).toBe('hi');
  });
});

describe('detectInputLanguage — Manglish (romanized Malayalam)', () => {
  const cases = [
    'njan oonu kazhicchu',
    'ente paisa ille',
    'enikku randu chai venam',
    'eda kazhveri njan last chelavakkiyath enthine aan',
    'machaan undu',
    'ezhuthiyekkunnath nokkada',
    'rendu riyalil oru chappathi',
    'ariyilla evide aanu',
  ];
  for (const t of cases) {
    test(`"${t}" → ml`, () => {
      expect(detectInputLanguage(t)).toBe('ml');
    });
  }
});

describe('detectInputLanguage — Hinglish (romanized Hindi)', () => {
  const cases = [
    'mujhe paisa kharch karna hai',
    'kya yaar tum kya kar rahe ho',
    'mera aaj kitna kharcha hua',
    'kitna paisa hai mere paas',
    'bhai kal kharcha bahut hua',
    'tumhe kya hua',
  ];
  for (const t of cases) {
    test(`"${t}" → hi`, () => {
      expect(detectInputLanguage(t)).toBe('hi');
    });
  }
});

describe('detectInputLanguage — Tanglish (romanized Tamil)', () => {
  const cases = [
    'enaku inniku saapittu mudichen',
    'enaku paisa romba illa',
    'enna eppadi iruka',
    'enaku rendu chai sapittu',
    'ungalukku enna venum',
  ];
  for (const t of cases) {
    test(`"${t}" → ta`, () => {
      expect(detectInputLanguage(t)).toBe('ta');
    });
  }
});

describe('detectInputLanguage — English / null', () => {
  const englishOrNeutral = [
    'spent 50 on coffee',
    'how much did I spend today',
    'set budget groceries 8000',
    'hello',
    'undo',
    'CONFIRM',
  ];
  for (const t of englishOrNeutral) {
    test(`"${t}" → null (engine falls back to session.language)`, () => {
      expect(detectInputLanguage(t)).toBeNull();
    });
  }
});

describe('detectInputLanguage — disambiguation', () => {
  test('a single Manglish word in an otherwise English sentence still flips to ml', () => {
    expect(detectInputLanguage('hey, kazhveri, what is my balance')).toBe('ml');
  });
  test('Hinglish + Manglish tokens — most-hits wins', () => {
    // Three Hindi tokens, one Manglish — hi should win.
    expect(detectInputLanguage('mera bhai kya hua njan')).toBe('hi');
  });
  test('empty string → null', () => {
    expect(detectInputLanguage('')).toBeNull();
  });
  test('whitespace-only → null', () => {
    expect(detectInputLanguage('   \n   ')).toBeNull();
  });
  test('English word "main menu" does NOT flip to hi (P0-5 false-positive scrub)', () => {
    expect(detectInputLanguage('show main menu please')).toBeNull();
  });
  test('English "I will do that" does NOT flip to hi', () => {
    expect(detectInputLanguage('I will do that today')).toBeNull();
  });
  test('Marathi user with Devanagari → mr (not hi)', () => {
    expect(detectInputLanguage('मला आज ५०० खर्च केले', 'mr')).toBe('mr');
  });
  test('Hindi user with Devanagari stays hi', () => {
    expect(detectInputLanguage('मैंने आज पाँच रियाल खर्च किए', 'hi')).toBe('hi');
  });
  test('tie-break prefers session language', () => {
    // "kya yaar njan" — 2 hi hits (kya, yaar), 1 ml (njan) → hi wins by count.
    // But on a 1-1 tie ("yaar njan") with sessionLanguage='ml', ml wins.
    expect(detectInputLanguage('yaar njan')).toBe('ml'); // first-iteration ml wins
    expect(detectInputLanguage('yaar njan', 'hi')).toBe('hi'); // session breaks tie
  });
});

describe('effectiveLanguage / commit / clear', () => {
  test('effectiveLanguage prefers turnLanguage when set', () => {
    expect(effectiveLanguage({ language: 'en', turnLanguage: 'ml' })).toBe('ml');
  });
  test('effectiveLanguage falls back to session.language when no turn detection', () => {
    expect(effectiveLanguage({ language: 'hi' })).toBe('hi');
  });
  test('commitTurnLanguage skips during onboarding', () => {
    const s: any = { language: 'en', state: 'AWAITING_LANGUAGE' };
    const out = commitTurnLanguage(s, 'njan oonu kazhicchu');
    expect(out).toBe('en');
    expect(s.turnLanguage).toBeUndefined();
  });
  test('commitTurnLanguage applies during LINKED_MAIN', () => {
    const s: any = { language: 'en', state: 'LINKED_MAIN' };
    const out = commitTurnLanguage(s, 'njan oonu kazhicchu');
    expect(out).toBe('ml');
    expect(s.turnLanguage).toBe('ml');
  });
  test('commitTurnLanguage clears any stale turnLanguage on undetectable input', () => {
    const s: any = { language: 'en', state: 'LINKED_MAIN', turnLanguage: 'ml' };
    commitTurnLanguage(s, 'hello');
    expect(s.turnLanguage).toBeUndefined();
  });
  test('clearTurnLanguage drops the field', () => {
    const s: any = { language: 'en', turnLanguage: 'ml' };
    clearTurnLanguage(s);
    expect(s.turnLanguage).toBeUndefined();
  });
});
