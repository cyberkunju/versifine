/**
 * Dynamic demo allowlist.
 *
 * The static `ALLOWED_TEST_NUMBERS` env is the SEED list. On top of it we keep
 * a small, persistent set of numbers that earned access at runtime by sending
 * the exact "request a demo" phrase from the landing page's WhatsApp button
 * (see `isDemoRequest`). Once a number is added it can chat with the bot like
 * any allowlisted number — and it stays added across restarts and deploys.
 *
 * Persistence: a JSON file inside the WhatsApp auth dir. That directory is the
 * one piece of bot state the deploy treats as durable — it's symlinked to
 * `/opt/versifine/wabot-state/.wwebjs_auth` and excluded from the deploy's
 * `rsync --delete`, so anything we drop there survives a release. In dev it's
 * a plain folder under the package root. Either way the file is gitignored
 * (the whole `.wwebjs_auth/` tree is).
 *
 * The in-memory Set is the source of truth during a run; every mutation is
 * flushed to disk atomically (temp file + rename) so a crash mid-write can't
 * corrupt the list.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../config.ts';
import { log } from '../utils/logger.ts';
import { normalizePhone } from '../utils/phone.ts';

/**
 * Resolve the package root the same way `openwa/createClient.ts` does, so the
 * allowlist file lands next to the persistent session dir without importing
 * (and cycling through) the client module.
 */
function resolveBotRoot(): string {
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, 'package.json')) && existsSync(resolve(cwd, 'src'))) {
    return cwd;
  }
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i += 1) {
    const base = dir.split(/[\\/]/).pop();
    if (base !== 'src' && base !== 'dist' && existsSync(resolve(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

/** Where the dynamic allowlist is stored. Env override wins (handy for tests). */
function resolveStoreFile(): string {
  if (env.DEMO_ALLOWLIST_FILE && env.DEMO_ALLOWLIST_FILE.trim()) {
    return resolve(env.DEMO_ALLOWLIST_FILE.trim());
  }
  // Inside the persistent, gitignored WhatsApp auth dir.
  return resolve(resolveBotRoot(), '.wwebjs_auth', 'versifine-demo-allowlist.json');
}

const STORE_FILE = resolveStoreFile();

let loaded = false;
const dynamicNumbers = new Set<string>();

interface StoreShape {
  version: 1;
  numbers: string[];
  updatedAt: string;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!existsSync(STORE_FILE)) return;
    const raw = readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    if (parsed && Array.isArray(parsed.numbers)) {
      for (const n of parsed.numbers) {
        const norm = normalizePhone(String(n));
        if (norm) dynamicNumbers.add(norm);
      }
      log.info('DEMO_ALLOWLIST_LOADED', { count: dynamicNumbers.size, file: STORE_FILE });
    }
  } catch (err) {
    // A corrupt file should never brick the bot — start empty and overwrite
    // on the next successful add.
    log.warn('DEMO_ALLOWLIST_LOAD_FAIL', {
      file: STORE_FILE,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
  }
}

function persist(): void {
  const payload: StoreShape = {
    version: 1,
    numbers: Array.from(dynamicNumbers),
    updatedAt: new Date().toISOString(),
  };
  try {
    mkdirSync(dirname(STORE_FILE), { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(tmp, STORE_FILE);
  } catch (err) {
    // Persistence failure is non-fatal: the number stays allowed for THIS run
    // (it's in the in-memory Set). It just won't survive a restart.
    log.warn('DEMO_ALLOWLIST_PERSIST_FAIL', {
      file: STORE_FILE,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
  }
}

/** True when this phone earned demo access at runtime. */
export function isDynamicallyAllowed(phoneRaw: string): boolean {
  load();
  const phone = normalizePhone(phoneRaw);
  return phone ? dynamicNumbers.has(phone) : false;
}

/**
 * Add a phone to the dynamic allowlist and flush to disk. Returns true when
 * the number was newly added (false when it was already present).
 */
export function addToAllowlist(phoneRaw: string): boolean {
  load();
  const phone = normalizePhone(phoneRaw);
  if (!phone) return false;
  if (dynamicNumbers.has(phone)) return false;
  dynamicNumbers.add(phone);
  persist();
  return true;
}

/**
 * Remove a phone from the dynamic allowlist and flush to disk. Returns true
 * when the number was present (and removed), false when it wasn't there.
 * Note: numbers seeded via the static ALLOWED_TEST_NUMBERS env cannot be
 * removed here — they live in config and would require an env change.
 */
export function removeFromAllowlist(phoneRaw: string): boolean {
  load();
  const phone = normalizePhone(phoneRaw);
  if (!phone) return false;
  if (!dynamicNumbers.has(phone)) return false;
  dynamicNumbers.delete(phone);
  persist();
  return true;
}

/** Snapshot of the dynamic numbers (for the /sessions admin view). */
export function listDynamicAllowlist(): string[] {
  load();
  return Array.from(dynamicNumbers);
}

/* ------------------------------------------------------------------ *
 * Demo-request phrase detection.
 * ------------------------------------------------------------------ */

/**
 * The exact text the landing page's WhatsApp button pre-fills. Any number
 * that sends this — allowlisted or not — is granted demo access on the spot.
 * MUST stay byte-identical to `WA_DEMO_TEXT` in apps/web/src/lib/whatsapp.ts.
 */
export const DEMO_REQUEST_PHRASE = 'Hi, Requesting whatsapp demo for versifine.';

/**
 * Normalise free text for a tolerant-but-specific phrase match: strip
 * invisible/zero-width characters, lowercase, reduce every run of
 * non-alphanumeric characters to a single space, and trim. This absorbs
 * casing, punctuation (the trailing period), smart quotes, and stray
 * whitespace WhatsApp or the user's keyboard might introduce — while staying
 * specific enough that an ordinary "hi" never matches.
 */
function normalizePhrase(text: string): string {
  return String(text ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const DEMO_REQUEST_NORMALIZED = normalizePhrase(DEMO_REQUEST_PHRASE);

/** True when `body` is the demo-request phrase (case/punctuation tolerant). */
export function isDemoRequest(body: string | null | undefined): boolean {
  if (!body) return false;
  return normalizePhrase(body) === DEMO_REQUEST_NORMALIZED;
}

/** Test-only: reset in-memory state so a temp store file can be exercised. */
export function _resetAllowlistForTests(): void {
  loaded = false;
  dynamicNumbers.clear();
}

export const DEMO_ALLOWLIST_FILE_PATH = STORE_FILE;
