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
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

const QR_PNG_PATH = resolve(import.meta.dirname, '..', '..', '.qr.png');
const SESSION_DIR = resolve(import.meta.dirname, '..', '..', '.wwebjs_auth');

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
    try {
      const buffer = await qrcodeImage.toBuffer(qr, { type: 'png', width: 360 });
      // node:fs/promises writeFile expects a Uint8Array; Buffer is a
      // subclass but TS lib mismatches between bun and @types/node trip
      // the structural check on Windows. Cast through a Uint8Array view.
      await writeFile(QR_PNG_PATH, new Uint8Array(buffer));
      pngPath = QR_PNG_PATH;
    } catch (err) {
      log.warn('QR_PNG_FAIL', {
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
    qrSnapshot = { raw: qr, pngPath, asciiPreview, generatedAt: Date.now() };
    log.info('QR_REFRESHED', { hasPng: pngPath !== null });
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
    isReady = false;
    log.warn('CLIENT_DISCONNECTED', { reason: String(reason).slice(0, 200) });
    process.exit(2);
  });

  client.on('message', (msg: unknown) => {
    void onMessage(msg as Parameters<typeof onMessage>[0]).catch((err) => {
      log.error('ON_MESSAGE_FAIL', {
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    });
  });

  // Optional debug observation of message_create for outbound logging.
  client.on('message_create', (msg: unknown) => {
    const cast = msg as { fromMe?: boolean; to?: string };
    if (!cast.fromMe || !cast.to) return;
    log.debug('MESSAGE_OUTBOUND', { to: maskPhone(cast.to.split('@')[0] ?? '') });
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
