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
  // --- Gulf currency CODES + unambiguous words ---------------------------
  // The GENERIC words "riyal"/"rial"/"dinar" are NOT in this map — they're
  // ambiguous (Saudi/Omani/Qatari/Yemeni/Iranian riyals; Kuwaiti/Bahraini/
  // Jordanian/Iraqi/Libyan/Tunisian dinars). The parser detects them via
  // AMBIGUOUS_CURRENCY_WORDS + COUNTRY_QUALIFIED_CURRENCIES below and either
  // resolves a country-qualified phrase ("saudi riyal") or surfaces a "which
  // one?" prompt. ISO codes are unambiguous and stay here.
  sar: 'SAR',
  kwd: 'KWD',
  omr: 'OMR',
  qar: 'QAR',
  bhd: 'BHD',
  jod: 'JOD',
  iqd: 'IQD',
  yer: 'YER',
  irr: 'IRR',
  lyd: 'LYD',
  tnd: 'TND',
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

/**
 * Words that map to MULTIPLE possible currencies depending on country
 * context. The parser does NOT auto-resolve these — instead the API surfaces
 * a "which one?" choice to the user so a Saudi resident's "5 riyal" doesn't
 * silently log as Omani Rial (or vice-versa) and corrupt FX.
 *
 * Order = popularity for Indian-NRI traffic. The first option is the visual
 * default, but the user's explicit pick always wins.
 */
export interface CurrencyOption {
  code: Currency;
  /** Short native-language country name shown to the user. */
  country: string;
  /** Long currency name shown to the user. */
  name: string;
}
export const AMBIGUOUS_CURRENCY_WORDS: Record<string, CurrencyOption[]> = {
  riyal: [
    { code: 'SAR', country: 'Saudi Arabia', name: 'Saudi Riyal' },
    { code: 'OMR', country: 'Oman', name: 'Omani Rial' },
    { code: 'QAR', country: 'Qatar', name: 'Qatari Riyal' },
    { code: 'YER', country: 'Yemen', name: 'Yemeni Rial' },
    { code: 'IRR', country: 'Iran', name: 'Iranian Rial' },
  ],
  rial: [
    { code: 'OMR', country: 'Oman', name: 'Omani Rial' },
    { code: 'IRR', country: 'Iran', name: 'Iranian Rial' },
    { code: 'YER', country: 'Yemen', name: 'Yemeni Rial' },
    { code: 'SAR', country: 'Saudi Arabia', name: 'Saudi Riyal' },
  ],
  dinar: [
    { code: 'KWD', country: 'Kuwait', name: 'Kuwaiti Dinar' },
    { code: 'BHD', country: 'Bahrain', name: 'Bahraini Dinar' },
    { code: 'JOD', country: 'Jordan', name: 'Jordanian Dinar' },
    { code: 'IQD', country: 'Iraq', name: 'Iraqi Dinar' },
    { code: 'LYD', country: 'Libya', name: 'Libyan Dinar' },
    { code: 'TND', country: 'Tunisia', name: 'Tunisian Dinar' },
  ],
};

/**
 * Native-script + voice-transcription variants of the ambiguous tokens.
 * Indian / NRI users speak in Malayalam, Hindi, Arabic, Persian — Sarvam
 * sometimes returns the native script, sometimes a romanised form, often
 * with agglutinative case-suffixes (Malayalam `-il`/`-inu`/`-ile`/`-inte`,
 * Hindi `-mein`/`-ko`, Tamil `-ku`/`-il`). We map ALL these surface forms
 * back to their canonical English key so the picker fires regardless of
 * what the transcriber emitted.
 */
