/**
 * handlers.ts — WhatsApp Business Cloud API message processor.
 *
 * Bridges relayed messages from the API webhook proxy to the conversation engine,
 * checks allowlist/demo access, and delivers replies using the Graph API.
 */
import type { ConversationState, IncomingMessage } from '../types.ts';
import { runEngine } from '../conversations/engine.ts';
import { log, maskPhone } from '../utils/logger.ts';
import { normalizePhone } from '../utils/phone.ts';
import { chunkText } from '../utils/text.ts';
import { sendTextMessage, sendInteractiveList, uploadAudio, sendVoiceMessage } from './client.ts';
import type { RelayedWebhookPayload } from './types.ts';

export async function dispatchToEngine(message: IncomingMessage): Promise<void> {
  const reply = await runEngine(message);
  if (reply.interactive) {
    // Tappable menu (e.g. the language picker). Render the list; the body text
    // lives inside the list, so we don't also send the plain-text bubble.
    try {
      await sendInteractiveList(message.phone, reply.interactive);
      return;
    } catch (err) {
      log.warn('DELIVER_LIST_FAIL', {
        phone: maskPhone(message.phone),
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      // Fall through to the plain-text fallback below.
    }
  }
  if (!reply.text) return; // STOP state — silent.
  await deliver(message.phone, reply.text, reply.voicePromise, reply.state);
}

async function deliver(
  phone: string,
  text: string,
  voicePromise:
    | Promise<{ buffer: Buffer; mimetype: string; spokenText?: string } | null>
    | undefined,
  state: ConversationState,
): Promise<void> {
  // Pass 1 — text bubble(s). Chunk long replies.
  for (const chunk of chunkText(text, 1500)) {
    if (!chunk.trim()) continue;
    try {
      await sendTextMessage(phone, chunk);
    } catch (err) {
      log.warn('DELIVER_TEXT_FAIL', {
        phone: maskPhone(phone),
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      return;
    }
  }

  // Pass 2 — voice note when synthesised.
  if (!voicePromise) return;
  let voice: { buffer: Buffer; mimetype: string } | null;
  try {
    voice = await voicePromise;
  } catch {
    voice = null;
  }
  if (!voice) return;

  try {
    const mediaId = await uploadAudio(voice.buffer, voice.mimetype);
    if (mediaId) {
      await sendVoiceMessage(phone, mediaId);
    } else {
      log.warn('DELIVER_VOICE_UPLOAD_FAILED', { phone: maskPhone(phone) });
    }
  } catch (err) {
    log.warn('DELIVER_VOICE_FAIL', {
      phone: maskPhone(phone),
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
}

export async function onRelayedMessage(payload: RelayedWebhookPayload): Promise<void> {
  const phone = normalizePhone(payload.phone);
  if (!phone) return;

  // No allowlist gate on the official WhatsApp Cloud API path: this is the
  // public production surface, so anyone who messages the business number is
  // served. (The whatsapp-web.js / open-wa path keeps its DEMO_MODE allowlist
  // gate — see openwa/handlers.ts — for controlled testing.)
  const rawBody = payload.body ?? '';

  const incoming: IncomingMessage = {
    phone,
    body: rawBody,
    hasAudio: payload.hasAudio,
    audioBuffer: payload.audioBase64 ? Buffer.from(payload.audioBase64, 'base64') : null,
    audioMimetype: payload.audioMimetype,
    hasImage: payload.hasImage,
    imageBuffer: payload.imageBase64 ? Buffer.from(payload.imageBase64, 'base64') : null,
    imageMimetype: payload.imageMimetype,
    source: 'whatsapp',
  };

  log.info('MESSAGE_INBOUND_CLOUD', {
    phone: maskPhone(phone),
    hasAudio: incoming.hasAudio,
    hasImage: incoming.hasImage,
    bodyChars: incoming.body.length,
  });

  try {
    await dispatchToEngine(incoming);
  } catch (err) {
    log.error('ENGINE_DISPATCH_FAIL', {
      phone: maskPhone(phone),
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
  }
}
