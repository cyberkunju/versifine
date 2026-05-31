/**
 * Centralised error handling.
 *
 * We expose the logic as a Hono `onError` handler (registered via
 * `app.onError(...)`) rather than a try/catch middleware. `app.onError` is
 * Hono's canonical, guaranteed catch point: it fires for ANY error thrown
 * anywhere in the handler chain, including async route handlers and nested
 * routers. A try/catch wrapper middleware can miss throws that surface after
 * `await next()` resolves in some compositions — which is exactly how a
 * thrown `AppError` was escaping to Bun's default `500 Internal Server Error`
 * (text/plain) in the bundled production build.
 *
 * Anything that isn't an `AppError` or `ZodError` is logged at error level
 * and returned as a generic 500 — we never leak stack traces or driver error
 * messages back to clients.
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { MiddlewareHandler } from 'hono';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.ts';
import { log as rootLog } from '../utils/logger.ts';

function render(err: Error, c: Context): Response {
  // Prefer the per-request child logger; fall back to the root logger so we
  // never throw a SECOND time trying to log the first error.
  const requestLog = c.get('log') ?? rootLog;

  if (err instanceof AppError) {
    requestLog.warn('REQUEST_FAILED', {
      status: err.status,
      code: err.code,
      message: err.message,
    });
    return c.json(
      {
        success: false,
        error: { code: err.code, message: err.message, details: err.details },
      },
      err.status as ContentfulStatusCode,
    );
  }

  if (err instanceof ZodError) {
    const flat = err.flatten();
    requestLog.warn('REQUEST_VALIDATION', {
      formErrors: flat.formErrors,
      fieldErrors: flat.fieldErrors,
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION',
          message: 'Invalid request',
          details: { fieldErrors: flat.fieldErrors, formErrors: flat.formErrors },
        },
      },
      400,
    );
  }

  requestLog.error('REQUEST_UNHANDLED', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? String(err.stack ?? '').slice(0, 1200) : undefined,
  });
  return c.json(
    {
      success: false,
      error: { code: 'INTERNAL', message: 'Internal server error' },
    },
    500,
  );
}

/**
 * Hono `onError` handler. Register with `app.onError(onError)`.
 */
export function onError(err: Error, c: Context): Response {
  return render(err, c);
}

/**
 * Back-compat try/catch middleware. Kept as a defensive outer layer in
 * addition to `app.onError` — together they guarantee no thrown error ever
 * reaches Bun's default text/plain 500. Either one catching is sufficient.
 */
export const errorMiddleware: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } catch (err) {
    return render(err instanceof Error ? err : new Error(String(err)), c);
  }
};
