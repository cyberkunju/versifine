/**
 * Smoke test: register → wallet → seed mixed income/expense → fetch summary
 * (JSON + CSV).
 *
 *   bun run --cwd apps/api scripts/smoke-reports.ts
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
  const email = `reports+${Date.now()}@versifine.com`;
  const password = 'Versifine#2026!';

  type Auth = {
    user: { id: string; activeSpaceId: string };
    tokens: { accessToken: string };
  };
  const reg = await call<Auth>('POST', '/auth/register', {
    email,
    password,
    displayName: 'Reports Demo',
    primaryLanguage: 'en',
  });
  const access = reg.data.tokens.accessToken;

  type WalletEnvelope = { wallet: { id: string } };
  const w = await call<WalletEnvelope>(
    'POST',
    '/wallets',
    { name: 'HDFC', type: 'bank', currency: 'INR', openingBalance: 50000 },
    access,
  );
  const walletId = w.data.wallet.id;

  // Income (treated as type=income).
  await call(
    'POST',
    '/transactions',
    {
      type: 'income',
      amount: 80000,
      currency: 'INR',
      date: isoDaysAgo(20),
      description: 'Monthly Salary',
      walletId,
    },
    access,
  );

  // A handful of expenses across categories.
  const expenses: Array<{ amount: number; description: string; offset: number; category: string }> =
    [
      { amount: 1200, description: 'Swiggy Order', offset: 18, category: 'Food Delivery' },
      { amount: 4500, description: 'Big Basket Groceries', offset: 15, category: 'Groceries' },
      { amount: 2200, description: 'Uber Ride', offset: 12, category: 'Transportation' },
      { amount: 950, description: 'Starbucks Coffee', offset: 10, category: 'Coffee & Beverages' },
      { amount: 599, description: 'Netflix Subscription', offset: 8, category: 'Subscriptions' },
      { amount: 7200, description: 'Amazon Order', offset: 5, category: 'Shopping & Retail' },
    ];
  for (const e of expenses) {
    await call(
      'POST',
      '/transactions',
      {
        type: 'expense',
        amount: e.amount,
        currency: 'INR',
        date: isoDaysAgo(e.offset),
        description: e.description,
        walletId,
        category: e.category,
      },
      access,
    );
  }

  const from = isoDaysAgo(30);
  const to = isoDaysAgo(0);
  type ReportsEnvelope = {
    summary: {
      totals: { income: number; expense: number; savings: number; savingsRate: number };
      byCategory: Array<{ category: string; total: number }>;
      byMerchant: Array<{ merchant: string; total: number }>;
      byWallet: Array<{ walletId: string; walletName: string; total: number }>;
      budgetAdherence: Array<unknown>;
      transactionCount: number;
    };
  };
  const summary = await call<ReportsEnvelope>(
    'GET',
    `/reports/summary?from=${from}&to=${to}`,
    undefined,
    access,
  );
  const s = summary.data.summary;
  console.log(
    `  → income=₹${s.totals.income} expense=₹${s.totals.expense} savings=₹${s.totals.savings} (${s.totals.savingsRate}%)`,
  );
  console.log(
    `  → categories=${s.byCategory.length}, merchants=${s.byMerchant.length}, wallets=${s.byWallet.length}`,
  );
  console.log(`  → transactions counted: ${s.transactionCount}`);

  if (s.totals.expense <= 0) throw new Error('expected non-zero expense total');
  if (s.byCategory.length === 0) throw new Error('expected at least one category roll-up');

  // CSV variant — confirm we get a text/csv body back.
  const res = await fetch(`${BASE}/reports/summary.csv?from=${from}&to=${to}`, {
    headers: { authorization: `Bearer ${access}` },
  });
  console.log(`[${res.status}] GET /reports/summary.csv`);
  if (!res.ok) throw new Error(`csv request failed: ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.startsWith('text/csv')) throw new Error(`unexpected content-type ${ct}`);
  const csv = await res.text();
  if (!csv.includes('Totals')) throw new Error('csv missing Totals section');
  if (!csv.includes('By category')) throw new Error('csv missing By category section');
  console.log(`  → csv ${csv.length} chars, contains Totals/By category sections`);

  console.log('\nsmoke-reports: OK');
}

main().catch((err) => {
  console.error('smoke-reports: FAILED', err);
  process.exit(1);
});
