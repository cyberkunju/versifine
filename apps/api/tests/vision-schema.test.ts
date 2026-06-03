import { describe, expect, test } from 'bun:test';
import { visionSchema } from '../src/services/ai/vision.ts';

describe('Receipt Vision Zod Schema', () => {
  test('parses simple non-itemized receipt payload', () => {
    const payload = {
      amount: 450.5,
      currency: 'INR',
      description: 'Ola Cabs',
      date: '2026-06-03',
      confidence: 0.95,
    };

    const parsed = visionSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.amount).toBe(450.5);
      expect(parsed.data.currency).toBe('INR');
      expect(parsed.data.description).toBe('Ola Cabs');
      expect(parsed.data.items).toEqual([]);
    }
  });

  test('parses itemized receipt payload', () => {
    const payload = {
      amount: 32.7,
      currency: 'MYR',
      description: 'Asia Mart',
      date: '2026-06-03',
      confidence: 0.9,
      items: [
        {
          description: 'Salsa Chocolate',
          amount: 10.5,
          category: 'Groceries',
        },
        {
          description: 'Orange Juice',
          amount: 15.2,
          category: 'Groceries',
        },
        {
          description: 'Bread',
          amount: 7.0,
          category: 'Groceries',
        },
      ],
    };

    const parsed = visionSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.amount).toBe(32.7);
      expect(parsed.data.currency).toBe('MYR');
      expect(parsed.data.items?.length).toBe(3);
      expect(parsed.data.items?.[0]).toEqual({
        description: 'Salsa Chocolate',
        amount: 10.5,
        category: 'Groceries',
      });
    }
  });
});
