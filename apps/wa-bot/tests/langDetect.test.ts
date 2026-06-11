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

describe('detectInputLanguage — morphological recall (no listed pronoun)', () => {
  // Ordinary code-mixed sentences the closed lexicon used to miss → English
  // reply (the cardinal sin). Caught now by agglutinative endings.
  const mlCases = [
    'ATM il ninnu 2000 eduthu', // ninnu → -nnu
    'bill adachu 1200', // adachu → -chu
    'rent kodukkanam 5000', // kodukkanam → -kkanam
  ];
  for (const t of mlCases) {
    test(`"${t}" → ml (morphology)`, () => {
      expect(detectInputLanguage(t)).toBe('ml');
    });
  }
  test('Hinglish "-wala" suffix recall: "doodhwala ko 50 rupaye" → hi', () => {
    expect(detectInputLanguage('doodhwala ko 50 rupaye')).toBe('hi');
  });
});

describe('commitTurnLanguage — fail toward the user (kills residual cardinal sin)', () => {
  test('an en-onboarded user who has been writing Malayalam keeps getting Malayalam', () => {
    const s: any = { language: 'en', state: 'LINKED_MAIN' };
    // Turn 1: clear Manglish → ml (also seeds the prior).
    expect(commitTurnLanguage(s, 'njan oonu kazhicchu')).toBe('ml');
    // Turn 2: a message that slips past detection AND isn't clearly English →
    // fail toward the user's established language instead of snapping to en.
    expect(commitTurnLanguage(s, 'athinu sesham verum')).toBe('ml');
  });

  test('a clearly-English message from a Malayalam-leaning user STILL gets English', () => {
    const s: any = { language: 'en', state: 'LINKED_MAIN' };
    commitTurnLanguage(s, 'njan oonu kazhicchu'); // seed ml prior
    // English function words present → English wins, never flipped to ml.
    expect(commitTurnLanguage(s, 'what is my balance today')).toBe('en');
    expect(s.turnLanguage).toBeUndefined();
  });

  test('a fresh en user with no history is unaffected (no basis to guess)', () => {
    const s: any = { language: 'en', state: 'LINKED_MAIN' };
    expect(commitTurnLanguage(s, 'asdf qwer')).toBe('en');
  });
});

describe('detectInputLanguage — brutal-review false-positives must NOT flip', () => {
  // P0-1: hi -enge removed.
  const englishWords = ['challenge 300', 'revenge movie ticket 300', 'scavenge', 'lozenge 50'];
  // P0-2: ml -ille removed.
  const places = ['louisville trip 200', 'nashville 500', 'knoxville', 'grille 250', 'seville'];
  // P1-7: ta -nen removed.
  const linen = ['linen 500'];
  // P1-8: standalone mein/wala no longer match.
  const foods = ['chow mein 250', 'chow mein noodles 300'];
  for (const t of [...englishWords, ...places, ...linen, ...foods]) {
    test(`"${t}" → null (no false Indic flip)`, () => {
      expect(detectInputLanguage(t)).toBeNull();
    });
  }
});

describe('detectInputLanguage — ml/ta morphology collision (P1-5)', () => {
  test('Tamil "seipannu" stays Tamil (not Malayalam via -nnu)', () => {
    expect(detectInputLanguage('naan seipannu')).toBe('ta');
  });
  test('Malayalam "ninnu"/"vannu" still detect as ml', () => {
    expect(detectInputLanguage('ATM il ninnu 2000 eduthu')).toBe('ml');
  });
});

describe('commitTurnLanguage — reverse cardinal sin guards', () => {
  test('bare merchant+amount from an ml-prior user STILL replies English (P0-3)', () => {
    const s: any = { language: 'en', state: 'LINKED_MAIN' };
    commitTurnLanguage(s, 'njan oonu kazhicchu'); // seed ml prior
    expect(commitTurnLanguage(s, 'uber 250')).toBe('en');
    expect(commitTurnLanguage(s, 'zomato 450')).toBe('en');
    expect(commitTurnLanguage(s, '500')).toBe('en');
  });

  test('a picker token / undo token from an ml-prior user is not flipped (P2-10)', () => {
    const s: any = { language: 'en', state: 'LINKED_MAIN' };
    commitTurnLanguage(s, 'njan oonu kazhicchu');
    expect(commitTurnLanguage(s, 'Omr')).toBe('en');
    expect(commitTurnLanguage(s, 'K7P2A9')).toBe('en');
    expect(commitTurnLanguage(s, '2')).toBe('en');
  });

  test('a morphology-only detection does NOT build the prior (P1-4)', () => {
    const s: any = { language: 'en', state: 'LINKED_MAIN' };
    // "bill adachu 1200" is detected ml by MORPHOLOGY (adachu → -chu) for THIS
    // turn, but must not seed the prior...
    expect(commitTurnLanguage(s, 'bill adachu 1200')).toBe('ml');
    expect(s.recentLangs ?? []).toEqual([]); // morph hit not remembered
    // ...so a later bare prose turn does NOT get pulled to ml off a morph hit.
    expect(commitTurnLanguage(s, 'athinu sesham verum')).toBe('en');
  });

  test('decisive lexicon detection DOES build the prior', () => {
    const s: any = { language: 'en', state: 'LINKED_MAIN' };
    commitTurnLanguage(s, 'njan oonu kazhicchu'); // lexicon ml → remembered
    expect(s.recentLangs).toContain('ml');
    expect(commitTurnLanguage(s, 'athinu sesham verum')).toBe('ml'); // prose → prior
  });
});
