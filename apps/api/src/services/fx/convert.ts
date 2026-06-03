/**
 * Pure FX conversion helpers.
 *
 * No database, no network. Use these in the hot path of transaction
 * persistence so the caller controls when to fetch/persist a rate. Money
 * is rounded half-away-from-zero to two decimals (matches `numeric(14,2)`).
 */

/** Currency comparisons are case-insensitive on input but stored upper. */
export function normalizeCurrencyCode(input: string): string {
  return input.trim().toUpperCase();
}

/** Round to 2dp half-away-from-zero. Avoids the banker-rounding surprise. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100)) / 100;
}

/**
 * Convert `amount` from `currency` into `baseCurrency`.
 *
 * `fxRate` is "1 unit of currency in baseCurrency". When the two currencies
 * already match, the rate is ignored (1:1). Negative or non-finite rates
 * fall back to the input amount and the caller is expected to flag the row
 * with `needsFxResolution`.
 */
export function toBase(
  amount: number,
  currency: string,
  baseCurrency: string,
  fxRate: number,
): number {
  if (!Number.isFinite(amount)) return 0;
  if (normalizeCurrencyCode(currency) === normalizeCurrencyCode(baseCurrency)) {
    return roundMoney(amount);
  }
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    return roundMoney(amount);
  }
  return roundMoney(amount * fxRate);
}

/** Inverse: how many units of `quote` does 1 unit of `base` buy at the given rate? */
export function fromBase(
  baseAmount: number,
  baseCurrency: string,
  quoteCurrency: string,
  fxRate: number,
): number {
  if (!Number.isFinite(baseAmount)) return 0;
  if (normalizeCurrencyCode(baseCurrency) === normalizeCurrencyCode(quoteCurrency)) {
    return roundMoney(baseAmount);
  }
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    return roundMoney(baseAmount);
  }
  return roundMoney(baseAmount / fxRate);
}
