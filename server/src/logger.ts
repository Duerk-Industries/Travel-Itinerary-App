import fs from 'fs';
import path from 'path';
import { getRequestContext } from './requestContext';

let errorLogStream: fs.WriteStream | null = null;
let infoLogStream: fs.WriteStream | null = null;
if (!process.env.JEST_WORKER_ID && process.env.NODE_ENV !== 'test') {
  try {
    const logDir = path.resolve(__dirname, '..', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const errorLogPath = path.join(logDir, 'api-error.log');
    errorLogStream = fs.createWriteStream(errorLogPath, { flags: 'a' });
    const infoLogPath = path.join(logDir, 'api-info.log');
    infoLogStream = fs.createWriteStream(infoLogPath, { flags: 'a' });
  } catch (err) {
    // Fall back to stderr only when the filesystem is read-only (Cloud Run).
    console.error('[logger] Failed to initialize file logging:', err);
    errorLogStream = null;
    infoLogStream = null;
  }
}

const isStructuredOutput = (): boolean => {
  const explicit = process.env.LOG_FORMAT;
  if (explicit === 'json') return true;
  if (explicit === 'text') return false;
  // Default: structured JSON in production-like environments, human-readable otherwise.
  return process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
};

// Keys whose values should be redacted even if embedded in error metadata.
// The matcher is substring-based after lower-casing and stripping `-_`, so
// `password`, `newPassword`, `currentPassword`, `newPasswordConfirm` all
// collapse to the `password` entry.
const REDACT_KEYS = [
  'password',
  'passwordhash',
  'pwd',
  'authsecret',
  'auth_secret',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'bearer',
  'jwt',
  'session',
  'sessionid',
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'api_key',
  'credential',
  'credentials',
  'privatekey',
  'private_key',
];

const shouldRedactKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  return REDACT_KEYS.some((r) => normalized.includes(r.replace(/[-_]/g, '')));
};

const redactValue = (value: unknown, depth = 0): unknown => {
  if (depth > 4) return '[Redacted: depth]';
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (shouldRedactKey(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
};

const formatErrorForText = (err: unknown): string => {
  if (err instanceof Error) {
    const stack = err.stack ? `\n${err.stack}` : '';
    return `${err.message}${stack}`;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(redactValue(err));
  } catch {
    return 'Unknown error';
  }
};

const errorToJsonFields = (err: unknown): Record<string, unknown> => {
  if (err instanceof Error) {
    return {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    };
  }
  if (typeof err === 'string') {
    return { error: err };
  }
  return { error: redactValue(err) };
};

const contextFields = (): Record<string, unknown> => {
  const ctx = getRequestContext();
  if (!ctx) return {};
  const out: Record<string, unknown> = { requestId: ctx.requestId };
  if (ctx.method) out.method = ctx.method;
  if (ctx.path) out.path = ctx.path;
  if (ctx.userId) out.userId = ctx.userId;
  return out;
};

const contextSuffixText = (): string => {
  const ctx = getRequestContext();
  if (!ctx) return '';
  return ` [req=${ctx.requestId}]`;
};

export const logInfo = (message: string): void => {
  const timestamp = new Date().toISOString();
  if (isStructuredOutput()) {
    const entry = {
      level: 'info',
      time: timestamp,
      message,
      ...contextFields(),
    };
    const line = JSON.stringify(entry);
    if (infoLogStream) infoLogStream.write(`${line}\n`);
    console.log(line);
    return;
  }
  const line = `[info] ${timestamp}${contextSuffixText()} ${message}`;
  if (infoLogStream) {
    infoLogStream.write(`${line}\n`);
  }
  console.log(line);
};

export const logError = (message: string, err?: unknown): void => {
  const timestamp = new Date().toISOString();
  if (isStructuredOutput()) {
    const entry = {
      level: 'error',
      time: timestamp,
      message,
      ...contextFields(),
      ...(err !== undefined ? errorToJsonFields(err) : {}),
    };
    const line = JSON.stringify(entry);
    if (errorLogStream) errorLogStream.write(`${line}\n`);
    console.error(line);
    return;
  }
  const suffix = err !== undefined ? ` ${formatErrorForText(err)}` : '';
  const line = `[error] ${timestamp}${contextSuffixText()} ${message}${suffix}`;
  if (errorLogStream) {
    errorLogStream.write(`${line}\n`);
  }
  console.error(line);
};
