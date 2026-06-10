/**
 * Multi-item log total must NEVER sum across currencies.
 *
 * Live bug from the brutal review: "$100 hotel and 2000 food" replied
 * "Logged 2 expenses ($2,100 total)" — it added $100 + ₹2,000 as one number.
 * captureLoggedMany now renders a per-currency breakdown when items span
 * multiple currencies, and a single total when they share one.
 */
import { describe, expect, test } from 'bun:test';
import { getMessages } from '../src/conversations/messages/index.ts';

type Item = { amount: number; currency: string; description: string; category: string | null };

const mixed: Item[] = [
  { amount: 100, currency: 'USD', description: 'hotel', category: 'Travel' },
  { amount: 2000, currency: 'INR', description: 'food', category: 'Food' },
];
const sameInr: Item[] = [
  { amount: 450, currency: 'INR', description: 'auto', category: 'Transport' },
  { amount: 200, currency: 'INR', description: 'chai', category: 'Food' },
];

for (const lang of ['en', 'hi', 'ml'] as const) {
  describe(`captureLoggedMany — ${lang}`, () => {
    const m = getMessages(lang);

    test('mixed currencies render BOTH, never a fake single total', () => {
      const out = m.captureLoggedMany(mixed);
      expect(out).toContain('$100');
      expect(out).toContain('₹2,000');
      expect(out).not.toContain('$2,100');
      expect(out).not.toContain('₹2,100');
    });

    test('single currency renders one combined total derived from items', () => {
      const out = m.captureLoggedMany(sameInr);
      expect(out).toContain('₹650');
    });

    test('currency key is normalised — "inr"/"INR" do not split into two buckets', () => {
      const out = m.captureLoggedMany([
        { amount: 100, currency: 'inr', description: 'a', category: null },
        { amount: 50, currency: 'INR', description: 'b', category: null },
      ]);
      expect(out).toContain('₹150');
      // exactly one rupee total, no " + " breakdown
      expect(out).not.toContain(' + ');
    });
  });
}
