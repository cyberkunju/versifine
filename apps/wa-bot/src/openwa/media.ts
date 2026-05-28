/**
 * Helpers for downloading media that arrives on a whatsapp-web.js Message.
 *
 * Voice notes and images both come through `message.downloadMedia()` which
 * returns `{ data: <base64>, mimetype, filename? } | undefined`. We
 * decode to a Buffer and surface a tiny union the engine can switch on.
 */
import type { IncomingMessage } from '../types.ts';

interface RawMessage {
  hasMedia?: boolean;
  type?: string;
  downloadMedia?: () => Promise<
    | {
        data: string;
        mimetype: string;
        filename?: string | null;
      }
    | null
    | undefined
  >;
}

export interface ExtractedMedia {
  hasAudio: boolean;
  hasImage: boolean;
  audioBuffer: Buffer | null;
  audioMimetype: string | null;
  imageBuffer: Buffer | null;
  imageMimetype: string | null;
}

export async function extractMedia(message: RawMessage): Promise<ExtractedMedia> {
  const empty: ExtractedMedia = {
    hasAudio: false,
    hasImage: false,
    audioBuffer: null,
    audioMimetype: null,
    imageBuffer: null,
    imageMimetype: null,
  };
  if (!message.hasMedia || !message.downloadMedia) return empty;

  let media: { data: string; mimetype: string } | null | undefined;
  try {
    media = await message.downloadMedia();
  } catch {
    return empty;
  }
  if (!media || !media.data) return empty;

  const buffer = Buffer.from(media.data, 'base64');
  const mimetype = media.mimetype.toLowerCase();
  if (mimetype.startsWith('audio') || message.type === 'ptt' || message.type === 'audio') {
    return {
      ...empty,
      hasAudio: true,
      audioBuffer: buffer,
      audioMimetype: mimetype,
    };
  }
  if (mimetype.startsWith('image')) {
    return {
      ...empty,
      hasImage: true,
      imageBuffer: buffer,
      imageMimetype: mimetype,
    };
  }
  return empty;
}

export function buildIncoming(
  phone: string,
  body: string,
  media: ExtractedMedia,
  source: 'whatsapp' | 'simulator' = 'whatsapp',
): IncomingMessage {
  return {
    phone,
    body: body ?? '',
    hasAudio: media.hasAudio,
    audioBuffer: media.audioBuffer,
    audioMimetype: media.audioMimetype,
    hasImage: media.hasImage,
    imageBuffer: media.imageBuffer,
    imageMimetype: media.imageMimetype,
    source,
  };
}
