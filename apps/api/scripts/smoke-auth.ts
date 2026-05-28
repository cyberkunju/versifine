/**
 * Smoke test: register → login → /me → refresh → logout.
 * Run while the dev API is up:  bun run --cwd apps/api scripts/smoke-auth.ts
 */
export {}; // marks this file as a module so `main()` doesn't pollute the global scope.

const BASE = process.env.API_URL ?? 'http://localhost:5000';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  bearer?: string,
): Promise<Envelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as Envelope<T>;
  console.log(`[${res.status}] ${method} ${path}`, JSON.stringify(json, null, 2));
  if (!res.ok) {
    throw new Error(`request failed: ${method} ${path}`);
  }
  return json;
}

async function main() {
  const email = `demo+${Date.now()}@finehance.app`;
  const password = 'Finehance#2026!';

  type Auth = {
    user: { id: string; email: string; activeSpaceId: string };
    tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  };

  const reg = await call<Auth>('POST', '/auth/register', {
    email,
    password,
    displayName: 'Demo',
    primaryLanguage: 'en',
  });
  const access = reg.data!.tokens.accessToken;
  const refresh = reg.data!.tokens.refreshToken;

  await call('GET', '/auth/me', undefined, access);

  const re = await call<Auth>('POST', '/auth/refresh', { refreshToken: refresh });
  const access2 = re.data!.tokens.accessToken;

  const login = await call<Auth>('POST', '/auth/login', { email, password });
  await call('GET', '/auth/me', undefined, login.data!.tokens.accessToken);

  await call('POST', '/auth/logout', { refreshToken: re.data!.tokens.refreshToken }, access2);

  console.log('\nsmoke-auth: OK');
}

main().catch((err) => {
  console.error('smoke-auth: FAILED', err);
  process.exit(1);
});
