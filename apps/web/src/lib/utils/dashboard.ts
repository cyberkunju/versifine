/**
 * Dashboard data helpers.
 *
 * Pure, framework-free utilities the dashboard composes: month-range math,
 * client-side daily bucketing of transactions (the API exposes no per-day
 * series), an editorial category-colour system, and small numeric
 * formatters. Kept here so the page component stays declarative.
 */
import { CATEGORY_META, type Category } from '@versifine/shared';
import type { TransactionSummary } from '$lib/api/types';

/* ── Month / range math ─────────────────────────────────────────────── */

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface MonthRange {
  from: string;
  to: string;
  /** First day of the month (local). */
  start: Date;
  /** Last relevant day — today if the month is current, else month end. */
  end: Date;
  /** Number of days in the calendar month. */
  daysInMonth: number;
  /** Human label, e.g. "May 2026". */
  label: string;
  /** True when the range is the live, in-progress month. */
  isCurrent: boolean;
}

/** Build a month range `offset` months back from now (0 = current month). */
export function monthRange(offset = 0): MonthRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const isCurrent = offset === 0;
  const end = isCurrent ? now : monthEnd;
  return {
    from: isoDate(start),
    to: isoDate(end),
    start,
    end: monthEnd,
    daysInMonth: monthEnd.getDate(),
    label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    isCurrent,
  };
}

/* ── Daily expense bucketing ────────────────────────────────────────── */

export interface DayBucket {
  /** Day of month, 1-based. */
  day: number;
  date: string;
  expense: number;
  income: number;
  count: number;
}

/**
 * Bucket transactions into one entry per calendar day of the month. Expense
 * and income are summed in base currency. Transfers are excluded (they net
 * to zero across wallets and would double-count cashflow).
 */
export function bucketByDay(txns: TransactionSummary[], range: MonthRange): DayBucket[] {
  const buckets: DayBucket[] = Array.from({ length: range.daysInMonth }, (_, i) => ({
    day: i + 1,
    date: isoDate(new Date(range.start.getFullYear(), range.start.getMonth(), i + 1)),
    expense: 0,
    income: 0,
    count: 0,
  }));
  for (const t of txns) {
    if (t.type === 'transfer') continue;
    const d = new Date(t.date);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getFullYear() !== range.start.getFullYear() || d.getMonth() !== range.start.getMonth()) {
      continue;
    }
    const idx = d.getDate() - 1;
    const b = buckets[idx];
    if (!b) continue;
    const amt = Math.abs(t.baseAmount);
    if (t.type === 'income') b.income += amt;
    else b.expense += amt;
    b.count += 1;
  }
  return buckets;
}

/** Cumulative expense running total across the day buckets. */
export function cumulative(buckets: DayBucket[]): number[] {
  let acc = 0;
  return buckets.map((b) => (acc += b.expense));
}

/* ── Editorial category colour system ───────────────────────────────── */

/**
 * CATEGORY_META carries a tailwind "hue" token only. We map each hue to a
 * single, deliberately muted, deep tone so 20+ categories stay legible side
 * by side without turning into a neon rainbow — every colour shares a
 * similar weight and saturation, harmonised against the indigo ink palette.
 */
const HUE_HSL: Record<string, string> = {
  slate: '222 12% 50%',
  blue: '224 48% 48%',
  emerald: '160 38% 40%',
  amber: '38 58% 48%',
  rose: '350 52% 55%',
  violet: '262 40% 55%',
  cyan: '190 46% 42%',
  orange: '24 62% 52%',
  lime: '92 34% 44%',
  pink: '330 52% 60%',
};

/** Resolve a category to an `hsl(...)` string for fills/strokes. */
export function categoryColor(category: string | null | undefined, alpha = 1): string {
  const meta = category ? CATEGORY_META[category as Category] : undefined;
  const hsl = (meta && HUE_HSL[meta.hue]) || HUE_HSL.slate;
  return alpha >= 1 ? `hsl(${hsl})` : `hsl(${hsl} / ${alpha})`;
}

export function categoryIcon(category: string | null | undefined): string {
  const meta = category ? CATEGORY_META[category as Category] : undefined;
  return meta?.icon ?? '•';
}

/* ── Small formatters ───────────────────────────────────────────────── */

/** Compact INR for axis ticks: 1.2L, 45k, 980. */
export function compactINR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(abs % 1_00_00_000 === 0 ? 0 : 1)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(abs % 1_00_000 === 0 ? 0 : 1)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

export function pct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

/** Percentage change a→b, guarding divide-by-zero. Returns null when base is 0. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
