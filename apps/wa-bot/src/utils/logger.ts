/**
 * Tiny structured JSON logger, matched in style with apps/api so log lines
 * collate cleanly when both processes write to the same shipper.
 *
 * `maskPhone` lives here too so phone digits never accidentally land in
 * a log line. The bot logs phones constantly (every inbound message) and
 * we never want an unmasked one to leak into a shared dashboard.
 */
import { env } from '../config.ts';

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

export const log: Logger = createLogger({ component: 'wa-bot' });

/** Mask phone digits for log lines: 919876543210 → 9198****210. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
}
