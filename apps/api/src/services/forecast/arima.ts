/**
 * In-house ARIMA(1,1,1) forecaster.
 *
 * Hannan-Rissanen-style two-stage estimation:
 *
 *   1. Difference the series once (Δy_t = y_t − y_{t-1}) so the level
 *      trend leaves the model and we work with stationary residuals.
 *   2. Fit AR(1): φ = Σ Δy_t·Δy_{t-1} / Σ Δy_{t-1}². Closed-form least
 *      squares — no optimiser, no NaN drama.
 *   3. Compute innovations ε_t = Δy_t − φ·Δy_{t-1}.
 *   4. Fit MA(1): five Gauss-Seidel passes solving the same normal
 *      equation as step 2 but on residuals shifted by one. Five iterations
 *      is enough for the |θ| < 1 region we care about; outside that the
 *      whole model is unsuitable anyway and we fall back upstream.
 *   5. Forecast h steps recursively in the differenced space, then
 *      cumulate back to the level series. Confidence intervals come from
 *      the residual standard error scaled by √h (a textbook approximation;
 *      good enough at the personal-finance horizon).
 *
 * If anything misbehaves — too few points, NaN, exploding coefficients —
 * we hand back a 7-day rolling-mean projection extended along the recent
 * slope. Demonstrably worse, but it always produces a number.
 */

const Z_95 = 1.96;
const MIN_SERIES_LENGTH = 14;
const MAX_ABS_COEFF = 0.99;

export interface ForecastResult {
  forecasts: number[];
  lower: number[];
  upper: number[];
  method: 'arima' | 'rolling_average';
}

export function forecastSeries(values: number[], horizon: number): ForecastResult {
  if (horizon <= 0) {
    return { forecasts: [], lower: [], upper: [], method: 'rolling_average' };
  }

  const cleaned = sanitize(values);
  if (cleaned.length < MIN_SERIES_LENGTH) {
    return rollingAverageProjection(cleaned, horizon);
  }

  const arima = tryFitArima(cleaned, horizon);
  if (arima) return arima;

  return rollingAverageProjection(cleaned, horizon);
}

function tryFitArima(series: number[], horizon: number): ForecastResult | null {
  const diffs = firstDifference(series);
  if (diffs.length < MIN_SERIES_LENGTH - 1) return null;

  const phi = fitAr1(diffs);
  if (!Number.isFinite(phi) || Math.abs(phi) > MAX_ABS_COEFF) return null;

  const innovations: number[] = [];
  for (let i = 1; i < diffs.length; i += 1) {
    const prev = diffs[i - 1];
    const curr = diffs[i];
    if (prev === undefined || curr === undefined) return null;
    innovations.push(curr - phi * prev);
  }
  if (innovations.length < 4) return null;

  const theta = fitMa1(innovations);
  if (!Number.isFinite(theta) || Math.abs(theta) > MAX_ABS_COEFF) return null;

  const residuals: number[] = [];
  let lastInnovation = 0;
  for (let i = 0; i < innovations.length; i += 1) {
    const eps = innovations[i];
    if (eps === undefined) return null;
    const expected = theta * lastInnovation;
    residuals.push(eps - expected);
    lastInnovation = eps;
  }
  const sigma = sampleStddev(residuals);
  if (!Number.isFinite(sigma) || sigma < 0) return null;

  // Recursive forecast in the differenced space.
  const forecastsDiff: number[] = [];
  const lastDiff = diffs[diffs.length - 1];
  if (lastDiff === undefined) return null;
  let prevDiff = lastDiff;
  let prevInnovation = residuals[residuals.length - 1] ?? 0;
  for (let h = 0; h < horizon; h += 1) {
    const next = phi * prevDiff + theta * prevInnovation;
    if (!Number.isFinite(next)) return null;
    forecastsDiff.push(next);
    prevDiff = next;
    // After step 1, future innovations are zero in the conditional mean.
    prevInnovation = 0;
  }

  // Cumulate diffs back to the level series.
  const lastValue = series[series.length - 1];
  if (lastValue === undefined) return null;
  const forecasts: number[] = [];
  let running = lastValue;
  for (const d of forecastsDiff) {
    running = Math.max(0, running + d);
    forecasts.push(running);
  }

  // 95% CI: σ × √h, widening with the horizon.
  const lower: number[] = [];
  const upper: number[] = [];
  for (let h = 0; h < horizon; h += 1) {
    const halfWidth = Z_95 * sigma * Math.sqrt(h + 1);
    const point = forecasts[h] ?? 0;
    lower.push(Math.max(0, point - halfWidth));
    upper.push(point + halfWidth);
  }

  if (forecasts.some((v) => !Number.isFinite(v))) return null;

  return { forecasts, lower, upper, method: 'arima' };
}

function firstDifference(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const a = series[i - 1];
    const b = series[i];
    if (a === undefined || b === undefined) continue;
    out.push(b - a);
  }
  return out;
}

function fitAr1(diffs: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 1; i < diffs.length; i += 1) {
    const prev = diffs[i - 1];
    const curr = diffs[i];
    if (prev === undefined || curr === undefined) continue;
    num += curr * prev;
    den += prev * prev;
  }
  if (den <= 0) return 0;
  return num / den;
}

function fitMa1(innovations: number[]): number {
  // Gauss-Seidel: solve Σ ε_t · ε_{t-1} = θ · Σ ε_{t-1}^2 with shifted
  // residuals on each pass. Re-bake residuals from theta and repeat.
  let theta = 0;
  for (let iter = 0; iter < 5; iter += 1) {
    let num = 0;
    let den = 0;
    let prev = 0;
    for (let i = 0; i < innovations.length; i += 1) {
      const eps = innovations[i];
      if (eps === undefined) continue;
      const r = eps - theta * prev;
      num += r * prev;
      den += prev * prev;
      prev = eps;
    }
    if (den <= 0) break;
    const next = num / den;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - theta) < 1e-4) {
      theta = next;
      break;
    }
    theta = next;
  }
  return theta;
}

function rollingAverageProjection(values: number[], horizon: number): ForecastResult {
  if (values.length === 0) {
    return {
      forecasts: new Array(horizon).fill(0),
      lower: new Array(horizon).fill(0),
      upper: new Array(horizon).fill(0),
      method: 'rolling_average',
    };
  }

  const window = Math.min(7, values.length);
  const tail = values.slice(-window);
  const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
  const sigma = sampleStddev(tail);

  // Light slope: average diff across the tail. Keeps the projection from
  // being a perfect flat line when there's an obvious trajectory.
  let slope = 0;
  if (tail.length >= 2) {
    let s = 0;
    let n = 0;
    for (let i = 1; i < tail.length; i += 1) {
      const a = tail[i - 1];
      const b = tail[i];
      if (a === undefined || b === undefined) continue;
      s += b - a;
      n += 1;
    }
    if (n > 0) slope = s / n;
  }

  const forecasts: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];
  for (let h = 0; h < horizon; h += 1) {
    const point = Math.max(0, mean + slope * (h + 1));
    forecasts.push(point);
    const halfWidth = Z_95 * (sigma || mean * 0.25) * Math.sqrt(h + 1);
    lower.push(Math.max(0, point - halfWidth));
    upper.push(point + halfWidth);
  }

  return { forecasts, lower, upper, method: 'rolling_average' };
}

function sanitize(values: number[]): number[] {
  return values.map((v) => (Number.isFinite(v) && v >= 0 ? v : 0));
}

function sampleStddev(values: number[]): number {
  if (values.length < 2) return 0;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) ** 2;
  return Math.sqrt(sq / (values.length - 1));
}
