/**
 * Email-step skip detection must be forgiving — the email is OPTIONAL and
 * must NEVER trap the user. Regression for the screenshot where "skipp",
 * "no need", and "bro i dont need to link that shit" all failed to skip and
 * the bot kept demanding a valid email.
 */
import { expect, test } from 'bun:test';
import { looksLikeSkip, parseEmail } from '../src/utils/text.ts';

const SHOULD_SKIP = [
  'skip',
  'skipp',
  'SKIP',
  'no',
  'nope',
  'nah',
  'no need',
  'no thanks',
  'not now',
  'later',
  "i don't need it",
  'dont need',
  'bro i dont need to link that shit',
  'leave it',
  'forget it',
  'വേണ്ട',
  'नहीं',
];

const SHOULD_NOT_SKIP = [
  'me@example.com',
  'my email is asha@gmail.com',
  'asha.k@company.co.in',
];

test('forgiving skip detection accepts typos and full sentences', () => {
  for (const t of SHOULD_SKIP) {
    expect(looksLikeSkip(t)).toBe(true);
  }
});

test('a message containing a real email is never a skip', () => {
  for (const t of SHOULD_NOT_SKIP) {
    expect(looksLikeSkip(t)).toBe(false);
    expect(parseEmail(t)).not.toBeNull();
  }
});
