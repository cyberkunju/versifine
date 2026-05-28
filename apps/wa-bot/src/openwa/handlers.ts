/**
 * Bot message handler.
 *
 * Bridges whatsapp-web.js's `message` event to the conversation engine
 * and back: extract phone + media, allowlist gate, dispatch the engine,
 * two-pass send (text bubble first, voice second).
 */
import type { ConversationState, IncomingMessage } from '../types.ts';
import { env } from '../config.ts';
import { runEngine } from '../conversations/engine.ts';
import { log, maskPhone } from '../utils/logger.ts';
import { isAllowed, normalizePhone } from '../utils/phone.ts';
import { chunkText } from '../utils/text.ts';
import { extractMedia, buildIncoming } from './media.ts';
import type { WhatsAppLikeClient } from './types.ts';

interface RawMessageLike {
  from?: string;
  body?: string;
  fromMe?: boolean;
  isGroupMsg?: boolean;
  hasMedia?: boolean;
  type?: string;
  author?: string;
  downloadMedia?: () => Promise<{ data: string; mimetype: string } | null | undefined>;
}

function phoneFromWhatsAppId(rawId: string): string {
  // Format: 919876543210@c.us. Strip the suffix.
  const at = rawId.indexOf('@');
  return at === -1 ? rawId : rawId.slice(0, at);
}

export async function dispatchToEngine(message: IncomingMessage): Promise<void> {
  const reply = await runEngine(message);
  if (!reply.text) return; // STOP state — silent.
  await deliver(message.phone, reply.text, reply.voicePromise, reply.state);
}

export async function dispatchSimulator(
  phone: string,
  body: string,
  hasAudio: boolean,
  hasImage: boolean,
  audioBase64?: string,
  imageBase64?: string,
  audioMimetype?: string,
  imageMimetype?: string,
): Promise<{
  text: string;
  state: ConversationState;
  voiceSpoken: string | null;
}> {
  const message: IncomingMessage = {
    phone: normalizePhone(phone),
    body,
    hasAudio,
    audioBuffer: audioBase64 ? Buffer.from(audioBase64, 'base64') : null,
    audioMimetype: audioMimetype ?? null,
    hasImage,
    imageBuffer: imageBase64 ? Buffer.from(imageBase64, 'base64') : null,
    imageMimetype: imageMimetype ?? null,
    source: 'simulator',
  };
  const reply = await runEngine(message);
  let voiceSpoken: string | null = null;
  if (reply.voicePromise) {
    try {
      const voice = await reply.voicePromise;
      voiceSpoken = voice?.spokenText ?? null;
    } catch {
      voiceSpoken = null;
    }
  }
  return { text: reply.text, state: reply.state, voiceSpoken };
}

let pendingClient: WhatsAppLikeClient | null = null;
let MessageMediaCtor: { new (mimetype: string, data: string): unknown } | null = null;

export function bindClient(client: WhatsAppLikeClient, media: { new (mimetype: string, data: string): unknown }): void {
  pendingClient = client;
  MessageMediaCtor = media;
}

async function deliver(
  phone: string,
  text: string,
  voicePromise: Promise<{ buffer: Buffer; mimetype: string; spokenText?: string } | null> | undefined,
  state: ConversationState,
): Promise<void> {
  if (!pendingClient) {
    log.warn('DELIVER_NO_CLIENT', { phone: maskPhone(phone), state });
    return;
  }
  const to = `${phone}@c.us`;

  // Pass 1 — text bubble(s). Chunk long replies.
  for (const chunk of chunkText(text, 1500)) {
    if (!chunk.trim()) continue;
    try {
      await pendingClient.sendMessage(to, chunk);
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
  if (!MessageMediaCtor) return;
  const media = new MessageMediaCtor(voice.mimetype, voice.buffer.toString('base64')) as object;
  try {
    await pendingClient.sendMessage(to, media, { sendAudioAsVoice: true });
  } catch (err) {
    log.warn('DELIVER_VOICE_FAIL', {
      phone: maskPhone(phone),
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
}

export async function onMessage(raw: RawMessageLike): Promise<void> {
  if (raw.fromMe) return;
  if (raw.isGroupMsg) return; // ignore groups in MVP
  if (!raw.from) return;

  const phone = normalizePhone(phoneFromWhatsAppId(raw.from));
  if (!phone) return;
  if (!isAllowed(phone, env.ALLOWED_TEST_NUMBERS, env.DEMO_MODE)) {
    log.debug('MESSAGE_DROPPED_ALLOWLIST', { phone: maskPhone(phone) });
    return;
  }

  const media = await extractMedia(raw);
  const incoming = buildIncoming(phone, raw.body ?? '', media, 'whatsapp');
  log.info('MESSAGE_INBOUND', {
    phone: maskPhone(phone),
    hasAudio: media.hasAudio,
    hasImage: media.hasImage,
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
