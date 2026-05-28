/**
 * Attach a per-request id and a request-scoped logger to context. The id
 * propagates to the response header so a client log line and a server log
 * line share the same correlation key.
 */
import type { MiddlewareHandler } from 'hono';
import { log, type Logger } from '../utils/logger.ts';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    log: Logger;
  }
}

export const requestId: MiddlewareHandler = async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9-_]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();

  c.set('requestId', id);
  c.set(
    'log',
    log.child({
      requestId: id,
      method: c.req.method,
      path: c.req.path,
    }),
  );
  c.header('x-request-id', id);
  await next();
};
