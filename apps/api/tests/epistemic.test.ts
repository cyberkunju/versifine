/**
 * Epistemic gate — only block phantom-money mints, NEVER a real log.
 *
 * Precision is the whole point: a false block fails the user's core action.
 * So the "must NOT block" suite is the important one — it must stay green.
 */
import { describe, expect, test } from 'bun:test';
import { classifyEpistemic } from '../src/services/ai/epistemic.ts';

describe('epistemic — BLOCKS phantom money (assertive=false)', () => {
  const blocked: Array<[string, string]> = [
    ['I did not pay the 500 rent yet', 'negated'],
    ["didn't pay the 500 rent", 'negated'],
    ['I have not spent the 2000 yet', 'negated'],
    ['no longer paying 1500 for gym', 'negated'],
    ['if I buy the iphone it will cost 80000', 'hypothetical'],
    ['should I spend 5000 on a watch', 'hypothetical'],
    ['thinking of buying a 50000 laptop', 'hypothetical'],
    ['planning to spend 3000 on a gift', 'hypothetical'],
    ['what if I put 10000 in an FD', 'hypothetical'],
    ['rent will be 15000 next month', 'future'],
    ["I'll pay 2000 tomorrow", 'future'],
    ['going to spend 4000 on diwali', 'future'],
    ['paisa nahi diya 500 ka', 'negated'],
    ['agar 80000 ka phone lu to', 'hypothetical'],
    ['500 rent illa ippo', 'negated'],
    ['kal 500 dunga', 'future'],
  ];
  for (const [text, reason] of blocked) {
    test(`"${text}" → blocked (${reason})`, () => {
      const v = classifyEpistemic(text);
      expect(v.assertive).toBe(false);
      expect(v.reason).toBe(reason as never);
    });
  }
});

describe('epistemic — NEVER blocks a real log (assertive=true)', () => {
  const allowed = [
    'spent 450 on auto',
    'paid 12000 rent',
    '200 chai',
    'got salary 85000',
    'lent ravi 2000',
    'paid 500 rent and got 2000 salary and lent ravi 300',
    "I didn't spend much, just 200 on chai", // contrast: asserted clause survives
    'spent 500 on lunch but forgot the 200 snack', // "but 200 snack" asserted
    'no it was 600 not 500', // a correction phrasing (no money verb negation)
    'how much did I spend on food', // a query (no number)
    'swiggy 425',
    '50 dollars on lunch',
    'spent 1,500 on groceries and 2,000 on fuel',
    'maybe spent 200 on chai', // bare "maybe" must NOT block
    'might have paid 300 for parking', // bare "might" must NOT block
    'next month summary please', // "next month" without a money verb + no number
    'bought 2 coffees for 100', // quantity + real spend
    'bought a mat for 500', // "mat" must NOT trigger Hindi negation
    'spent 5000 considering its diwali', // strong verb overrides "considering"
    'Will paid me back 500', // "will paid" must not match future; "paid" asserts
    'agarbatti 100', // "agar" substring must not trigger hypothetical
    'paid 500 will pay the rest later', // a real payment + a future clause
  ];
  for (const text of allowed) {
    test(`"${text}" → allowed`, () => {
      expect(classifyEpistemic(text).assertive).toBe(true);
    });
  }
});

describe('epistemic — no money, no opinion', () => {
  test('text with no digits is always assertive (gate does not apply)', () => {
    expect(classifyEpistemic('should I save more money').assertive).toBe(true);
    expect(classifyEpistemic('if I invest in mutual funds').assertive).toBe(true);
  });
});
