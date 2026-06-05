import { Hono } from 'hono';
import { log } from '../utils/logger.ts';

const app = new Hono();

/**
 * GET /webhook/whatsapp
 * Meta calls this to verify the webhook url during setup.
 */
app.get('/whatsapp', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'versifine-verify-token-2026';

  if (mode === 'subscribe' && token === verifyToken) {
    log.info('WHATSAPP_WEBHOOK_VERIFIED', { mode, token });
    return c.text(challenge || '', 200);
  }

  log.warn('WHATSAPP_WEBHOOK_VERIFICATION_FAILED', { mode, token });
  return c.text('Forbidden', 403);
});

/**
 * Send WhatsApp text message via Graph API
 */
async function sendWhatsAppTextMessage(to: string, text: string) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '1079257601947704';

  if (!token) {
    log.error('WHATSAPP_SEND_FAILED', { error: 'WHATSAPP_TOKEN not configured in environment' });
    return;
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

    const data = await response.json() as any;
    if (response.ok) {
      log.info('WHATSAPP_SEND_SUCCESS', { to, messageId: data.messages?.[0]?.id });
    } else {
      log.error('WHATSAPP_SEND_API_ERROR', { error: data });
    }
  } catch (error) {
    log.error('WHATSAPP_SEND_NETWORK_ERROR', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Download a media file (voice note or receipt) from Meta's servers
 */
async function downloadMetaMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    log.error('WHATSAPP_MEDIA_DOWNLOAD_FAILED', { error: 'WHATSAPP_TOKEN not configured in environment' });
    return null;
  }

  try {
    // 1. Get the media download URL from Meta Graph API
    const infoUrl = `https://graph.facebook.com/v23.0/${mediaId}`;
    const infoRes = await fetch(infoUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!infoRes.ok) {
      const errData = await infoRes.json().catch(() => ({}));
      log.error('WHATSAPP_MEDIA_INFO_FAILED', { status: infoRes.status, error: errData });
      return null;
    }

    const info = await infoRes.json() as any;
    const downloadUrl = info.url;
    const mimeType = info.mime_type || 'application/octet-stream';

    if (!downloadUrl) {
      log.error('WHATSAPP_MEDIA_URL_MISSING', { info });
      return null;
    }

    // 2. Fetch the actual binary file content using the lookaside URL
    const mediaRes = await fetch(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!mediaRes.ok) {
      log.error('WHATSAPP_MEDIA_BINARY_FAILED', { status: mediaRes.status });
      return null;
    }

    const arrayBuffer = await mediaRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
    };
  } catch (err) {
    log.error('WHATSAPP_MEDIA_DOWNLOAD_EXCEPTION', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * POST /webhook/whatsapp
 * Meta calls this whenever there is a webhook event (new message, status change, etc.)
 */
app.post('/whatsapp', async (c) => {
  try {
    const payload = await c.req.json() as any;
    
    // Log the payload details
    log.info('WHATSAPP_WEBHOOK_RECEIVED', {
      object: payload.object,
      entryCount: payload.entry?.length,
    });
    
    if (payload.entry && Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            const value = change.value;
            if (value && value.messages && Array.isArray(value.messages)) {
              for (const message of value.messages) {
                const sender = message.from;
                const messageId = message.id;
                
                log.info('WHATSAPP_WEBHOOK_MESSAGE_RECEIVED', {
                  from: sender,
                  type: message.type,
                  messageId,
                });

                // Prepare bot relay payload
                const botPayload: Record<string, any> = {
                  phone: sender,
                  body: '',
                  hasAudio: false,
                  audioBase64: null,
                  audioMimetype: null,
                  hasImage: false,
                  imageBase64: null,
                  imageMimetype: null,
                };

                let shouldRelay = false;

                if (message.type === 'text' && message.text?.body) {
                  botPayload.body = message.text.body;
                  shouldRelay = true;
                } else if (message.type === 'audio' && message.audio?.id) {
                  const media = await downloadMetaMedia(message.audio.id);
                  if (media) {
                    botPayload.hasAudio = true;
                    botPayload.audioBase64 = media.buffer.toString('base64');
                    botPayload.audioMimetype = media.mimeType;
                    // Provide a default description fallback
                    botPayload.body = '[voice note]';
                    shouldRelay = true;
                  }
                } else if (message.type === 'image' && message.image?.id) {
                  const media = await downloadMetaMedia(message.image.id);
                  if (media) {
                    botPayload.hasImage = true;
                    botPayload.imageBase64 = media.buffer.toString('base64');
                    botPayload.imageMimetype = media.mimeType;
                    // Provide a default description fallback
                    botPayload.body = message.image.caption || '[payment image]';
                    shouldRelay = true;
                  }
                }

                if (shouldRelay) {
                  // Forward to wa-bot on port 5001
                  const botUrl = `http://localhost:${process.env.BOT_PORT || '5001'}/webhook/message`;
                  const botSecret = process.env.BOT_SECRET || 'versifine-secret-2026';
                  
                  try {
                    const relayRes = await fetch(botUrl, {
                      method: 'POST',
                      headers: {
                        'x-bot-secret': botSecret,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(botPayload),
                    });
                    
                    if (relayRes.ok) {
                      const data = await relayRes.json() as any;
                      log.info('WHATSAPP_RELAY_SUCCESS', { sender, messageId, reply: data });
                    } else {
                      log.error('WHATSAPP_RELAY_FAILED', {
                        sender,
                        messageId,
                        status: relayRes.status,
                      });
                    }
                  } catch (relayErr) {
                    log.error('WHATSAPP_RELAY_NETWORK_ERROR', {
                      sender,
                      messageId,
                      error: relayErr instanceof Error ? relayErr.message : String(relayErr),
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    return c.json({ success: true });
  } catch (error) {
    log.error('WHATSAPP_WEBHOOK_ERROR', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
  }
});

export const webhookRoutes = app;
