/**
 * Test preload — loads the repo-root `.env` so the bot's config.ts can
 * validate at module-load time. Without this every test fails with
 * "BOT_SECRET: Required" before any test body runs.
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

// The bot doesn't talk to the API in this test (apiClient is mocked) so
// the URL value is irrelevant — the env validator just needs SOMETHING.
if (!process.env.API_URL) process.env.API_URL = 'http://localhost:5000';
process.env.NODE_ENV = 'test';
