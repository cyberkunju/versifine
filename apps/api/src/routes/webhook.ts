/**
 * WhatsApp Business Cloud API webhook (Meta Graph).
 *
 *   GET  /webhook/whatsapp   Meta handshake (hub.challenge).
 *   POST /webhook/whatsapp   Inbound events. We verify the HMAC signature,
 *                            dedupe retries, ACK 200 FAST, then process each
 *                            message asynchronously: download any media, mark
 *                            it read, and relay a parsed payload to the bot.
 *
 * Design rules baked in:
 *   - Verify X-Hub-Signature-256 before trusting anything (no spoofed txns).
 *   - Return 200 within milliseconds so Meta never times out and retries
 *     (retries + slow media download = duplicate transactions otherwise).
 *   - Idempotency by message id so an at-least-once redelivery is a no-op.
 *   - The legacy whatsapp-web.js path is untouched; this only runs when Meta
 *     calls the public URL.
 */
import { Hono } from 'hono';
import { env } from '../env.ts';
import { log } from '../utils/logger.ts';
import { downloadMedia, isCloudApiConfigured, markRead } from '../services/whatsapp/graph.ts';
import { seenMessage, verifySignature, hasBeenProcessedDurable, markProcessedDurable } from '../services/whatsapp/security.ts';
import type {
  MetaInboundMessage,
  MetaWebhookEnvelope,
  RelayPayload,
} from '../services/whatsapp/types.ts';

const app = new Hono();

/** Meta verification handshake. */
app.get('/whatsapp', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (!env.WHATSAPP_VERIFY_TOKEN) {
    log.warn('WA_WEBHOOK_VERIFY_NO_TOKEN', {});
    return c.text('Forbidden', 403);
  }
  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    log.info('WA_WEBHOOK_VERIFIED', {});
    return c.text(challenge ?? '', 200);
  }
  log.warn('WA_WEBHOOK_VERIFY_FAILED', { mode });
  return c.text('Forbidden', 403);
});

/** Pull the best text representation out of any inbound message type. */
function extractText(m: MetaInboundMessage): string {
  switch (m.type) {
    case 'text':
      return m.text?.body ?? '';
    case 'interactive':
      // Quick-reply button / list selection. Prefer the title (human text)
      // so the engine's natural-language router handles it like a typed reply.
      return (
        m.interactive?.button_reply?.title ??
        m.interactive?.list_reply?.title ??
        m.interactive?.button_reply?.id ??
        m.interactive?.list_reply?.id ??
        ''
      );
    case 'button':
      return m.button?.text ?? m.button?.payload ?? '';
    case 'image':
      return m.image?.caption ?? '';
    case 'audio':
      return '';
    default:
      return '';
  }
}

/** Build the relay payload, downloading media for audio/image messages. */
async function toRelayPayload(m: MetaInboundMessage): Promise<RelayPayload | null> {
  const phone = m.from;
  if (!phone) return null;

  const payload: RelayPayload = {
    phone,
    body: extractText(m),
    hasAudio: false,
    audioBase64: null,
    audioMimetype: null,
    hasImage: false,
    imageBase64: null,
    imageMimetype: null,
    messageId: m.id,
  };

  if (m.type === 'audio' && m.audio?.id) {
    const media = await downloadMedia(m.audio.id);
    if (!media) return null;
    payload.hasAudio = true;
    payload.audioBase64 = media.buffer.toString('base64');
    payload.audioMimetype = media.mimeType;
  } else if (m.type === 'image' && m.image?.id) {
    const media = await downloadMedia(m.image.id);
    if (!media) return null;
    payload.hasImage = true;
    payload.imageBase64 = media.buffer.toString('base64');
    payload.imageMimetype = media.mimeType;
  } else if (m.type !== 'text' && m.type !== 'interactive' && m.type !== 'button') {
    // document/video/sticker/location/etc. — not supported as capture input.
    // Relay an empty-bodied note so the engine can nudge the user politely.
    payload.body = payload.body || '';
  }

  return payload;
}