const AMBIGUOUS_NATIVE_FORMS: Array<{ pattern: RegExp; key: string }> = [
  // ── riyal — Latin variants with case-suffixes (most common in Sarvam output)
  // riyal / riyals / riyalil / riyalin / riyalinu / riyalile / riyalum / riyalkalil
  {
    pattern: /(?:^|[^\p{L}])riyal(?:s|in|inu|il|ile|inte|um|kal|kalil|kalukku|kalum)?(?:[^\p{L}]|$)/iu,
    key: 'riyal',
  },
  // ── rial — same, narrower (English/Persian rendering)
  {
    pattern: /(?:^|[^\p{L}])rial(?:s|in|inu|il|ile|um|kal|kalil)?(?:[^\p{L}]|$)/iu,
    key: 'rial',
  },
  // ── dinar — same
  {
    pattern: /(?:^|[^\p{L}])dinar(?:s|in|inu|il|ile|um|kal|kalil)?(?:[^\p{L}]|$)/iu,
    key: 'dinar',
  },
  // ── Native scripts ───────────────────────────────────────────────────────
  // Malayalam റിയാൽ (riyal) and the suffixed forms റിയാലിന്/റിയാലിൽ/റിയാലിന്റെ.
  // Match the prefix `റിയാ` followed by any letter/mark sequence — this
  // catches every case-suffixed inflection without enumerating each.
  { pattern: /റിയാ[\p{L}\p{Mark}]*/u, key: 'riyal' },
  // Hindi / Devanagari रियाल (riyal) — and case-suffix variants रियाल में/को/से/ने
  { pattern: /रियाल[\p{L}\p{Mark}]*/u, key: 'riyal' },
  // Arabic ريال (riyal) and ريالات (riyals) — common in user voice notes
  { pattern: /ريال(?:ات)?/u, key: 'riyal' },
  // Persian ﷼ glyph
  { pattern: /﷼/u, key: 'rial' },
  // Malayalam ദിനാർ (dinar) — same prefix-anchored loose match
  { pattern: /ദിനാ[\p{L}\p{Mark}]*/u, key: 'dinar' },
  // Hindi दीनार (dinar)
  { pattern: /दीनार[\p{L}\p{Mark}]*/u, key: 'dinar' },
  // Arabic دينار (dinar)
  { pattern: /دينار/u, key: 'dinar' },
];
const AMBIGUOUS_PLURAL_TO_SINGULAR: Record<string, string> = {
  riyals: 'riyal',
  rials: 'rial',
  dinars: 'dinar',
};

/**
 * Country-qualified currency phrases that resolve UNAMBIGUOUSLY ("saudi
 * riyal" → SAR, "omani rial" → OMR). Matched longest-first; case-insensitive.
 * Used by the parser to short-circuit AMBIGUOUS_CURRENCY_WORDS when the user
 * already specified the country. The riyal/rial/dinar token is permitted to
 * carry an arbitrary Latin suffix (`riyalil`, `riyalin`, `rials`) so Sarvam's
 * Manglish transcriptions that glue Malayalam case-suffixes to the Latin
 * stem still resolve correctly.
 */
export const COUNTRY_QUALIFIED_CURRENCIES: Array<{ pattern: RegExp; code: Currency }> = [
  { pattern: /\b(?:saudi(?:\s+arabian)?)\s+(?:riyal|rial)[a-z]*\b/i, code: 'SAR' },
  { pattern: /\b(?:omani|oman)\s+(?:rial|riyal)[a-z]*\b/i, code: 'OMR' },
  { pattern: /\b(?:qatari|qatar)\s+(?:riyal|rial)[a-z]*\b/i, code: 'QAR' },
  { pattern: /\b(?:yemeni|yemen)\s+(?:rial|riyal)[a-z]*\b/i, code: 'YER' },
  { pattern: /\b(?:iranian|iran)\s+(?:rial|riyal)[a-z]*\b/i, code: 'IRR' },
  { pattern: /\b(?:kuwaiti|kuwait)\s+dinar[a-z]*\b/i, code: 'KWD' },
  { pattern: /\b(?:bahraini|bahrain)\s+dinar[a-z]*\b/i, code: 'BHD' },
  { pattern: /\b(?:jordanian|jordan)\s+dinar[a-z]*\b/i, code: 'JOD' },
  { pattern: /\b(?:iraqi|iraq)\s+dinar[a-z]*\b/i, code: 'IQD' },
  { pattern: /\b(?:libyan|libya)\s+dinar[a-z]*\b/i, code: 'LYD' },
  { pattern: /\b(?:tunisian|tunisia)\s+dinar[a-z]*\b/i, code: 'TND' },
  // Dollar variants — strict word boundary, no Latin suffix tolerance because
  // "dollar" rarely takes case suffixes in Indian transcriptions.
  { pattern: /\b(?:us|u\.s\.|american|america)\s+(?:dollar|dollars)\b/i, code: 'USD' },
  { pattern: /\b(?:canadian|canada)\s+(?:dollar|dollars)\b/i, code: 'CAD' },
  { pattern: /\b(?:australian|australia|aussie)\s+(?:dollar|dollars)\b/i, code: 'AUD' },
  { pattern: /\b(?:singapore|singaporean)\s+(?:dollar|dollars)\b/i, code: 'SGD' },
  { pattern: /\b(?:hong\s*kong|hk|hongkong)\s+(?:dollar|dollars)\b/i, code: 'HKD' },
  { pattern: /\b(?:new\s*zealand|nz)\s+(?:dollar|dollars)\b/i, code: 'NZD' },
];

