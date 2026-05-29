/**
 * Headless browser probe.
 *
 * Drives Chrome via the DevTools Protocol with no extra dependency. Loads
 * `http://localhost:5173`, waits ~5s for client hydration, then dumps
 * every console message and uncaught exception to stdout. The whole
 * point is to surface browser-side runtime errors that the dev terminal
 * never sees.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findChrome(): string {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('Chrome not found. Set PUPPETEER_EXECUTABLE_PATH.');
}

const TARGET = process.argv[2] ?? 'http://localhost:5173';
const PORT = 9223 + Math.floor(Math.random() * 100);
const profileDir = resolve(tmpdir(), `versifine-probe-${Date.now()}`);

console.log(`probe: ${TARGET} via Chrome on devtools port ${PORT}`);

const chrome = spawn(
  findChrome(),
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'pipe' },
);

await new Promise((r) => setTimeout(r, 1500));

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

async function getTarget(): Promise<CdpTarget> {
  for (let i = 0; i < 20; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = (await res.json()) as CdpTarget[];
      const page = targets.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      // chrome not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('chrome devtools never came up');
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);

const pending = new Map<number, (value: unknown) => void>();
let nextId = 1;

function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

const consoleLines: string[] = [];
const exceptions: string[] = [];

ws.addEventListener('message', (e) => {
  const data = JSON.parse(e.data as string) as {
    id?: number;
    result?: unknown;
    method?: string;
    params?: Record<string, unknown>;
  };
  if (data.id !== undefined && pending.has(data.id)) {
    pending.get(data.id)?.(data.result);
    pending.delete(data.id);
    return;
  }
  if (data.method === 'Runtime.consoleAPICalled' && data.params) {
    const params = data.params as { type: string; args: Array<{ value?: unknown; description?: string }> };
    const text = params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    consoleLines.push(`[${params.type}] ${text}`);
  }
  if (data.method === 'Runtime.exceptionThrown' && data.params) {
    const p = data.params as { exceptionDetails: { text?: string; exception?: { description?: string }; url?: string; lineNumber?: number; columnNumber?: number } };
    const d = p.exceptionDetails;
    exceptions.push(
      `EXCEPTION: ${d.text ?? ''} ${d.exception?.description ?? ''}`.trim() +
        (d.url ? ` @ ${d.url}:${d.lineNumber ?? 0}:${d.columnNumber ?? 0}` : ''),
    );
  }
});

await new Promise<void>((resolve) => ws.addEventListener('open', () => resolve(), { once: true }));

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');

await send('Page.navigate', { url: TARGET });
// Give the app 6 seconds to hydrate.
await new Promise((r) => setTimeout(r, 6000));

const dom = (await send('Runtime.evaluate', {
  expression: 'document.body ? document.body.innerHTML.length : -1',
})) as { result?: { value?: number } };
const innerLen = dom.result?.value ?? -1;

console.log(`probe: body inner HTML length = ${innerLen}`);
if (consoleLines.length > 0) {
  console.log('\n--- console ---');
  for (const line of consoleLines) console.log(line);
}
if (exceptions.length > 0) {
  console.log('\n--- exceptions ---');
  for (const line of exceptions) console.log(line);
}
if (consoleLines.length === 0 && exceptions.length === 0) {
  console.log('(no console output and no exceptions)');
}

ws.close();
chrome.kill();
process.exit(exceptions.length > 0 ? 1 : 0);
