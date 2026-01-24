import fs from 'fs';
import path from 'path';

let errorLogStream: fs.WriteStream | null = null;
let infoLogStream: fs.WriteStream | null = null;
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

const formatError = (err: unknown): string => {
  if (err instanceof Error) {
    const stack = err.stack ? `\n${err.stack}` : '';
    return `${err.message}${stack}`;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
};

export const logInfo = (message: string): void => {
  const timestamp = new Date().toISOString();
  const line = `[info] ${timestamp} ${message}`;
  if (infoLogStream) {
    infoLogStream.write(`${line}\n`);
  }
  console.log(line);
};

export const logError = (message: string, err?: unknown): void => {
  const timestamp = new Date().toISOString();
  const suffix = err !== undefined ? ` ${formatError(err)}` : '';
  const line = `[error] ${timestamp} ${message}${suffix}`;
  if (errorLogStream) {
    errorLogStream.write(`${line}\n`);
  }
  // Emit to stderr so Cloud Run logs capture startup/runtime failures.
  console.error(line);
};
