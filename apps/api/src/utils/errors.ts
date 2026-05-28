/**
 * AppError — the only error class the API throws on purpose.
 *
 * Every non-AppError exception is treated as a 500 in the error middleware
 * and gets a generic message; AppError subclasses carry their own status
 * code and machine-readable code so the client can render a sane UI.
 */

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_AI'
  | 'INTERNAL';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(opts: {
    status: number;
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = 'AppError';
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export const errors = {
  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError({ status: 400, code: 'VALIDATION', message, details }),
  unauthorized: (message = 'Authentication required') =>
    new AppError({ status: 401, code: 'UNAUTHORIZED', message }),
  forbidden: (message = 'Forbidden') =>
    new AppError({ status: 403, code: 'FORBIDDEN', message }),
  notFound: (message = 'Not found') =>
    new AppError({ status: 404, code: 'NOT_FOUND', message }),
  conflict: (message: string, details?: Record<string, unknown>) =>
    new AppError({ status: 409, code: 'CONFLICT', message, details }),
  rateLimited: (message = 'Too many requests') =>
    new AppError({ status: 429, code: 'RATE_LIMITED', message }),
  upstream: (message: string) =>
    new AppError({ status: 502, code: 'UPSTREAM_AI', message }),
  internal: (message = 'Internal server error') =>
    new AppError({ status: 500, code: 'INTERNAL', message }),
};
