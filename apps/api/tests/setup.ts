/**
 * Test preload — loads the repo-root `.env` so every test sees the same
 * environment as `bun run dev`. Bun's test runner ignores `--env-file`
 * and the workspace cwd is `apps/api`, so the .env at the workspace root
 * is invisible without this preload.
 *
 * Wired through `bunfig.toml` (`[test] preload = ["./tests/setup.ts"]`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(import.meta.dir, '..', '..', '..', '.env');

if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Tests should always run against the dedicated test database. Switch
// DATABASE_URL to the test variant so a wayward truncate doesn't blow
// away the dev data.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
process.env.NODE_ENV = 'test';
