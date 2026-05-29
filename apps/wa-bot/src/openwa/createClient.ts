/**
 * whatsapp-web.js client factory.
 *
 * Builds the LocalAuth-backed Client, wires QR/ready/disconnected events,
 * detects a Chrome executable when puppeteer's bundled Chromium isn't
 * available (Bun on Windows often skips the postinstall download), and
 * registers our `onMessage` handler.
 *
 * The library is CommonJS. We `import waPkg from 'whatsapp-web.js'`
 * and destructure to keep TS happy across the verbatimModuleSyntax flag.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import qrcodeTerminal from 'qrcode-terminal';
import qrcodeImage from 'qrcode';
import waPkg from 'whatsapp-web.js';
import { env } from '../config.ts';
import { log, maskPhone } from '../utils/logger.ts';
import { bindClient, onMessage } from './handlers.ts';
import { setSharedClient } from './sharedClient.ts';
import type { QrSnapshot, WhatsAppLikeClient } from './types.ts';

const { Client, LocalAuth, MessageMedia } = waPkg as unknown as {
  Client: new (options: Record<string, unknown>) => WhatsAppLikeClient;
  LocalAuth: new (options: Record<string, unknown>) => unknown;
  MessageMedia: new (mimetype: string, data: string) => unknown;
};

/**
 * Resolve the wa-bot package root robustly.
 *
 * Why not `resolve(import.meta.dirname, '..', '..')`? That breaks once the
 * deploy bundles `src/index.ts` → `dist/index.js`: the bundled file sits at
 * `apps/wa-bot/dist`, only ONE level deep, so the two-up math lands on
 * `apps/` instead of `apps/wa-bot/`. The session would then be written
 * outside the persistent `.wwebjs_auth` symlink and wiped by the deploy's
 * `rsync --delete`, forcing a re-pair on every release.
 *
 * The bot is always launched with cwd = the package root (dev runs
 * `--cwd apps/wa-bot`; the `--env-file=../../.env` flag and the systemd
 * unit's `WorkingDirectory=/opt/versifine/repo/apps/wa-bot` both confirm
 * it). So we anchor on cwd when it looks like the package root, and
 * otherwise walk up from this module's dir to find the package.json.
 */
function resolveBotRoot(): string {
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, 'package.json')) && existsSync(resolve(cwd, 'src'))) {
    return cwd;
  }
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i += 1) {
    // The package root is the first ancestor that has a package.json but is
    // not the `src` or `dist` build dir.
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

const BOT_ROOT = resolveBotRoot();

const QR_PNG_PATH = resolve(BOT_ROOT, '.qr.png');
const SESSION_DIR = resolve(BOT_ROOT, '.wwebjs_auth');

let qrSnapshot: QrSnapshot | null = null;
let isReady = false;
let watchdogFails = 0;

const BROWSER_CANDIDATES_WIN = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Users\\Public\\Microsoft\\Edge\\Application\\msedge.exe',
];

