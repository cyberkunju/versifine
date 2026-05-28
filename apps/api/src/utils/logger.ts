/**
 * Tiny structured JSON logger.
 *
 * Why custom and not pino: hackathon scope, zero dependencies, perfect Bun
 * compatibility, and we need exactly two features Pino gives us — leveled
 * output and child-context inheritance. The total surface fits in ~70 lines.
 *
 * Log lines are single-line JSON for grep-ability:
 *   {"ts":"2026-05-28T...","level":"info","event":"AUTH_LOGIN_OK","userId":"…"}
 */
import { env } from '../env.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const enabled = LEVEL_RANK[env.LOG_LEVEL];

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields: LogFields = {}, baseFields: LogFields = {}) {
  if (LEVEL_RANK[level] < enabled) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...baseFields,
    ...fields,
  });
  // stdout for info/debug, stderr for warn/error keeps default piping sane.
  if (level === 'warn' || level === 'error') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(extra: LogFields): Logger;
}

function createLogger(baseFields: LogFields = {}): Logger {
  return {
    debug: (event, fields) => emit('debug', event, fields, baseFields),
    info: (event, fields) => emit('info', event, fields, baseFields),
    warn: (event, fields) => emit('warn', event, fields, baseFields),
    error: (event, fields) => emit('error', event, fields, baseFields),
    child: (extra) => createLogger({ ...baseFields, ...extra }),
  };
}

export const log: Logger = createLogger();

/** Mask phone digits for log lines: 919876543210 → 9198****3210. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
}

/** Mask email at the local part: john@example.com → j***@example.com. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}
