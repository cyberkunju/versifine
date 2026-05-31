import { describe, expect, test } from 'bun:test';
import { __parserFallbacksForTests } from '../src/services/ai/parser.ts';

const { inferDescriptionFallback } = __parserFallbacksForTests;

describe('parser description fallback', () => {
  test('extracts the item from quantity + rupee phrasing', () => {
    expect(inferDescriptionFallback('I had 2 coffie for 50rs')).toBe('coffee');
  });

  test('keeps the noun after common spend verbs', () => {
    expect(inferDescriptionFallback('spent 450 on auto')).toBe('auto');
  });

  test('handles code-mixed Hindi spend phrasing', () => {
    expect(inferDescriptionFallback('200 chai pe kharch')).toBe('chai');
  });
});
