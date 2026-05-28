/**
 * Tiny number-formatting helpers. Kept separate so message packs and
 * flow files import a single function without pulling whole locales.
 */

/**
 * Render a rupee amount with Indian-style grouping (12,34,567). The
 * lakh/crore comma layout is jarring when displayed with US grouping,
 * so we group the trailing three digits then pairs of two.
 */
export function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const [intPart, decPartRaw] = abs.toFixed(2).split('.') as [string, string];
  const decPart = decPartRaw === '00' ? '' : `.${decPartRaw}`;
  if (intPart.length <= 3) return `${negative ? '-' : ''}${intPart}${decPart}`;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped},${last3}${decPart}`;
}

/** Convenience for "₹12,34,567" rendering. */
export function rupees(amount: number): string {
  return `₹${formatINR(amount)}`;
}
