/**
 * Bun's `bun test` runner doesn't honour `--env-file=...` reliably across
 * platforms (Windows + Bun 1.3 in particular), so we shell out from a
 * tiny script that loads the workspace `.env` first and then spawns the
 * test runner. Use this for any test command that needs DATABASE_URL,
 * JWT secrets, or OPENAI_API_KEY.
 *
 * Usage:
 *   bun run --cwd apps/api test       # runs every *.test.ts in tests/
 *   bun run --cwd apps/api test:one tests/categorize.test.ts
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  const root = resolve(import.meta.dir, '..', '..', '..');
  const envFile = resolve(root, '.env');
  if (!existsSync(envFile)) {
    console.error(`No .env file at ${envFile}`);
    process.exit(1);
  }

  // Bun.dotenv() isn't a stable API across versions; readFile + split is fine.
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(envFile, 'utf8');
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
    if (!process.env[key]) process.env[key] = value;
  }

  // Force NODE_ENV=test and point at the test database when we have one.
  process.env.NODE_ENV = 'test';
  if (process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  }

  const args = ['test', ...process.argv.slice(2)];
  const child = spawn('bun', args, { stdio: 'inherit', env: process.env, shell: true });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error('run-tests failed:', err);
  process.exit(1);
});
