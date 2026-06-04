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
                log.info('WHATSAPP_WEBHOOK_MESSAGE_RECEIVED', {
                  from: message.from,
                  type: message.type,
                  messageId: message.id,
                  text: message.text?.body,
                });
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
