/**
 * Supported currencies. Base currency is INR; everything else is converted
 * at write-time using the FX layer in the API. This list also gates the
 * parser — anything not here falls back to base.
 */

export const CURRENCIES = [
  'AED',
  'AFN',
  'ALL',
  'AMD',
  'ANG',
  'AOA',
  'ARS',
  'AUD',
  'AWG',
  'AZN',
  'BAM',
  'BBD',
  'BDT',
  'BGN',
  'BHD',
  'BIF',
  'BMD',
  'BND',
  'BOB',
  'BRL',
  'BSD',
  'BTN',
  'BWP',
  'BYN',
  'BZD',
  'CAD',
  'CDF',
  'CHF',
  'CLP',
  'CNY',
  'COP',
  'CRC',
  'CUC',
  'CUP',
  'CVE',
  'CZK',
  'DJF',
  'DKK',
  'DOP',
  'DZD',
  'EGP',
  'ERN',
  'ETB',
  'EUR',
  'FJD',
  'FKP',
  'GBP',
  'GEL',
  'GHS',
  'GIP',
  'GMD',
  'GNF',
  'GTQ',
  'GYD',
  'HKD',
  'HNL',
  'HRK',
  'HTG',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'IQD',
  'IRR',
  'ISK',
  'JMD',
  'JOD',
  'JPY',
  'KES',
  'KGS',
  'KHR',
  'KMF',
  'KPW',
  'KRW',
  'KWD',
  'KYD',
  'KZT',
  'LAK',
  'LBP',
  'LKR',
  'LRD',
  'LSL',
  'LYD',
  'MAD',
  'MDL',
  'MGA',
  'MKD',
  'MMK',
  'MNT',
  'MOP',
  'MRU',
  'MUR',
  'MVR',
  'MWK',
  'MXN',
  'MYR',
  'MZN',
  'NAD',
  'NGN',
  'NIO',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PAB',
  'PEN',
  'PGK',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'RWF',
  'SAR',
  'SBD',
  'SCR',
  'SDG',
  'SEK',
  'SGD',
  'SHP',
  'SLE',
  'SLL',
  'SOS',
  'SRD',
  'SSP',
  'STN',
  'SVC',
  'SYP',
  'SZL',
  'THB',
  'TJS',
  'TMT',
  'TND',
  'TOP',
  'TRY',
  'TTD',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'USD',
  'UYU',
  'UZS',
  'VES',
  'VND',
  'VUV',
  'WST',
  'XAF',
  'XCD',
  'XOF',
  'XPF',
  'YER',
  'ZAR',
  'ZMW',
  'ZWG',
  'ZWL',
] as const;

export type Currency = (typeof CURRENCIES)[number];

export const POPULAR_CURRENCIES = [
  'INR',
  'USD',
  'EUR',
  'GBP',
  'AED',
  'SGD',
  'AUD',
  'CAD',
  'JPY',
  'MYR',
] as const;

const CURRENCY_SET = new Set<string>(CURRENCIES);

export function isCurrency(value: string): value is Currency {
  return CURRENCY_SET.has(value.toUpperCase());
}

export const CURRENCY_SYMBOL: Partial<Record<Currency, string>> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
  JPY: '¥',
  MYR: 'RM',
};

export function resolveCurrencySymbol(currency: string): string {
  const upper = currency.trim().toUpperCase() as Currency;
  if (CURRENCY_SYMBOL[upper]) {
    return CURRENCY_SYMBOL[upper]!;
  }
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: upper,
    }).formatToParts(0);
    const part = parts.find((p) => p.type === 'currency');
    if (part?.value) {
      return part.value;
    }
  } catch {
    // fallback
  }
  return upper;
}

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
  myr: 'MYR',
  rm: 'MYR',
  // --- Gulf currencies (high-volume for Indian users abroad) -----------
  // "riyal"/"rial" defaults to SAR (Saudi) — by far the most common Indian-Gulf
  // usage. Users who actually mean Omani/Qatari/Yemeni Rial type the ISO code
  // ("OMR 5", "QAR 50") which the uppercase-ISO path resolves deterministically.
  riyal: 'SAR',
  riyals: 'SAR',
  rial: 'SAR',
  rials: 'SAR',
  sar: 'SAR',
  // "dinar" defaults to KWD (Kuwait) — most common Indian-Gulf usage.
  // BHD/IQD/JOD/LYD/TND speakers type the code or say "kuwaiti dinar" etc.,
  // which the LLM resolves with full context.
  dinar: 'KWD',
  dinars: 'KWD',
  kwd: 'KWD',
  omr: 'OMR',
  qar: 'QAR',
  bhd: 'BHD',
  // --- Other high-volume codes that aren't already aliased -------------
  thb: 'THB',
  baht: 'THB',
  cny: 'CNY',
  yuan: 'CNY',
  rmb: 'CNY',
  krw: 'KRW',
  hkd: 'HKD',
  chf: 'CHF',
  zar: 'ZAR',
  brl: 'BRL',
  npr: 'NPR',
  lkr: 'LKR',
  pkr: 'PKR',
  bdt: 'BDT',
};

export function normalizeCurrency(input: string | null | undefined): Currency {
  if (!input) return 'INR';
  const lookup = input.trim().toLowerCase();
  if (CURRENCY_ALIASES[lookup]) return CURRENCY_ALIASES[lookup];
  const upper = input.trim().toUpperCase();
  if (isCurrency(upper)) return upper as Currency;
  return 'INR';
}
