/**
 * Phone number normalization.
 *
 * We store phone numbers as raw digits (E.164-ish minus the leading +).
 * The normalizer strips whitespace, dashes, parens, leading +, leading
 * zeros after the country code, and any leftover punctuation. Indian
 * numbers without a country code (10 digits) get prefixed with `91`.
 */

export function normalizePhone(input: string | null | undefined): string {
  if (!input) return '';
  let digits = input.replace(/[^\d]/g, '');
  // Numbers with a leading "00" are E.164 with the international access prefix.
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Plain 10-digit Indian local → prepend country code.
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

/** Quick allowlist check used by the bot — comma-separated `digits` string. */
export function isAllowed(phone: string, allowlistCsv: string): boolean {
  if (!allowlistCsv.trim()) return false;
  const list = allowlistCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(phone);
}
