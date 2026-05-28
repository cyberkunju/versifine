/**
 * Bot entry. Boots the internal HTTP server first (so /qr is reachable
 * even before WhatsApp pairs), then starts the whatsapp-web.js client.
 *
 * Two boot modes:
 *   - Direct (this file): runs in-process. Used by `bun run dev`.
 *   - Supervised: `supervisor.ts` spawns this file and restarts on exit.
 */
import { env } from './config.ts';
import { createClient, startWatchdog } from './openwa/createClient.ts';
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

  const httpServer = startInternalServer();

  let watchdog: ReturnType<typeof setInterval> | null = null;
  let client: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    client = await createClient();
    await client.initialize();
    watchdog = await startWatchdog(client);
  } catch (err) {
    log.error('BOT_BOOT_FAIL', {
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    });
    httpServer.stop();
    process.exit(2);
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
