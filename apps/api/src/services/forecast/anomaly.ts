/**
 * Anomaly detector — z-score over a 14-day rolling window.
 *
 * For each day we compare the actual spend against a 14-day trailing mean
 * and standard deviation. A z-score with absolute value ≥ 2.5 flags the
 * day; the reason string is built from whichever of two narratives reads
 * more useful to the user:
 *
 *   - "highest in 90 days" when the value is the all-time max in the
 *     supplied window; punchy, no maths required.
 *   - "3.2× the rolling mean" otherwise; gives them a multiplier they can
 *     reason about without knowing what a z-score is.
 *
 * The window is one-sided (looks back, never forward) so today's spike
 * doesn't get smeared into yesterday's normal. Days inside the warmup
 * (the first 14 entries) are skipped — there's no rolling mean to compare
 * against until we've collected enough history.
 */

const WINDOW = 14;
const Z_THRESHOLD = 2.5;

export interface AnomalyInput {
  date: string;
  amount: number;
}

export interface AnomalyResult {
  date: string;
  amount: number;
  zscore: number;
  reason: string;
}

export function detectAnomalies(daySeries: AnomalyInput[]): AnomalyResult[] {
  if (daySeries.length === 0) return [];

  // Sort to be defensive — callers usually provide ascending order but it
  // costs little to enforce here so the rolling window is always correct.
  const sorted = [...daySeries].sort((a, b) => a.date.localeCompare(b.date));

  let allTimeMax = -Infinity;
  for (const d of sorted) {
    if (d.amount > allTimeMax) allTimeMax = d.amount;
  }

  const anomalies: AnomalyResult[] = [];

  for (let i = WINDOW; i < sorted.length; i += 1) {
    const target = sorted[i];
    if (!target) continue;
    const window = sorted.slice(i - WINDOW, i);
    const mean = average(window.map((d) => d.amount));
    if (mean <= 0) continue;
    const stddev = sampleStddev(window.map((d) => d.amount), mean);
    if (stddev <= 0) continue;
    const zscore = (target.amount - mean) / stddev;
    if (Math.abs(zscore) < Z_THRESHOLD) continue;

    let reason: string;
    if (target.amount === allTimeMax) {
      reason = `highest in the last ${sorted.length} days`;
    } else {
      const ratio = mean > 0 ? target.amount / mean : 0;
      reason = `${ratio.toFixed(1)}× the rolling mean`;
    }

    anomalies.push({
      date: target.date,
      amount: round2(target.amount),
      zscore: round2(zscore),
      reason,
    });
  }

  return anomalies;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function sampleStddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  let s = 0;
  for (const v of values) s += (v - mean) ** 2;
  return Math.sqrt(s / (values.length - 1));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
