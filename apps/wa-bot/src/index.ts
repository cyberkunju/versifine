/**
 * Bot entry. Boots the internal HTTP server first (so /qr is reachable
 * even before WhatsApp pairs), then starts the whatsapp-web.js client.
 *
 * Two boot modes:
 *   - Direct (this file): runs in-process. Used by `bun run dev`.
 *   - Supervised: `supervisor.ts` spawns this file and restarts on exit.
 */
import { env } from './config.ts';
import { createClient, startWatchdog, clearSession } from './openwa/createClient.ts';
import { startInternalServer } from './server/internalServer.ts';
import { log } from './utils/logger.ts';

async function main(): Promise<void> {
  log.info('BOT_STARTING', {
    env: env.NODE_ENV,
    apiUrl: env.API_URL,
    demoMode: env.DEMO_MODE,
    allowlistSize: env.ALLOWED_TEST_NUMBERS.length,
    headless: env.HEADLESS,
  });

  // The internal HTTP server (health, /qr, /qr.png, /send, /simulator) comes
  // up FIRST and STAYS UP for the life of the process. Even if the WhatsApp
  // client can't boot (logged-out/corrupt session, Chromium hiccup), the QR
  // page must stay reachable so the user can re-pair without a crash loop.
  const httpServer = startInternalServer();

  let watchdog: ReturnType<typeof setInterval> | null = null;
  let client: Awaited<ReturnType<typeof createClient>> | null = null;

  /**
   * Try to bring up the WhatsApp client. On failure we DO NOT exit the
   * process (that kills the QR server and crash-loops under systemd).
   * Instead we retry with backoff; after a couple of failures we clear the
   * (likely invalidated) session so the next attempt surfaces a fresh QR.
   */
  const bootClient = async (): Promise<void> => {
    let attempt = 0;
    // Backoff schedule, capped. Resets implicitly once we succeed (we return).
    const delays = [5_000, 15_000, 30_000, 60_000, 120_000];
    for (;;) {
      attempt += 1;
      try {
        client = await createClient();
        await client.initialize();
        watchdog = await startWatchdog(client);
        log.info('BOT_CLIENT_UP', { attempt });
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 240) : String(err);
        log.error('BOT_BOOT_FAIL', { attempt, error: message });
        try {
          if (client) await client.destroy();
        } catch {
          // ignore — about to retry
        }
        client = null;
        // A destroyed execution context / auth failure usually means the
        // stored session is no longer valid. After two tries, wipe it so the
        // next initialize() shows a QR to re-pair instead of failing forever.
        if (attempt === 2) {
          log.warn('BOT_SESSION_RESET', { reason: 'repeated_boot_fail' });
          try {
            await clearSession();
          } catch (e) {
            log.warn('BOT_SESSION_RESET_FAIL', {
              error: e instanceof Error ? e.message.slice(0, 160) : String(e),
            });
          }
        }
        const delay = delays[Math.min(attempt - 1, delays.length - 1)]!;
        log.info('BOT_BOOT_RETRY', { inMs: delay, nextAttempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  };

  // Fire the client boot in the background when running in legacy browser automation mode.
  // When running in WhatsApp Cloud API mode (determined by the presence of WHATSAPP_TOKEN),
  // we bypass chromium client boot entirely.
  if (process.env.WHATSAPP_TOKEN) {
    log.info('BOT_RUNNING_CLOUD_API_MODE', { reason: 'WHATSAPP_TOKEN is present in environment' });
  } else {
    void bootClient().catch((err) => {
      log.error('BOT_BOOT_LOOP_FAIL', {
        error: err instanceof Error ? err.message.slice(0, 240) : String(err),
      });
    });
  }

  const shutdown = async (signal: string) => {
    log.info('BOT_SHUTDOWN', { signal });
    if (watchdog) clearInterval(watchdog);
    try {
      if (client) await client.destroy();
    } catch {
      // ignore — we're exiting anyway
    }
    httpServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  log.error('BOT_MAIN_FAIL', {
    error: err instanceof Error ? err.message.slice(0, 240) : String(err),
  });
  process.exit(2);
});
