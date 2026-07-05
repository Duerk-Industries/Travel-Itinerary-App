import * as Sentry from '@sentry/node';
import { isSentryEnabled } from '../instrument';

export const withAiSpan = async <T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> => {
  if (!isSentryEnabled()) return fn();
  const sentry = Sentry as any;
  if (typeof sentry.startSpan !== 'function') return fn();
  return sentry.startSpan({ name, op: 'ai', attributes }, fn);
};