/**
 * Lower-case singular form of an ambiguous currency word, or null when the
 * input doesn't name one. Handles plurals (riyals → riyal) and an attached
 * country qualifier suppresses ambiguity (saudi riyal → not ambiguous).
 */
export function detectAmbiguousCurrencyWord(text: string): string | null {
  if (!text) return null;
  // If a country-qualified phrase resolves the word, it's no longer ambiguous.
  for (const { pattern } of COUNTRY_QUALIFIED_CURRENCIES) {
    if (pattern.test(text)) return null;
  }
  // Native scripts + agglutinative-suffixed Latin forms — covers Malayalam
  // റിയാൽ + റിയാലിന്/റിയാലിൽ etc., Hindi रियाल + रियाल में etc., Arabic ريال,
  // Persian ﷼, and the Latin riyal/rial/dinar with suffixes the regex below
  // would otherwise miss because `[a-z]` boundaries don't tolerate Unicode
  // case-suffix consonants.
  for (const { pattern, key } of AMBIGUOUS_NATIVE_FORMS) {
    if (pattern.test(text)) return key;
  }
  const lower = text.toLowerCase();
  for (const word of Object.keys(AMBIGUOUS_CURRENCY_WORDS)) {
    const re = new RegExp(`(?:^|[^a-z])${word}s?(?:[^a-z]|$)`, 'i');
    if (re.test(lower)) return word;
  }
  // Map a PLURAL to its singular AMBIGUOUS_CURRENCY_WORDS key.
  for (const [plural, singular] of Object.entries(AMBIGUOUS_PLURAL_TO_SINGULAR)) {
    const re = new RegExp(`(?:^|[^a-z])${plural}(?:[^a-z]|$)`, 'i');
    if (re.test(lower)) return singular;
  }
  return null;
}

/** Resolve a country-qualified currency phrase ("saudi riyal" → "SAR"). */
export function resolveQualifiedCurrency(text: string): Currency | null {
  if (!text) return null;
  for (const { pattern, code } of COUNTRY_QUALIFIED_CURRENCIES) {
    if (pattern.test(text)) return code;
  }
  return null;
}

/** Get the disambiguation options for a known ambiguous word. */
export function getCurrencyOptions(word: string): CurrencyOption[] {
  const key = word.trim().toLowerCase();
  const direct = AMBIGUOUS_CURRENCY_WORDS[key];
  if (direct) return direct;
  const singular = AMBIGUOUS_PLURAL_TO_SINGULAR[key];
  if (singular && AMBIGUOUS_CURRENCY_WORDS[singular]) {
    return AMBIGUOUS_CURRENCY_WORDS[singular]!;
  }
  return [];
}

export function normalizeCurrency(input: string | null | undefined): Currency {
  if (!input) return 'INR';
  const lookup = input.trim().toLowerCase();
  if (CURRENCY_ALIASES[lookup]) return CURRENCY_ALIASES[lookup];
  const upper = input.trim().toUpperCase();
  if (isCurrency(upper)) return upper as Currency;
  return 'INR';
}
