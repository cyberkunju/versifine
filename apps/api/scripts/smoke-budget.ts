/**
 * Smoke test: register → create budget → get progress → update → delete.
 * Run while the dev API is up: bun run --cwd apps/api scripts/smoke-budget.ts
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

async function main() {
  const email = `budget+${Date.now()}@versifine.com`;
  const password = 'Versifine#2026!';

  type Auth = {
    user: { id: string; activeSpaceId: string };
    tokens: { accessToken: string };
  };

  const reg = await call<Auth>('POST', '/auth/register', {
    email,
    password,
    displayName: 'Budget Demo',
    primaryLanguage: 'en',
  });
  const access = reg.data.tokens.accessToken;

  // Create a monthly budget across two categories.
  type BudgetEnvelope = { budget: { id: string; warnThreshold: number; exceedThreshold: number } };
  const create = await call<BudgetEnvelope>(
    'POST',
    '/budgets',
    {
      name: 'May 2026',
      recurrence: 'monthly',
      allocations: { Groceries: 5000, 'Coffee & Beverages': 1500 },
      warnThreshold: 75,
      exceedThreshold: 100,
    },
    access,
  );
  const budgetId = create.data.budget.id;
  console.log(`  → created ${budgetId} warn=${create.data.budget.warnThreshold} exceed=${create.data.budget.exceedThreshold}`);

  await call('GET', '/budgets', undefined, access);
  await call(`GET`, `/budgets/${budgetId}/progress`, undefined, access);

  await call(
    'PATCH',
    `/budgets/${budgetId}`,
    { allocations: { Groceries: 6000, 'Coffee & Beverages': 1500 }, warnThreshold: 80 },
    access,
  );

  await call('DELETE', `/budgets/${budgetId}`, undefined, access);

  console.log('\nsmoke-budget: OK');
}

main().catch((err) => {
  console.error('smoke-budget: FAILED', err);
  process.exit(1);
});
