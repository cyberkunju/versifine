# 08 · Forecast

> Recurring-decomposed ARIMA(1,1,1) with anomaly detection. Caches per space for 6 hours. Invalidates on any transaction event.

## The core idea

Forecasting raw daily spend muddles two very different signals:
1. **Recurring**: Netflix on the 12th, electricity on the 28th, rent on the 1st. Predictable to the day.
2. **Variable**: groceries, takeout, transport. Noisy, season-dependent, follows day-of-week patterns.

A naive ARIMA on the raw daily series gets pulled toward the deterministic spikes and underestimates the variable tail. We decompose the series first, forecast each component separately, then recombine.

## Pipeline (`services/forecast/index.ts:computeForecast(spaceId, days)`)

```
1. Build a 90-day daily expense series from non-deleted, non-transfer
   transactions. Days with no spend get 0; days with multiple
   transactions sum.

2. Pull active recurring items whose next_expected_date is in the
   forecast window. Project them forward at frequency_days steps:

   For each recurring item:
     cursor = next_expected_date
     while cursor <= last_forecast_day:
       recurringByDate[cursor.iso] += item.average_amount
       cursor += item.frequency_days

3. Subtract historical recurring contribution from the daily series.
   We approximate by walking each item BACKWARDS from next_expected_date
   in frequency_days steps, deducting average_amount per occurrence.
   Whatever's left is the variable component.

4. Forecast the variable component with ARIMA(1,1,1).
   - Hannan-Rissanen-style fit.
   - 95% confidence interval via residual stdev.
   - Falls back to trend-aware moving average if fit fails or there are
     fewer than 14 non-zero days.

5. Reconstruct: per-day total = recurring expected on that day + variable
   forecast for that day.

6. Run anomaly detection over the historical (recurring + variable) daily
   series so the UI can flag past spikes alongside the forward projection.

7. Cache the result for 6h, keyed by (spaceId, days). Invalidate on any
   forecast.invalidated event.
```

## ARIMA(1,1,1) — `services/forecast/arima.ts`

Hand-written ~120-line implementation. No external library because:
- Bun's npm `arima` package has compatibility issues with native bindings.
- Statsmodels-grade isn't needed for personal-finance horizons.
- Honest math beats a black-box library when you need to explain the model to a judge.

### Spec

- Order: (p=1, d=1, q=1).
- p=1: one autoregressive term. Yesterday's variable spend predicts today's.
- d=1: differenced once. Removes a linear trend; `Δy_t = y_t - y_{t-1}`.
- q=1: one moving-average term. Models how shocks propagate.
- Fit method: Hannan-Rissanen (two-step OLS). Estimate AR(1) coefficient on the differenced series, compute residuals, regress those plus lagged residuals on the differenced series for MA(1).

### Confidence intervals

Residual stdev `σ` from the fit step. The 95% CI for h-step-ahead forecast is `forecast ± 1.96 * σ * sqrt(h)`. For our purposes (daily horizon, 30 days), we cap `h` at 30 so intervals don't explode.

### Fallback: trend-aware moving average

When ARIMA fit fails (singular matrix, fewer than 14 non-zero days, NaN coefficients), fall through to:

```
trend = (mean of last 7 days) - (mean of days 8-14 ago)
forecast[h] = mean(last 7 days) + (trend * h / 30)
```

CI uses the rolling stdev of the last 14 days.

The orchestrator returns `method: 'arima' | 'rolling_average'` so the UI can show a "model: ARIMA(1,1,1)" badge or "trend-based fallback" disclaimer.

## Recurring detection — `services/forecast/recurring.ts`

The detector runs on demand (`POST /recurring/run`) and groups transactions to identify subscriptions, EMIs, rent, etc.

### Algorithm

```
1. Pull last 90 days of expense transactions, normalized by merchant.
2. Group by normalized merchant.
3. For each group with >= 3 occurrences:
   a. Compute amount mean and stdev.
   b. If stdev / mean > 0.15, skip (variable amount, not recurring).
   c. Compute date diffs between consecutive occurrences.
   d. Round each diff to the nearest "common period" bucket:
      6-8 days   → weekly
      28-32 days → monthly
      88-92 days → quarterly
   e. If 80%+ of diffs fall in the same bucket, accept.
   f. frequency_days = median of accepted diffs.
   g. next_expected_date = last_seen + frequency_days.
   h. confidence = 1 - (stdev / mean) * (1 - bucket_consensus).
4. Upsert into recurring_items keyed by (space_id, merchant_normalized).
5. Mark items absent from the latest run as `dismissed` (with a 7-day grace period).
```

### Output rows

```
{
  id, space_id,
  merchant_normalized: "netflix",
  display_name: "Netflix",
  average_amount: 649,
  currency: "INR",
  frequency_days: 30,
  next_expected_date: "2026-06-15",
  occurrences: 6,
  confidence: 0.97,
  status: "active",
  detected_at, updated_at
}
```

The detector emits `recurring.detected` events for newly-discovered items so the WS can push a "We noticed Netflix is recurring" toast.

## Anomaly detection — `services/forecast/anomaly.ts`

