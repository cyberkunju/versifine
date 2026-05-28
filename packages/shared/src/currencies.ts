/**
 * Supported currencies. Base currency is INR; everything else is converted
 * at write-time using the FX layer in the API. This list also gates the
 * parser — anything not here falls back to base.
 */

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'] as const;

export type Currency = (typeof CURRENCIES)[number];

const CURRENCY_SET = new Set<string>(CURRENCIES);

export function isCurrency(value: string): value is Currency {
  return CURRENCY_SET.has(value.toUpperCase());
}

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
  JPY: '¥',
};

/** Common spelled-out aliases users say in voice notes, mapped to the ISO code. */
export const CURRENCY_ALIASES: Record<string, Currency> = {
  '₹': 'INR',
  rs: 'INR',
  'rs.': 'INR',
  rupee: 'INR',
  rupees: 'INR',
  inr: 'INR',
  $: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  usd: 'USD',
  '€': 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  eur: 'EUR',
  '£': 'GBP',
  pound: 'GBP',
  pounds: 'GBP',
  gbp: 'GBP',
  aed: 'AED',
  dirham: 'AED',
  dirhams: 'AED',
  'د.إ': 'AED',
  sgd: 'SGD',
  aud: 'AUD',
  cad: 'CAD',
  jpy: 'JPY',
  yen: 'JPY',
  '¥': 'JPY',
};

export function normalizeCurrency(input: string | null | undefined): Currency {
  if (!input) return 'INR';
  const lookup = input.trim().toLowerCase();
  if (CURRENCY_ALIASES[lookup]) return CURRENCY_ALIASES[lookup];
  const upper = input.trim().toUpperCase();
  if (isCurrency(upper)) return upper as Currency;
  return 'INR';
}