function detectBrowser(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === 'win32') {
    for (const candidate of BROWSER_CANDIDATES_WIN) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export async function createClient(): Promise<WhatsAppLikeClient> {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });

  const executablePath = detectBrowser();
  if (executablePath) {
    log.info('BROWSER_DETECTED', { path: executablePath });
  } else {
    log.warn('BROWSER_NOT_DETECTED', {
      hint: 'Set PUPPETEER_EXECUTABLE_PATH or install Chrome to pair WhatsApp Web.',
    });
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: env.SESSION_ID, dataPath: SESSION_DIR }),
    puppeteer: {
      headless: env.HEADLESS,
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
      ],
    },
  });

  setSharedClient(client);
  bindClient(client, MessageMedia);

  client.on('qr', async (qrRaw) => {
    const qr = String(qrRaw ?? '');
    if (!qr) return;
    let asciiPreview = '';
    qrcodeTerminal.generate(qr, { small: true }, (rendered) => {
      asciiPreview = rendered;
      process.stdout.write(`\n${rendered}\n`);
    });
    let pngPath: string | null = null;
    let pngBuffer: Buffer | null = null;
    let dataUri: string | null = null;
    let svg: string | null = null;
    try {
      const buffer = await qrcodeImage.toBuffer(qr, { type: 'png', width: 360, margin: 2 });
      pngBuffer = buffer;
      dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
      // node:fs/promises writeFile expects a Uint8Array; Buffer is a
      // subclass but TS lib mismatches between bun and @types/node trip
      // the structural check on Windows. Cast through a Uint8Array view.
      // Write to a temp file and rename so /qr.png never serves a
      // half-written PNG (the QR rotates every ~20s).
      const tmp = `${QR_PNG_PATH}.tmp`;
      await writeFile(tmp, new Uint8Array(buffer));
      await rename(tmp, QR_PNG_PATH);
      pngPath = QR_PNG_PATH;
    } catch (err) {
      log.warn('QR_PNG_FAIL', {
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
    try {
      // A crisp, scannable vector fallback that renders correctly in a
      // browser (unlike the qrcode-terminal half-block ASCII, which a
      // phone camera can't lock onto through a <pre> block).
      svg = await qrcodeImage.toString(qr, { type: 'svg', margin: 2 });
    } catch {
      svg = null;
    }
    qrSnapshot = {
      raw: qr,
      png: pngBuffer,
      dataUri,
      svg,
      pngPath,
      asciiPreview,
      generatedAt: Date.now(),
    };
    log.info('QR_REFRESHED', { hasPng: pngBuffer !== null });
  });

  client.on('ready', () => {
    isReady = true;
    qrSnapshot = null;
    log.info('CLIENT_READY', {});
  });

  client.on('authenticated', () => {
    log.info('CLIENT_AUTH_OK', {});
  });

  client.on('auth_failure', (msg) => {
    log.error('CLIENT_AUTH_FAIL', { msg: String(msg).slice(0, 200) });
  });

  client.on('disconnected', (reason) => {
    log.warn('CLIENT_DISCONNECTED', { reason: String(reason).slice(0, 200) });
    if (!isReady) {
      // We never finished pairing — stay alive so the user can keep
      // scanning. Pre-pair "disconnects" are normal (e.g. QR refresh
      // cycle on Windows + Bun).
      return;
    }
    isReady = false;
    process.exit(2);
  });

  // Inbound message handling.
  //
  // We listen on BOTH `message` and `message_create`. On modern (LID-era)
  // WhatsApp accounts the `message` event frequently stops firing for
  // inbound messages while `message_create` keeps firing for every message
  // in both directions. Relying on `message` alone makes the bot look dead.
  // We dedupe by message id so a message that triggers both events is only
  // processed once.
  const processedIds = new Set<string>();
  const markProcessed = (id: string): boolean => {
    if (!id) return true; // no id → can't dedupe, allow once
    if (processedIds.has(id)) return false;
    processedIds.add(id);
    // Cap memory: keep the set bounded on a long-running process.
    if (processedIds.size > 500) {
      const first = processedIds.values().next().value;
      if (first !== undefined) processedIds.delete(first);
    }
    return true;
  };

  const handleInbound = (msg: unknown, via: string) => {
    const cast = msg as { id?: { _serialized?: string }; fromMe?: boolean };
    if (cast.fromMe) return;
    const id = cast.id?._serialized ?? '';
    if (!markProcessed(id)) return;
    log.debug('MESSAGE_EVENT', { via });
    void onMessage(msg as Parameters<typeof onMessage>[0]).catch((err) => {
      log.error('ON_MESSAGE_FAIL', {
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    });
  };

  client.on('message', (msg: unknown) => handleInbound(msg, 'message'));

  client.on('message_create', (msg: unknown) => {
    const cast = msg as { fromMe?: boolean; to?: string };
    if (cast.fromMe) {
      if (cast.to) log.debug('MESSAGE_OUTBOUND', { to: maskPhone(cast.to.split('@')[0] ?? '') });
      return;
    }
    handleInbound(msg, 'message_create');
  });

  return client;
}

export function getQrSnapshot(): QrSnapshot | null {
  return qrSnapshot;
}

export function isClientReady(): boolean {
  return isReady;
}

export async function startWatchdog(client: WhatsAppLikeClient): Promise<ReturnType<typeof setInterval>> {
  const probe = async () => {
    // Don't run health probes until pairing has completed at least once.
    // The pre-pair states (UNPAIRED, OPENING, PAIRING, ...) are normal
    // and shouldn't be treated as degraded — the user might still be
    // scanning the QR code.
    if (!isReady) {
      watchdogFails = 0;
      return;
    }
    try {
      const state = await client.getState();
      if (state && state !== 'CONNECTED') {
        watchdogFails += 1;
        log.warn('WATCHDOG_DEGRADED', { state, fails: watchdogFails });
        if (watchdogFails >= 3) {
          log.error('WATCHDOG_EXIT', { state });
          process.exit(2);
        }
      } else {
        watchdogFails = 0;
      }
    } catch (err) {
      watchdogFails += 1;
      log.warn('WATCHDOG_PROBE_FAIL', {
        fails: watchdogFails,
        error: err instanceof Error ? err.message.slice(0, 160) : String(err),
      });
      if (watchdogFails >= 3) {
        log.error('WATCHDOG_EXIT', {});
        process.exit(2);
      }
    }
  };
  return setInterval(() => {
    void probe();
  }, 30_000);
}

export const QR_FILE = QR_PNG_PATH;
