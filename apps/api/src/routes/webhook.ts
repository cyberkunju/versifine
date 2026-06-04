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
    
    // Detailed logging of entries
    if (payload.entry && Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            const value = change.value;
            if (value && value.messages && Array.isArray(value.messages)) {
              for (const message of value.messages) {
                const sender = message.from;
                const textBody = message.text?.body;

                log.info('WHATSAPP_WEBHOOK_MESSAGE_RECEIVED', {
                  from: sender,
                  type: message.type,
                  messageId: message.id,
                  text: textBody,
                });

                if (message.type === 'text' && textBody) {
                  // Reply back with an echo to test the round-trip
                  const replyText = `Hi! This is the Versifine Business API bot. I received your message: "${textBody}"`;
                  await sendWhatsAppTextMessage(sender, replyText);
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
