/**
 * Headless screenshot probe — adds Page.captureScreenshot to probe-web.
 * Saves to ./_probe/<ts>.png and dumps body text excerpt.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
function findChrome(): string {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('Chrome not found.');
}

const TARGET = process.argv[2] ?? 'http://localhost:5173';
const PORT = 9300 + Math.floor(Math.random() * 100);
const profileDir = resolve(tmpdir(), `versifine-probe-${Date.now()}`);
const outDir = resolve(import.meta.dir, '..', '_probe');
mkdirSync(outDir, { recursive: true });

console.log(`probe: ${TARGET}`);

const chrome = spawn(findChrome(), [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  '--headless=new',
  '--disable-gpu',
  '--window-size=1280,900',
  '--no-first-run',
  '--no-default-browser-check',
  '--ignore-certificate-errors',
  // Override DNS so Chrome sends versifine.com straight to the origin IP.
  // We also point any *.versifine.com requests at the same target.
  // Format docs: https://www.chromium.org/developers/design-documents/network-stack/socks-proxy
  '--host-resolver-rules=MAP versifine.com 40.192.113.52, MAP www.versifine.com 40.192.113.52',
  'about:blank',
], { stdio: 'pipe' });

await new Promise((r) => setTimeout(r, 1500));

interface CdpTarget { id: string; type: string; url: string; webSocketDebuggerUrl: string; }

async function getTarget(): Promise<CdpTarget> {
  for (let i = 0; i < 20; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = (await res.json()) as CdpTarget[];
      const page = targets.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
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
const failed: string[] = [];
const requestUrls = new Map<string, string>();

ws.addEventListener('message', (e) => {
  const data = JSON.parse(e.data as string) as { id?: number; result?: unknown; method?: string; params?: Record<string, unknown> };
  if (data.id !== undefined && pending.has(data.id)) {
    pending.get(data.id)?.(data.result);
    pending.delete(data.id);
    return;
  }
  if (data.method === 'Runtime.consoleAPICalled' && data.params) {
    const params = data.params as { type: string; args: Array<{ value?: unknown; description?: string }> };
    consoleLines.push(`[${params.type}] ${params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (data.method === 'Runtime.exceptionThrown' && data.params) {
    const p = data.params as { exceptionDetails: { text?: string; exception?: { description?: string }; url?: string; lineNumber?: number } };
    const d = p.exceptionDetails;
    exceptions.push(`${d.text ?? ''} ${d.exception?.description ?? ''}`.trim() + (d.url ? ` @ ${d.url}:${d.lineNumber}` : ''));
  }
  if (data.method === 'Network.loadingFailed' && data.params) {
    const p = data.params as { errorText?: string; requestId?: string; type?: string };
    failed.push(`${p.errorText ?? ''} (${p.type ?? '?'}) reqId=${p.requestId ?? '?'}`);
  }
  if (data.method === 'Network.requestWillBeSent' && data.params) {
    const p = data.params as { requestId?: string; request?: { url?: string; method?: string } };
    if (p.request?.url) {
      requestUrls.set(p.requestId ?? '', `${p.request.method ?? 'GET'} ${p.request.url}`);
    }
  }
});

await new Promise<void>((resolve) => ws.addEventListener('open', () => resolve(), { once: true }));
await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');

await send('Page.navigate', { url: TARGET });
await new Promise((r) => setTimeout(r, 7000));

const dom = (await send('Runtime.evaluate', { expression: 'JSON.stringify({title: document.title, bodyChars: document.body?.innerText?.length || 0, bodyText: (document.body?.innerText || "").slice(0, 500), bodyHTML: (document.body?.innerHTML || "").slice(0, 1500)})' })) as { result?: { value?: string } };
console.log(`probe: dom snapshot = ${dom.result?.value}`);

const shot = (await send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
if (shot.data) {
  const out = resolve(outDir, `shot-${Date.now()}.png`);
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`probe: screenshot saved -> ${out}`);
}

if (consoleLines.length) {
  console.log('--- console ---');
  for (const l of consoleLines) console.log(l);
}
if (exceptions.length) {
  console.log('--- exceptions ---');
  for (const l of exceptions) console.log(l);
}
if (failed.length) {
  console.log('--- network failures ---');
  for (const l of failed.slice(0, 15)) {
    // Extract requestId from the failure line and resolve to the original URL.
    const m = l.match(/reqId=([^\s]+)/);
    const url = m ? requestUrls.get(m[1]!) : undefined;
    console.log(`${l}${url ? `  ::  ${url}` : ''}`);
  }
}

ws.close();
chrome.kill();
process.exit(0);
