/**
 * client.ts — WhatsApp Business Cloud API client.
 *
 * Implements sending text messages, uploading binary voice media, and delivering
 * voice notes via the Meta Graph API.
 */
import { log } from '../utils/logger.ts';
import type { MetaSendResponse, MetaUploadMediaResponse } from './types.ts';

/**
 * Send a text message to a user.
 */
export async function sendTextMessage(to: string, text: string): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1079257601947704';

  if (!token) {
    log.error('WHATSAPP_SEND_FAILED', { error: 'WHATSAPP_TOKEN not configured in environment' });
    return false;
  }

  const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    const data = await response.json() as MetaSendResponse;
    if (response.ok) {
      log.info('WHATSAPP_SEND_SUCCESS', { to, messageId: data.messages?.[0]?.id });
      return true;
    } else {
      log.error('WHATSAPP_SEND_API_ERROR', { error: data });
      return false;
    }
  } catch (error) {
    log.error('WHATSAPP_SEND_NETWORK_ERROR', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Upload audio file (e.g. voice note) to Meta's servers to get a media_id.
 */
export async function uploadAudio(audioBuffer: Buffer, mimetype: string): Promise<string | null> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1079257601947704';

  if (!token) {
    log.error('WHATSAPP_UPLOAD_FAILED', { error: 'WHATSAPP_TOKEN not configured in environment' });
    return null;
  }

  const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/media`;
  try {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimetype });
    formData.append('file', blob, 'voice.ogg');
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', 'audio');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    const data = await response.json() as MetaUploadMediaResponse;
    if (response.ok && data.id) {
      log.info('WHATSAPP_UPLOAD_SUCCESS', { mediaId: data.id });
      return data.id;
    } else {
      log.error('WHATSAPP_UPLOAD_API_ERROR', { error: data });
      return null;
    }
  } catch (error) {
    log.error('WHATSAPP_UPLOAD_NETWORK_ERROR', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Send an audio message (voice note) to a user using its media_id.
 */
export async function sendVoiceMessage(to: string, mediaId: string): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1079257601947704';

  if (!token) {
    log.error('WHATSAPP_SEND_VOICE_FAILED', { error: 'WHATSAPP_TOKEN not configured' });
    return false;
  }

  const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'audio',
        audio: { id: mediaId },
      }),
    });

    const data = await response.json() as MetaSendResponse;
    if (response.ok) {
      log.info('WHATSAPP_SEND_VOICE_SUCCESS', { to, messageId: data.messages?.[0]?.id });
      return true;
    } else {
      log.error('WHATSAPP_SEND_VOICE_API_ERROR', { error: data });
      return false;
    }
  } catch (error) {
    log.error('WHATSAPP_SEND_VOICE_NETWORK_ERROR', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
