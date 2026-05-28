/**
 * Top-level error catcher.
 *
 * The handler runs first so even errors thrown by other middleware get
 * formatted into the standard envelope. Anything that isn't an `AppError`
 * is logged at error level and returned as a generic 500 — we never leak
 * stack traces or driver error messages back to clients.
 */
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { MiddlewareHandler } from 'hono';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.ts';

export const errorMiddleware: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } catch (err) {
    const requestLog = c.get('log');

    if (err instanceof AppError) {
      requestLog?.warn('REQUEST_FAILED', {
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
      requestLog?.warn('REQUEST_VALIDATION', {
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

    requestLog?.error('REQUEST_UNHANDLED', {
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
};
