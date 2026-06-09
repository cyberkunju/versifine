/**
 * API entry point.
 *
 * One Hono instance, one Bun.serve listener. Routes are mounted by feature.
 * Order: requestId → error catcher → routes. The error middleware sits
 * outside the routers so it captures throws from any layer.
 *
 * The same Bun.serve instance terminates both the HTTP routes and the
 * `/ws` upgrade. The `fetch` handler intercepts upgrade requests, calls
 * `server.upgrade`, and lets Hono handle everything else.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './env.ts';
import { errorMiddleware, onError } from './middleware/error.ts';
import { requestId } from './middleware/requestId.ts';
import { adviceRoutes } from './routes/advice.ts';
import { authRoutes } from './routes/auth.ts';
import { botRoutes } from './routes/bot.ts';
import { budgetRoutes } from './routes/budgets.ts';
import { captureRoutes } from './routes/capture.ts';
import { copilotRoutes } from './routes/copilot.ts';
import { forecastRoutes } from './routes/forecast.ts';
import { goalRoutes } from './routes/goals.ts';
import { healthRoutes } from './routes/health.ts';
import { ledgerRoutes } from './routes/ledger.ts';
import { recurringRoutes } from './routes/recurring.ts';
import { reportRoutes } from './routes/reports.ts';
import { transactionRoutes } from './routes/transactions.ts';
import { walletRoutes } from './routes/wallets.ts';
import { authoriseUpgrade, selectedSubprotocol, wsRoutes } from './routes/ws.ts';
import { attachSocket, detachSocket, type WsAttachment } from './services/events/ws.ts';
import { log } from './utils/logger.ts';

import { webhookRoutes } from './routes/webhook.ts';

const app = new Hono();

// Canonical error handler — fires for any throw anywhere in the chain,
// including async route handlers and nested routers. This is what reliably
// converts a thrown AppError into our JSON envelope in the bundled build.
app.onError(onError);

app.use('*', requestId);
app.use('*', errorMiddleware);
app.use(
  '*',
  cors({
    origin: (origin) => origin ?? '*',
    allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Bot-Secret', 'X-Phone'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['X-Request-Id', 'X-RateLimit-Remaining'],
    credentials: true,
  }),
);

app.route('/health', healthRoutes);
app.route('/auth', authRoutes);
app.route('/bot', botRoutes);
app.route('/capture', captureRoutes);
app.route('/wallets', walletRoutes);
app.route('/transactions', transactionRoutes);
app.route('/budgets', budgetRoutes);
app.route('/goals', goalRoutes);
app.route('/ledger', ledgerRoutes);
app.route('/recurring', recurringRoutes);
app.route('/forecast', forecastRoutes);
app.route('/reports', reportRoutes);
app.route('/advice', adviceRoutes);
app.route('/copilot', copilotRoutes);
app.route('/ws', wsRoutes);
app.route('/webhook', webhookRoutes);

app.notFound((c) =>
  c.json(
    {
      success: false,
      error: { code: 'NOT_FOUND', message: `Route not found: ${c.req.method} ${c.req.path}` },
    },
    404,
  ),
);

const server = Bun.serve<WsAttachment>({
  hostname: env.API_HOST,
  port: env.API_PORT,
  idleTimeout: 30,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      // WebSocket upgrade path. Authorise via the subprotocol Bearer token,
      // then delegate to Bun's upgrader. Any exception ends as 401.
      try {
        const auth = await authoriseUpgrade(req);
        const subprotocol = selectedSubprotocol(req);
        const upgraded = srv.upgrade(req, {
          headers: subprotocol ? { 'Sec-WebSocket-Protocol': subprotocol } : undefined,
          data: { userId: auth.userId, attachedAt: Date.now() },
        });
        if (upgraded) return undefined as unknown as Response;
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'UPGRADE_REQUIRED', message: 'WebSocket upgrade failed' },
          }),
          { status: 426, headers: { 'content-type': 'application/json' } },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unauthorized';
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'UNAUTHORIZED', message },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      }
    }
    return app.fetch(req, srv);
  },
  websocket: {
    open(ws) {
      attachSocket(ws);
    },
    close(ws) {
      detachSocket(ws);
    },
    message(_ws, _message) {
      // Clients are read-only at the protocol level; ignore any message.
    },
  },
});

log.info('API_LISTENING', {
  host: server.hostname,
  port: server.port,
  env: env.NODE_ENV,
  azureAiConfigured: Boolean(env.AZURE_AI_KEY),
  ws: '/ws',
});

const shutdown = (signal: string) => {
  log.info('API_SHUTDOWN', { signal });
  server.stop(true);
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
