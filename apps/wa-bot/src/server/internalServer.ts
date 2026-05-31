/**
 * Internal HTTP server (Hono) for the bot process.
 *
 * Three audiences:
 *   1. Operators: `/health`, `/qr`, `/qr.png` for pairing the WhatsApp
 *      session. The QR page polls every 5 seconds until ready.
 *   2. The Versifine API: `/send`, `/broadcast/*` for pushing budget /
 *      anomaly notifications outbound to a paired user. Auth via
 *      `X-Bot-Secret`.
 *   3. The test harness: `/simulator/message` drives the conversation
 *      engine with no real WhatsApp socket — same auth.
 */
import { existsSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { env } from '../config.ts';
import { dispatchSimulator } from '../openwa/handlers.ts';
import { getQrSnapshot, isClientReady, QR_FILE, unlinkSession } from '../openwa/createClient.ts';
import { getSharedClient } from '../openwa/sharedClient.ts';
import { listSessions } from '../conversations/state.ts';
import {
  addToAllowlist,
  listDynamicAllowlist,
  removeFromAllowlist,
} from '../services/allowlist.ts';
import { log, maskPhone } from '../utils/logger.ts';
import { normalizePhone } from '../utils/phone.ts';

const startedAt = Date.now();

const app = new Hono();

function requireBotSecret(authHeader: string | undefined): boolean {
  return Boolean(authHeader) && authHeader === env.BOT_SECRET;
}

app.get('/health', (c) =>
  c.json({
    ok: true,
    uptimeMs: Date.now() - startedAt,
    ready: isClientReady(),
    name: env.BOT_NAME,
  }),
);

app.get('/qr', (c) => {
  if (isClientReady()) {
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8"><title>${env.BOT_NAME} bot</title>
<style>body{font-family:system-ui;max-width:520px;margin:48px auto;padding:0 16px;color:#0f172a}</style>
</head><body>
<h1>${env.BOT_NAME} bot is paired ✅</h1>
<p>The bot is connected and ready to receive messages from your allowlisted numbers.</p>
<p>Health: <code>GET /health</code></p>
</body></html>`,
      200,
      { 'cache-control': 'no-store' },
    );
  }
  const snap = getQrSnapshot();
  const status = snap ? 'Scan this QR with WhatsApp on your phone.' : 'Waiting for QR…';
  // Inline the QR straight into the HTML as a base64 data URI. This is the
  // key robustness fix: the browser makes NO second request for the image,
  // so there's nothing for nginx to misroute or Cloudflare to cache/404.
  // The whole page is `no-store`, so every 5s refresh pulls a fresh QR.
  const png = snap?.dataUri
    ? `<img src="${snap.dataUri}" alt="WhatsApp pairing QR" width="320" height="320" style="width:320px;height:320px;background:#fff;padding:8px;border:1px solid #e2e8f0;border-radius:12px"/>`
    : '<p>QR not ready yet. Refreshing…</p>';
  // Scannable vector fallback (crisp, correct aspect ratio) for when images
  // are blocked — replaces the old ASCII block, which a phone camera can't
  // read through a <pre> element's line spacing.
  const svgFallback = snap?.svg
    ? `<details><summary>Can't see the image? Tap for a scannable QR</summary>
<div style="width:280px;margin:12px auto;background:#fff;padding:12px;border-radius:12px">${snap.svg}</div></details>`
    : '';
  return c.html(
    `<!doctype html><html><head><meta charset="utf-8"><title>${env.BOT_NAME} bot — pair</title>
<meta http-equiv="refresh" content="5">
<style>
  body{font-family:system-ui;max-width:520px;margin:48px auto;padding:0 16px;color:#0f172a;text-align:center}
  pre{background:#0f172a;color:#e2e8f0;padding:16px;border-radius:12px;text-align:left;overflow:auto}
</style>
</head><body>
<h1>${env.BOT_NAME} bot</h1>
<p>${status}</p>
${png}
<p style="color:#64748b">Open WhatsApp → Settings → Linked Devices → Link a Device.</p>
${svgFallback}
</body></html>`,
    200,
    { 'cache-control': 'no-store' },
  );
});

app.get('/qr.png', (c) => {
  const snap = getQrSnapshot();
  // Prefer the in-memory PNG: it's always complete (never a half-written
  // file) and doesn't depend on the filesystem path being correct.
  if (snap?.png) {
    return new Response(new Uint8Array(snap.png), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'no-store',
      },
    });
  }
  const path = snap?.pngPath ?? QR_FILE;
  if (!existsSync(path)) {
    return c.text('QR not ready', 404, { 'cache-control': 'no-store' });
  }
  const buf = readFileSync(path);
  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'no-store',
    },
  });
});

/**
 * JSON pairing status for the admin panel poller. Returns whether the client
 * is paired/ready and, when not, the current QR as a data URI + SVG so the
 * panel can render it without a second request. Bot-secret gated.
 */
app.get('/qr.json', (c) => {
  if (!requireBotSecret(c.req.header('x-bot-secret'))) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  const ready = isClientReady();
  const snap = getQrSnapshot();
  return c.json(
    {
      ready,
      hasQr: !ready && Boolean(snap),
      dataUri: ready ? null : (snap?.dataUri ?? null),
      svg: ready ? null : (snap?.svg ?? null),
      generatedAt: snap?.generatedAt ?? null,
    },
    200,
    { 'cache-control': 'no-store' },
  );
});

/**
 * Unlink the paired WhatsApp device. Logs out, wipes the session, and the
 * process restarts (systemd) to surface a fresh QR. Bot-secret gated.
 */
app.post('/unlink', async (c) => {
  if (!requireBotSecret(c.req.header('x-bot-secret'))) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  log.info('UNLINK_REQUESTED', {});
  const result = await unlinkSession();
  return c.json({ ok: result.ok, method: result.method });
});

app.get('/sessions', (c) => {
  if (!requireBotSecret(c.req.header('x-bot-secret'))) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  const sessions = listSessions().map((s) => ({
    phone: maskPhone(s.phone),
    language: s.language,
    state: s.state,
    linked: s.linked,
    lastSeenAtIso: new Date(s.lastSeenAt).toISOString(),
  }));
  return c.json({
    sessions,
    demoAllowlist: {
      count: listDynamicAllowlist().length,
      phones: listDynamicAllowlist().map((p) => maskPhone(p)),
    },
  });
});

/* ------------------------------------------------------------------ *
 * Allowlist management (operator). Gated by the bot secret; the web
 * `/api/allowlist` proxy keeps the secret server-side and adds its own
 * admin-token check before forwarding here.
 *
 *   GET    /allowlist            list seed (static) + dynamic numbers
 *   POST   /allowlist {phone}    add a number to the dynamic allowlist
 *   DELETE /allowlist {phone}    remove a number from the dynamic allowlist
 *
 * Numbers are returned UNMASKED here (operator-only surface) so the admin
 * can see and manage exact numbers. Static seed numbers are read-only.
 * ------------------------------------------------------------------ */
app.get('/allowlist', (c) => {
  if (!requireBotSecret(c.req.header('x-bot-secret'))) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  return c.json({
    seed: env.ALLOWED_TEST_NUMBERS,
    dynamic: listDynamicAllowlist(),
    demoMode: env.DEMO_MODE,
  });
});

app.post('/allowlist', async (c) => {
  if (!requireBotSecret(c.req.header('x-bot-secret'))) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  let body: { phone?: string };
  try {
    body = (await c.req.json()) as { phone?: string };
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const phone = normalizePhone(body.phone ?? '');
  if (!phone || phone.length < 10 || phone.length > 15) {
    return c.json({ error: 'invalid_phone' }, 400);
  }
  // Already covered by the static seed → nothing to add, report as present.
  if (env.ALLOWED_TEST_NUMBERS.includes(phone)) {
    return c.json({ added: false, phone, reason: 'seed' });
  }
  const added = addToAllowlist(phone);
  log.info('ALLOWLIST_ADD', { phone: maskPhone(phone), added });
  return c.json({ added, phone });
});

app.delete('/allowlist', async (c) => {
  if (!requireBotSecret(c.req.header('x-bot-secret'))) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  let body: { phone?: string };
  try {
    body = (await c.req.json()) as { phone?: string };
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const phone = normalizePhone(body.phone ?? '');
  if (!phone) {
    return c.json({ error: 'invalid_phone' }, 400);
  }
  if (env.ALLOWED_TEST_NUMBERS.includes(phone)) {
    // Static seed numbers live in the env and can't be removed at runtime.
    return c.json({ removed: false, phone, reason: 'seed_readonly' }, 409);
  }
  const removed = removeFromAllowlist(phone);
  log.info('ALLOWLIST_REMOVE', { phone: maskPhone(phone), removed });
  return c.json({ removed, phone });
});

app.post('/send', async (c) => {
  if (!requireBotSecret(c.req.header('x-bot-secret'))) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  let body: { phone?: string; text?: string };
  try {
    body = (await c.req.json()) as { phone?: string; text?: string };
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!body.phone || !body.text) {
    return c.json({ error: 'missing_fields' }, 400);
  }
  const client = getSharedClient();
  if (!client) return c.json({ error: 'client_not_ready' }, 503);
  const phone = normalizePhone(body.phone);
  try {
    await client.sendMessage(`${phone}@c.us`, body.text);
    return c.json({ sent: true });
  } catch (err) {
    log.warn('SEND_FAIL', {
      phone: maskPhone(phone),
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return c.json({ error: 'send_failed' }, 502);
  }
});

interface BudgetAlertBody {
  phone?: string;
  budgetName?: string;
  category?: string;
  percentage?: number;
  allocated?: number;
  spent?: number;
}

app.post('/broadcast/budget-alert', async (c) => {
  if (!requireBotSecret(c.req.header('x-bot-secret'))) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  const body = (await c.req.json().catch(() => ({}))) as BudgetAlertBody;
  if (!body.phone || !body.category || typeof body.percentage !== 'number') {
    return c.json({ error: 'missing_fields' }, 400);
  }
  const client = getSharedClient();
  if (!client) return c.json({ error: 'client_not_ready' }, 503);
  const phone = normalizePhone(body.phone);
  const text =
    body.percentage >= 100
      ? `🚨 Budget exceeded: ${body.category} (₹${body.spent ?? '—'} of ₹${body.allocated ?? '—'}).`
      : `⚠️ Budget alert: ${body.category} at ${Math.round(body.percentage)}% (₹${body.spent ?? '—'} of ₹${body.allocated ?? '—'}).`;
  try {
    await client.sendMessage(`${phone}@c.us`, text);
    return c.json({ sent: true });
  } catch (err) {
    log.warn('BROADCAST_BUDGET_FAIL', {
      phone: maskPhone(phone),
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return c.json({ error: 'send_failed' }, 502);
  }
});

interface ForecastAnomalyBody {
  phone?: string;
  date?: string;
  amount?: number;
  expected?: number;
}

app.post('/broadcast/forecast-anomaly', async (c) => {
  if (!requireBotSecret(c.req.header('x-bot-secret'))) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  const body = (await c.req.json().catch(() => ({}))) as ForecastAnomalyBody;
  if (!body.phone || !body.date || typeof body.amount !== 'number') {
    return c.json({ error: 'missing_fields' }, 400);
  }
  const client = getSharedClient();
  if (!client) return c.json({ error: 'client_not_ready' }, 503);
  const phone = normalizePhone(body.phone);
  const text = `📈 Spend anomaly on ${body.date}: ₹${body.amount}${
    typeof body.expected === 'number' ? ` (expected ~₹${body.expected})` : ''
  }.`;
  try {
    await client.sendMessage(`${phone}@c.us`, text);
    return c.json({ sent: true });
  } catch (err) {
    log.warn('BROADCAST_ANOMALY_FAIL', {
      phone: maskPhone(phone),
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return c.json({ error: 'send_failed' }, 502);
  }
});

interface SimulatorBody {
  phone?: string;
  body?: string;
  hasAudio?: boolean;
  hasImage?: boolean;
  audioBase64?: string;
  imageBase64?: string;
  audioMimetype?: string;
  imageMimetype?: string;
}

app.post('/simulator/message', async (c) => {
  if (!requireBotSecret(c.req.header('x-bot-secret'))) {
    return c.json({ error: 'unauthorised' }, 401);
  }
  const payload = (await c.req.json().catch(() => ({}))) as SimulatorBody;
  if (!payload.phone || typeof payload.body !== 'string') {
    return c.json({ error: 'missing_fields' }, 400);
  }
  try {
    const result = await dispatchSimulator(
      payload.phone,
      payload.body,
      Boolean(payload.hasAudio),
      Boolean(payload.hasImage),
      payload.audioBase64,
      payload.imageBase64,
      payload.audioMimetype,
      payload.imageMimetype,
    );
    return c.json(result);
  } catch (err) {
    log.warn('SIMULATOR_FAIL', {
      phone: maskPhone(payload.phone),
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return c.json({ error: 'engine_failed' }, 500);
  }
});

export function startInternalServer(): { port: number; stop: () => void } {
  const server = Bun.serve({
    hostname: env.BOT_HOST,
    port: env.BOT_PORT,
    fetch: app.fetch,
  });
  log.info('BOT_HTTP_LISTENING', { host: server.hostname, port: server.port });
  return {
    port: server.port,
    stop: () => server.stop(true),
  };
}

export const botHttpApp = app;
