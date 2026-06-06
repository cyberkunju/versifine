/**
 * client.ts — WhatsApp Business Cloud API client (bot side).
 *
 * Sends text, uploads audio, and delivers voice notes via the Meta Graph API.
 * All credentials come from the validated `env` (config.ts) — no hardcoded ids.
 *
 * Note on the 24-hour window: free-form sends only succeed within 24h of the
 * user's last inbound message. `sendTextMessage` returns the Meta error code so
 * proactive callers (budget alerts) can detect the window-closed case
 * (131047 / 131026 / 470) and switch to an approved template.
 */
import { env } from '../config.ts';
import { log } from '../utils/logger.ts';
import type { MetaSendResponse, MetaUploadMediaResponse } from './types.ts';

export interface CloudSendResult {
  ok: boolean;
  messageId?: string;
  errorCode?: number;
  errorMessage?: string;
}

function graphMessagesUrl(): string | null {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return null;
  return `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

async function postMessage(body: Record<string, unknown>): Promise<CloudSendResult> {
  const url = graphMessagesUrl();
  if (!url) {
    log.error('WHATSAPP_SEND_UNCONFIGURED', { reason: 'token or phone_number_id missing' });
    return { ok: false, errorMessage: 'cloud api not configured' };
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
    const data = (await response.json().catch(() => ({}))) as MetaSendResponse & {
      error?: { code?: number; message?: string };
    };
    if (response.ok) {
      return { ok: true, messageId: data.messages?.[0]?.id };
    }
    log.error('WHATSAPP_SEND_API_ERROR', { code: data.error?.code, message: data.error?.message });
    return { ok: false, errorCode: data.error?.code, errorMessage: data.error?.message };
  } catch (error) {
    log.error('WHATSAPP_SEND_NETWORK_ERROR', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) };
  }
}

/** Meta error codes meaning "outside the 24-hour customer-service window". */
export function isWindowClosed(code: number | undefined): boolean {
  return code === 131047 || code === 131026 || code === 470;
}

/** Send a free-form text message. Returns the detailed result. */
export async function sendText(to: string, text: string): Promise<CloudSendResult> {
  const result = await postMessage({ to, type: 'text', text: { body: text, preview_url: false } });
  if (result.ok) log.info('WHATSAPP_SEND_SUCCESS', { to, messageId: result.messageId });
  return result;
}

/** Boolean-returning wrapper kept for existing callers. */
export async function sendTextMessage(to: string, text: string): Promise<boolean> {
  return (await sendText(to, text)).ok;
}

/**
 * Send an approved template (the only way to message outside the 24h window).
 * Requires the template to be approved in the Meta dashboard.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  components: unknown[] = [],
): Promise<CloudSendResult> {
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

/** Upload audio (voice note) to Meta → media_id. */
export async function uploadAudio(audioBuffer: Buffer, mimetype: string): Promise<string | null> {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    log.error('WHATSAPP_UPLOAD_UNCONFIGURED', {});
    return null;
  }
  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`;
  try {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimetype });
    formData.append('file', blob, 'voice.ogg');
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', 'audio');

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
      body: formData,
    });
    const data = (await response.json().catch(() => ({}))) as MetaUploadMediaResponse;
    if (response.ok && data.id) {
      log.info('WHATSAPP_UPLOAD_SUCCESS', { mediaId: data.id });
      return data.id;
    }
    log.error('WHATSAPP_UPLOAD_API_ERROR', { status: response.status });
    return null;
  } catch (error) {
    log.error('WHATSAPP_UPLOAD_NETWORK_ERROR', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Send a voice note by its media_id. */
export async function sendVoiceMessage(to: string, mediaId: string): Promise<boolean> {
  const result = await postMessage({ to, type: 'audio', audio: { id: mediaId } });
  if (result.ok) log.info('WHATSAPP_SEND_VOICE_SUCCESS', { to, messageId: result.messageId });
  return result.ok;
}
