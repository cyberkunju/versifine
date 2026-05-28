/**
 * Bot supervisor.
 *
 * Spawns `bun src/index.ts` as a child process, watches its exit code,
 * and restarts with exponential backoff when it crashes. Designed for the
 * hackathon scale — one process, single-machine, no orchestration.
 *
 * Backoff: 1s → 5s → 15s → 1m → 5m. Resets when the child runs cleanly
 * for >5 minutes. Ctrl-C propagates SIGTERM to the child and exits.
 *
 * Usage: `bun run --cwd apps/wa-bot dev:supervised`
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { log } from './utils/logger.ts';

const ENTRY = resolve(import.meta.dirname, 'index.ts');
const BACKOFF_MS = [1_000, 5_000, 15_000, 60_000, 300_000];
const RESET_AFTER_MS = 5 * 60_000;

let attempt = 0;
let stopping = false;
let currentChild: ReturnType<typeof spawn> | null = null;

function nextBackoff(): number {
  const idx = Math.min(attempt, BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx] ?? 300_000;
}

async function spawnChild(): Promise<number> {
  const startedAt = Date.now();
  log.info('SUPERVISOR_SPAWN', { entry: ENTRY, attempt });
  const child = spawn('bun', ['--env-file=../../.env', ENTRY], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  currentChild = child;

  return await new Promise<number>((resolveExit) => {
    child.on('exit', (code) => {
      currentChild = null;
      const liveMs = Date.now() - startedAt;
      log.warn('SUPERVISOR_CHILD_EXIT', { code: code ?? -1, liveMs });
      if (liveMs > RESET_AFTER_MS) attempt = 0;
      resolveExit(code ?? -1);
    });
  });
}

async function loop() {
  while (!stopping) {
    const code = await spawnChild();
    if (stopping) break;
    if (code === 0) {
      log.info('SUPERVISOR_CLEAN_EXIT', {});
      return;
    }
    attempt += 1;
    const delay = nextBackoff();
    log.info('SUPERVISOR_BACKOFF', { attempt, delayMs: delay });
    await new Promise((r) => setTimeout(r, delay));
  }
}

const handleSignal = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info('SUPERVISOR_SIGNAL', { signal });
  if (currentChild) currentChild.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1_500);
};

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

loop().catch((err) => {
  log.error('SUPERVISOR_FAIL', {
    error: err instanceof Error ? err.message.slice(0, 240) : String(err),
  });
  process.exit(1);
});
