/**
 * Smoke test: register → wallet → seed daily expense pattern → forecast.
 *
 * The seed mixes a steady weekly subscription with noisy daily spend so
 * the recurring decomposition has something to bite on. We then ask for a
 * 30-day forecast and assert the shape is correct.
 *
 *   bun run --cwd apps/api scripts/smoke-forecast.ts
 */
export {};

const BASE = process.env.API_URL ?? 'http://localhost:5000';

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  bearer?: string,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { success: boolean; data?: T; error?: { message: string } };
  console.log(`[${res.status}] ${method} ${path}`);
  if (!res.ok) {
    console.log(JSON.stringify(json, null, 2));
    throw new Error(`request failed: ${method} ${path}`);
  }
  return { status: res.status, data: json.data as T };
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const email = `forecast+${Date.now()}@versifine.com`;
  const password = 'Versifine#2026!';

  type Auth = {
    user: { id: string; activeSpaceId: string };
    tokens: { accessToken: string };
  };
  const reg = await call<Auth>('POST', '/auth/register', {
    email,
    password,
    displayName: 'Forecast Demo',
    primaryLanguage: 'en',
  });
  const access = reg.data.tokens.accessToken;

  type WalletEnvelope = { wallet: { id: string } };
  const w = await call<WalletEnvelope>(
    'POST',
    '/wallets',
    { name: 'HDFC', type: 'bank', currency: 'INR', openingBalance: 200000 },
    access,
  );
  const walletId = w.data.wallet.id;

  // Steady weekly subscription.
  for (let offset = 84; offset >= 0; offset -= 7) {
    await call(
      'POST',
      '/transactions',
      {
        type: 'expense',
        amount: 199,
        currency: 'INR',
        date: isoDaysAgo(offset),
        description: 'Spotify Subscription',
        walletId,
      },
      access,
    );
  }

  // Noisy daily food/transport for the last 60 days.
  let seed = 42;
  for (let offset = 60; offset >= 0; offset -= 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const amount = 250 + (seed % 600);
    await call(
      'POST',
      '/transactions',
      {
        type: 'expense',
        amount,
        currency: 'INR',
        date: isoDaysAgo(offset),
        description: offset % 2 === 0 ? 'Swiggy Order' : 'Uber Ride',
        walletId,
      },
      access,
    );
  }

  // Run the recurring detector first so the forecast can decompose recurring spend.
  await call('POST', '/recurring/run', {}, access);

  // Get the forecast.
  type ForecastEnvelope = {
    forecast: {
      recurringBase: number;
      variableTotal: number;
      total: number;
      method: string;
      daily: Array<{ date: string; recurring: number; variable: number; lower: number; upper: number }>;
      anomalies: Array<{ date: string; amount: number; zscore: number; reason: string }>;
    };
  };
  const f = await call<ForecastEnvelope>('GET', '/forecast?days=30', undefined, access);
  const fc = f.data.forecast;
  console.log(
    `  → forecast: total=₹${fc.total} (recurring=₹${fc.recurringBase}, variable=₹${fc.variableTotal}) via ${fc.method}`,
  );
  console.log(`  → daily entries: ${fc.daily.length}, anomalies flagged: ${fc.anomalies.length}`);

  if (fc.daily.length !== 30) throw new Error(`expected 30 daily entries, got ${fc.daily.length}`);
  if (!Number.isFinite(fc.total)) throw new Error('total is not a number');

  // Pull again to confirm the cache returns the same shape.
  const cached = await call<ForecastEnvelope>('GET', '/forecast?days=30', undefined, access);
  if (Math.abs(cached.data.forecast.total - fc.total) > 0.01) {
    throw new Error('cached forecast diverged from first call');
  }
  console.log('  → cache returned consistent total');

  console.log('\nsmoke-forecast: OK');
}

main().catch((err) => {
  console.error('smoke-forecast: FAILED', err);
  process.exit(1);
});
