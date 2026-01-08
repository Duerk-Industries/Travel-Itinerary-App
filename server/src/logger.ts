import fs from 'fs';
import path from 'path';

const logDir = path.resolve(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const errorLogPath = path.join(logDir, 'api-error.log');
const errorLogStream = fs.createWriteStream(errorLogPath, { flags: 'a' });

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

export const logError = (message: string, err?: unknown): void => {
  const timestamp = new Date().toISOString();
  const suffix = err !== undefined ? ` ${formatError(err)}` : '';
  errorLogStream.write(`[error] ${timestamp} ${message}${suffix}\n`);
};
