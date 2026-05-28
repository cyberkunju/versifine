/**
 * Phone number normalisation. Mirrors apps/api/src/utils/phone.ts so the
 * bot and the API agree on what "the same number" means down to the digit.
 */

export function normalizePhone(input: string | null | undefined): string {
  if (!input) return '';
  let digits = input.replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

/**
 * Allowlist gate. In demo mode we only reply to numbers the operator has
 * explicitly opted in. With demo off the bot answers any inbound message.
 */
export function isAllowed(
  phone: string,
  allowlist: ReadonlyArray<string>,
  demoMode: boolean,
): boolean {
  if (!demoMode) return true;
  if (allowlist.length === 0) return false;
  return allowlist.includes(phone);
}
