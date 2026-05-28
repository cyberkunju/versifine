/**
 * Merchant normalization for category lookups and override storage.
 *
 * Two transactions describing the same merchant rarely arrive with the same
 * raw text. UPI rails decorate descriptions with "UPI/<vpa>", banks insert
 * store numbers, POS terminals append city codes ("MUMBAI", "BLR"), and
 * merchants tack on transaction ids. None of that matters for matching, so
 * we normalize aggressively before consulting overrides or the merchant DB.
 *
 * The transformations, applied in order:
 *   1. Decode UPI rails: drop "UPI/", "UPI-", "UPI:" prefixes.
 *   2. Drop common payment-rail suffixes: "PAY/", "POS/", "NEFT/", "RTGS/",
 *      "IMPS/", "CC AVENUE", "RAZORPAY/".
 *   3. Strip VPA handles: anything matching `@<bank-handle>` (oksbi, ybl,
 *      paytm, axl, axisbank, hdfcbank, icici, upi, oksbi).
 *   4. Strip 5+ digit numeric runs (store numbers, terminal ids).
 *   5. Strip trailing UPPERCASE city codes (`MUMBAI`, `BLR`, `BENGALURU`).
 *   6. Strip dates and times that POS systems leak in.
 *   7. Strip leading bank/processor prefixes and trailing reference codes.
 *   8. Lowercase, replace non-alphanumerics with spaces, collapse whitespace.
 *
 * The result is a short, lossy key like `swiggy` or `airtel postpaid`. It is
 * intentionally not invertible — its only job is to be a stable lookup key.
 */

const VPA_HANDLES = [
  'oksbi',
  'okaxis',
  'okicici',
  'okhdfcbank',
  'ybl',
  'ibl',
  'apl',
  'axl',
  'axisbank',
  'hdfcbank',
  'icici',
  'paytm',
  'upi',
  'sbi',
  'kotak',
  'rbl',
  'idfc',
  'pnb',
  'allbank',
  'unionbank',
  'jiopayments',
  'fbl',
  'dbs',
  'yesbank',
];

const RAIL_PREFIXES = [
  /^upi[\s/:_\-]+/i,
  /^pos[\s/:_\-]+/i,
  /^pay[\s/:_\-]+/i,
  /^neft[\s/:_\-]+/i,
  /^rtgs[\s/:_\-]+/i,
  /^imps[\s/:_\-]+/i,
  /^ach[\s/:_\-]+/i,
  /^ecs[\s/:_\-]+/i,
  /^razorpay[\s/:_\-]+/i,
  /^ccavenue[\s/:_\-]+/i,
  /^bbps[\s/:_\-]+/i,
  /^to\s+/i,
  /^from\s+/i,
];

// City codes most frequently appended by Indian POS terminals.
const TRAILING_CITY_CODES = new Set([
  'MUMBAI',
  'DELHI',
  'BENGALURU',
  'BANGALORE',
  'BLR',
  'BNG',
  'KOLKATA',
  'CHENNAI',
  'CHN',
  'HYDERABAD',
  'HYD',
  'PUNE',
  'AHMEDABAD',
  'AHM',
  'JAIPUR',
  'KOCHI',
  'COCHIN',
  'COK',
  'TVM',
  'TRIVANDRUM',
  'CALICUT',
  'CCU',
  'BBSR',
  'GOA',
  'NOIDA',
  'GURGAON',
  'GGN',
  'NCR',
  'IND',
  'IN',
]);

const LONG_NUMBER_RE = /\b\d{5,}\b/g;
const TRAILING_REFERENCE_RE = /\b(ref|txn|rrn|utr)[:\-]?\s*[a-z0-9]{4,}\b/gi;
const DATE_TIME_RE = /\b\d{1,4}[/-]\d{1,2}([/-]\d{1,4})?\b|\b\d{1,2}:\d{2}(:\d{2})?\b/g;

function stripVpaHandles(input: string): string {
  let out = input;
  for (const handle of VPA_HANDLES) {
    const re = new RegExp(`@\\s*${handle}\\b`, 'gi');
    out = out.replace(re, ' ');
  }
  // Generic VPA pattern fallback — anything that looks like word@word.
  out = out.replace(/\b[\w.\-]+@[a-z][a-z0-9.\-]+\b/gi, ' ');
  return out;
}

function stripRailPrefixes(input: string): string {
  let out = input;
  // Apply repeatedly because rails can be nested ("UPI/POS/...").
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const re of RAIL_PREFIXES) {
      const next = out.replace(re, '');
      if (next !== out) {
        out = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

function stripTrailingCityCode(input: string): string {
  // Look at trailing all-caps token sequences and drop those in our set.
  const tokens = input.split(/\s+/);
  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (!last) {
      tokens.pop();
      continue;
    }
    const upper = last.toUpperCase();
    const isCity = TRAILING_CITY_CODES.has(upper);
    const isAllCaps = /^[A-Z]{2,}$/.test(last);
    if (isCity || (isAllCaps && tokens.length > 1)) {
      tokens.pop();
      continue;
    }
    break;
  }
  return tokens.join(' ');
}

export function normalizeMerchant(description: string): string {
  if (!description) return '';
  let out = description.trim();

  out = stripRailPrefixes(out);
  out = stripVpaHandles(out);
  out = out.replace(TRAILING_REFERENCE_RE, ' ');
  out = out.replace(DATE_TIME_RE, ' ');
  out = out.replace(LONG_NUMBER_RE, ' ');
  out = stripTrailingCityCode(out);

  // Lowercase, replace anything that isn't a-z 0-9 with a space, collapse runs.
  out = out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // After normalizing, drop short standalone digits (likely amounts).
  out = out
    .split(' ')
    .filter((tok) => !/^\d{1,4}$/.test(tok))
    .join(' ')
    .trim();

  return out;
}
