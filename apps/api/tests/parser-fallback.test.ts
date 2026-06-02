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

  test('keeps romanized Malayalam item words and drops filler', () => {
    expect(inferDescriptionFallback('oru kaappi oru 54roopa')).toBe('kaappi');
    expect(inferDescriptionFallback('2 porotta beef motham oru 453 ayi')).toBe('porotta beef');
  });

  test('keeps Malayalam-script item words and drops spend/currency filler', () => {
    expect(inferDescriptionFallback('കേക്ക് വാങ്ങിയത് 30 രൂപ')).toBe('കേക്ക്');
  });
});