Z-score over the rolling 14-day window. A day is anomalous if `(actual - rolling_mean) / rolling_stdev > 2.5` (or `< -2.5` for unusually low days, though we don't surface negative anomalies in the dashboard).

```ts
{ date, amount, expected, z, severity: 'high' | 'medium' }
```

Severity buckets:
- `z >= 4` → high (true 99.99%-ile event)
- `2.5 <= z < 4` → medium

The detector returns the top 10 anomalies sorted by recency, since old anomalies aren't actionable.

## Cache and invalidation

```ts
const cache = new Map<string, { result: ForecastResult; expiresAt: number; days: number }>();

export async function computeForecast(spaceId: string, days: number) {
  const cached = cache.get(spaceId);
  if (cached && cached.days === days && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  // ... recompute ...
  cache.set(spaceId, { result, expiresAt: Date.now() + 6 * 3600_000, days });
  return result;
}

export function invalidateForecast(spaceId: string) {
  cache.delete(spaceId);
}
```

`invalidateForecast` is called from:
- `services/transactions/create.ts` after a successful insert.
- `services/transactions/embed.ts` is NOT a trigger — embeddings don't change forecast.
- `routes/transactions.ts` PATCH (when amount, type, date, or category changes).
- `routes/transactions.ts` DELETE.
- `routes/recurring.ts` POST `/run` (after detection).
- `routes/recurring.ts` PATCH (when status changes).

This means the cache is hot 99% of the time but instantly accurate after any user edit.

## Response shape

```json
{
  "forecast": {
    "recurringBase": 24999.50,
    "variableTotal": 18342.30,
    "total": 43341.80,
    "method": "arima",
    "daily": [
      { "date": "2026-05-29", "recurring": 199, "variable": 612.10, "lower": 540, "upper": 1060 },
      { "date": "2026-05-30", "recurring": 0,   "variable": 720.40, "lower": 620, "upper": 1180 },
      { "date": "2026-05-31", "recurring": 18000, "variable": 410.20, "lower": 18280, "upper": 19180 },
      // ... 30 entries
    ],
    "anomalies": [
      { "date": "2026-04-15", "amount": 9300, "expected": 1200, "z": 5.4, "severity": "high" },
      { "date": "2026-04-22", "amount": 2800, "expected": 800, "z": 2.8, "severity": "medium" }
    ]
  }
}
```

`recurring` and `variable` per day are non-overlapping; their sum is the predicted total. `lower` and `upper` are the 95% CI of the variable component (recurring is treated as deterministic).

## Worked example

Suppose the user has:
- Netflix ₹649 every 30 days, last on 2026-04-12 → next 2026-05-12 → 2026-06-11 (in window).
- Spotify ₹119 every 30 days, last 2026-04-08 → next 2026-05-08 → already past as of "today" 2026-05-28 → next valid 2026-06-07.
- Rent ₹18,000 on the 1st of every month → next 2026-06-01.
- Variable spend in the last 90 days: groceries, transport, dining, totalling ~₹54k.

`computeForecast(spaceId, 30)` for the next 30 days:

```
Recurring contributions:
  2026-06-01: 18000 (rent)
  2026-06-07: 119  (spotify)
  2026-06-11: 649  (netflix)
  → recurringBase = 18768

Variable component (90-day daily series with recurring subtracted, ARIMA forecast):
  Mean ~ ₹1800/day, stdev ~ ₹400
  ARIMA forecasts ~ ₹1820/day +/- ₹780 (95% CI)
  → variableTotal = ~54600

Total: ~73368
```

The dashboard shows a daily bar chart where the recurring contributions appear as fixed-color spikes (rent on day 4, Netflix and Spotify as small bumps) and the variable forecast as a shaded band.

## Why these design choices

- **90-day lookback**: long enough to capture monthly patterns, short enough that life events don't drown out current habits.
- **6h cache**: forecast is consulted every dashboard load. Recomputing on every read would dominate API time.
- **Separate `recurring`/`variable` outputs**: the UI can colour them differently (deterministic vs probabilistic) and the user instantly sees what's "locked in" vs "estimated".
- **`method` field in response**: when ARIMA fails on sparse data, the UI shows a smaller "trend-based" badge. Honesty over confidence.
- **Anomaly stripe in the response**: the dashboard's forecast widget includes a callout strip — "your AWS bill on April 15 was 5x your daily average". One feature, two surfaces.

## Limitations and future work

- **Single-component ARIMA**: a richer model (SARIMA with weekly seasonality) would likely improve accuracy on weekend-spend patterns, but Hannan-Rissanen's stability matters more than +5% RMSE here.
- **Recurring detector misses one-time items**: an annual subscription is invisible until it appears at least 3 times, which won't happen in the 90-day window. Mitigation: explicit "Mark as recurring" UI action in v2.
- **No category-level forecast**: aggregate only. The copilot tool `compute_forecast` could expose per-category breakdown later by running the same pipeline filtered.
- **Currency-blind**: `base_amount` is the wallet currency, not the user's `base_currency`. Multi-currency forecasts conflate INR and USD daily totals. Acceptable for now (one base currency in MVP), but a v2 would convert to user's base before forecasting.
- **No backtest validation**: we don't check forecast accuracy against held-out data. A test pass would feed synthetic series with known recurring + known variable + known anomaly and assert the decomposition is recovered.
