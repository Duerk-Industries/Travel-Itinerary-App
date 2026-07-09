import * as Sentry from '@sentry/node';

export const withAiSpan = async <T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> => {
  const sentry = Sentry as any;
  if (typeof sentry.getClient === 'function' && !sentry.getClient()) return fn();
  if (typeof sentry.startSpan !== 'function') return fn();
  return sentry.startSpan({ name, op: 'ai', attributes }, fn);
};
