import { describe, expect, test } from 'bun:test';
import { resolveCurrencySymbol, isCurrency, normalizeCurrency } from '@versifine/shared';

describe('Global Currencies Support', () => {
  test('isCurrency validates supported currencies', () => {
    expect(isCurrency('INR')).toBe(true);
    expect(isCurrency('USD')).toBe(true);
    expect(isCurrency('EUR')).toBe(true);
    expect(isCurrency('BRL')).toBe(true); // Newly supported!
    expect(isCurrency('ZWG')).toBe(true); // Zimbabwe Gold!
    expect(isCurrency('XYZ')).toBe(false); // Invalid code
  });

  test('normalizeCurrency returns correct code or defaults to INR', () => {
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency('BRL')).toBe('BRL');
    expect(normalizeCurrency('rm')).toBe('MYR');
    expect(normalizeCurrency('invalid-code')).toBe('INR');
  });

  test('resolveCurrencySymbol returns curated symbols first', () => {
    expect(resolveCurrencySymbol('INR')).toBe('₹');
    expect(resolveCurrencySymbol('USD')).toBe('$');
    expect(resolveCurrencySymbol('EUR')).toBe('€');
    expect(resolveCurrencySymbol('MYR')).toBe('RM');
  });

  test('resolveCurrencySymbol dynamically resolves other symbols', () => {
    // BRL is Brazilian Real, symbol is "R$"
    expect(resolveCurrencySymbol('BRL')).toBe('R$');

    // GBP is British Pound, symbol is "£"
    expect(resolveCurrencySymbol('GBP')).toBe('£');
  });

  test('resolveCurrencySymbol falls back to ISO code for obscure currencies', () => {
    // ZWG is Zimbabwe Gold, falls back to ZWG
    expect(resolveCurrencySymbol('ZWG')).toBe('ZWG');
  });
});
