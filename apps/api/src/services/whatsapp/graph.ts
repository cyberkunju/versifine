/**
 * Typed WhatsApp Cloud API (Meta Graph) client used by the API process.
 *
 * Centralises every outbound Graph call so credentials, version, and error
 * handling live in one place (no more hardcoded ids / `as any`).
 *
 * Key Cloud API rule encoded here: free-form messages are only allowed inside
 * the 24-hour customer service window (since the user's last message). Outside
 * it, Meta rejects text with error 131047/131026/470 and you MUST use an
 * approved message template. `sendText` surfaces that error code so callers can
 * fall back to `sendTemplate`.
 */
import { env } from '../../env.ts';
import { log } from '../../utils/logger.ts';
import type { MetaMediaInfo, MetaSendResult } from './types.ts';

function graphBase(): string | null {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return null;
  return `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}`;
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` };
}

/** True when the Cloud API is fully configured (token + phone number id). */
export function isCloudApiConfigured(): boolean {
  return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Download inbound media bytes from Meta (two hops: id → url → bytes). */
export async function downloadMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const base = graphBase();
  if (!base) {
    log.error('WA_MEDIA_DOWNLOAD_UNCONFIGURED', {});
    return null;
  }
  try {
    const infoRes = await fetch(`${base}/${mediaId}`, { headers: authHeader() });
    if (!infoRes.ok) {
      log.error('WA_MEDIA_INFO_FAILED', { status: infoRes.status });
      return null;
    }
    const info = (await infoRes.json()) as MetaMediaInfo;
    if (!info.url) {
      log.error('WA_MEDIA_URL_MISSING', {});
      return null;
    }
    const mediaRes = await fetch(info.url, { headers: authHeader() });
    if (!mediaRes.ok) {
      log.error('WA_MEDIA_BINARY_FAILED', { status: mediaRes.status });
      return null;
    }
    const buffer = Buffer.from(await mediaRes.arrayBuffer());
    return { buffer, mimeType: info.mime_type || 'application/octet-stream' };
  } catch (err) {
    log.error('WA_MEDIA_DOWNLOAD_EXCEPTION', {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}

async function postMessage(body: Record<string, unknown>): Promise<MetaSendResult> {
  const base = graphBase();
  if (!base) return { ok: false, status: 0, errorMessage: 'cloud api not configured' };
  try {
    const r = await fetch(`${base}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
    const data = (await r.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { code?: number; message?: string };
    };
    if (r.ok) return { ok: true, status: r.status, messageId: data.messages?.[0]?.id };
    return {
      ok: false,
      status: r.status,
      errorCode: data.error?.code,
      errorMessage: data.error?.message,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorMessage: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

/** Send a free-form text message (only valid inside the 24h window). */
export async function sendText(to: string, text: string): Promise<MetaSendResult> {
  return postMessage({ to, type: 'text', text: { body: text, preview_url: false } });
}

/**
 * Send an approved template message — the only way to (re)open a conversation
 * outside the 24h window (e.g. a proactive budget alert). `components` lets you
 * fill body variables; pass [] for a no-variable template.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  components: unknown[] = [],
): Promise<MetaSendResult> {
  return postMessage({
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length ? { components } : {}),
    },
  });
}

/** Upload audio bytes → media id (for sending voice notes back). */
export async function uploadAudio(buffer: Buffer, mimetype: string): Promise<string | null> {
  const base = graphBase();
  if (!base) return null;
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimetype }), 'voice.ogg');
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'audio');
    const r = await fetch(`${base}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
      method: 'POST',
      headers: authHeader(),
      body: form,
    });
    const data = (await r.json().catch(() => ({}))) as { id?: string };
    return r.ok && data.id ? data.id : null;
  } catch {
    return null;
  }
}

/** Send a voice note by media id. */
export async function sendAudio(to: string, mediaId: string): Promise<MetaSendResult> {
  return postMessage({ to, type: 'audio', audio: { id: mediaId } });
}

/** Mark an inbound message as read (blue ticks) — pure UX polish, best-effort. */
export async function markRead(messageId: string): Promise<void> {
  const base = graphBase();
  if (!base) return;
  try {
    await fetch(`${base}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    });
  } catch {
    /* best-effort */
  }
}
