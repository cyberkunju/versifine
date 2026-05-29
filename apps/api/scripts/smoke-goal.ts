/**
 * Smoke test: register → create goal → list → record progress → patch →
 * fetch → delete. Exercises projection math, goal.updated event path,
 * and auto-archive on target reached.
 *
 * Run while the dev API is up: bun run --cwd apps/api scripts/smoke-goal.ts
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
  const email = `goal+${Date.now()}@versifine.com`;
  const password = 'Versifine#2026!';

  type Auth = {
    user: { id: string; activeSpaceId: string };
    tokens: { accessToken: string };
  };

  const reg = await call<Auth>('POST', '/auth/register', {
    email,
    password,
    displayName: 'Goal Demo',
    primaryLanguage: 'en',
  });
  const access = reg.data.tokens.accessToken;

  // Create a goal — half a year out, with a category link to make the
  // projection use the recent-spending path instead of the linear fallback.
  type GoalEnvelope = {
    goal: {
      id: string;
      currentAmount: number;
      targetAmount: number;
      progressPercentage: number;
      status: string;
      atRisk: boolean;
      projectedCompletion: string | null;
    };
  };
  const sixMonthsOut = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);
  const create = await call<GoalEnvelope>(
    'POST',
    '/goals',
    {
      name: 'New Macbook',
      targetAmount: 200000,
      currentAmount: 5000,
      deadline: sixMonthsOut,
      linkedCategory: 'Shopping & Retail',
    },
    access,
  );
  const goalId = create.data.goal.id;
  console.log(`  → created ${goalId} progress=${create.data.goal.progressPercentage}%`);

  // List active goals.
  type ListEnvelope = { goals: Array<{ id: string; status: string }> };
  const list = await call<ListEnvelope>('GET', '/goals?status=active', undefined, access);
  console.log(`  → list active goals=${list.data.goals.length}`);

  // Record progress that doesn't quite hit the target.
  const p1 = await call<GoalEnvelope>(
    'POST',
    `/goals/${goalId}/progress`,
    { amount: 15000, note: 'Diwali bonus' },
    access,
  );
  console.log(
    `  → progress now ${p1.data.goal.currentAmount} (${p1.data.goal.progressPercentage}%) status=${p1.data.goal.status}`,
  );

  // PATCH: shrink the target so the next progress flips status to achieved.
  await call('PATCH', `/goals/${goalId}`, { targetAmount: 25000 }, access);

  const p2 = await call<GoalEnvelope>(
    'POST',
    `/goals/${goalId}/progress`,
    { amount: 10000 },
    access,
  );
  console.log(
    `  → after second progress: ${p2.data.goal.currentAmount}/${p2.data.goal.targetAmount} status=${p2.data.goal.status}`,
  );
  if (p2.data.goal.status !== 'achieved') {
    throw new Error(`expected status=achieved, got ${p2.data.goal.status}`);
  }

  // Fetch.
  await call(`GET`, `/goals/${goalId}`, undefined, access);

  // Cleanup.
  await call('DELETE', `/goals/${goalId}`, undefined, access);

  console.log('\nsmoke-goal: OK');
}

main().catch((err) => {
  console.error('smoke-goal: FAILED', err);
  process.exit(1);
});