/** Relay one parsed message to the bot's internal server. */
async function relayToBot(payload: RelayPayload): Promise<void> {
  const url = `${env.WABOT_INTERNAL_URL.replace(/\/+$/, '')}/webhook/message`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-bot-secret': env.BOT_SECRET, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log.error('WA_RELAY_FAILED', { status: res.status, messageId: payload.messageId });
    }
  } catch (err) {
    log.error('WA_RELAY_NETWORK_ERROR', {
      messageId: payload.messageId,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
}

/** Background processor for one inbound message (runs after the 200 ACK). */
async function processMessage(m: MetaInboundMessage): Promise<void> {
  if (seenMessage(m.id)) {
    log.debug('WA_MESSAGE_DUPLICATE_SKIPPED', { messageId: m.id });
    return;
  }
  // Durable dedup — READ-ONLY check. Survives a restart so a Meta retry after
  // a deploy can't double-process. We mark "done" AFTER the message has been
  // relayed/processed, NOT before — if we crashed mid-flight after marking,
  // Meta's retry would silently drop a never-processed message. Process-then-
  // mark: a mid-flight crash leads to one safe re-processing on retry instead.
  if (await hasBeenProcessedDurable(m.id)) {
    log.debug('WA_MESSAGE_DUPLICATE_SKIPPED_DURABLE', { messageId: m.id });
    return;
  }

  // Welcome event: a brand-new user opened the chat (enable_welcome_message).
  // There's no user text to mark read — relay an empty-body message so the
  // engine's first-contact flow greets them (language menu / onboarding).
  if (m.type === 'request_welcome') {
    log.info('WA_REQUEST_WELCOME', { from: m.from });
    if (m.from) {
      await relayToBot({
        phone: m.from,
        body: '',
        hasAudio: false,
        audioBase64: null,
        audioMimetype: null,
        hasImage: false,
        imageBase64: null,
        imageMimetype: null,
        messageId: m.id,
      });
    }
    await markProcessedDurable(m.id);
    return;
  }

  // Best-effort read receipt (blue ticks) — fire and forget.
  if (m.id) void markRead(m.id);

  const payload = await toRelayPayload(m);
  if (!payload) return;
  await relayToBot(payload);
  // Successfully processed — mark in the durable dedup table so a subsequent
  // Meta retry (potentially after a deploy/restart) is a no-op. Marking AFTER
  // relay means a mid-flight crash leaves the row un-marked → Meta retries →
  // we re-process safely. The destructive ledger ops downstream are
  // idempotent on user intent (correction/delete on the SAME lastTransactionId).
  await markProcessedDurable(m.id);
}

app.post('/whatsapp', async (c) => {
  // Read the RAW body first — required for an exact HMAC match.
  const raw = await c.req.text();
  const signature = c.req.header('x-hub-signature-256');

  // When the Cloud API is configured we process the event. Signature
  // verification is ENFORCED when WHATSAPP_APP_SECRET is set (production hard
  // requirement); if the secret isn't set yet we process but log loudly so the
  // gap is visible — this avoids silently 403-ing a live webhook during rollout.
  if (isCloudApiConfigured()) {
    if (env.WHATSAPP_APP_SECRET) {
      if (!verifySignature(raw, signature)) {
        log.warn('WA_WEBHOOK_BAD_SIGNATURE', {});
        return c.text('Forbidden', 403);
      }
    } else {
      log.warn('WA_WEBHOOK_UNVERIFIED', {
        note: 'set WHATSAPP_APP_SECRET to enable HMAC signature verification',
      });
    }
  } else {
    log.debug('WA_WEBHOOK_IGNORED_UNCONFIGURED', {});
    return c.json({ ok: true });
  }

  let envelope: MetaWebhookEnvelope;
  try {
    envelope = JSON.parse(raw) as MetaWebhookEnvelope;
  } catch {
    return c.json({ ok: true }); // malformed — ACK so Meta doesn't retry
  }

  // Collect inbound messages (ignore status callbacks: sent/delivered/read).
  const messages: MetaInboundMessage[] = [];
  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) messages.push(m);
    }
  }

  // ACK immediately; process in the background so a slow media download can
  // never push us past Meta's webhook timeout (which would trigger retries).
  if (messages.length) {
    void (async () => {
      for (const m of messages) {
        try {
          await processMessage(m);
        } catch (err) {
          log.error('WA_PROCESS_FAIL', {
            messageId: m.id,
            error: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      }
    })();
  }

  return c.json({ ok: true });
});

export const webhookRoutes = app;
