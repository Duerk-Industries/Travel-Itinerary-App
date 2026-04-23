import { getRequestContext } from './requestContext';

export type MetricLabels = Record<string, string | number | boolean>;

const isStructuredOutput = (): boolean => {
  const explicit = process.env.LOG_FORMAT;
  if (explicit === 'json') return true;
  if (explicit === 'text') return false;
  return process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
};

type MetricEntry = {
  level: 'info';
  channel: 'metric';
  time: string;
  name: string;
  kind: 'counter' | 'gauge' | 'timing';
  value: number;
  labels?: MetricLabels;
  requestId?: string;
  userId?: string;
};

const emit = (entry: MetricEntry): void => {
  if (isStructuredOutput()) {
    console.log(JSON.stringify(entry));
    return;
  }
  const labels = entry.labels
    ? ' ' + Object.entries(entry.labels).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';
  const ctxSuffix = entry.requestId ? ` [req=${entry.requestId}]` : '';
  // eslint-disable-next-line no-console
  console.log(
    `[metric]${ctxSuffix} ${entry.kind}:${entry.name}=${entry.value}${labels}`
  );
};

const baseEntry = (
  name: string,
  kind: MetricEntry['kind'],
  value: number,
  labels?: MetricLabels
): MetricEntry => {
  const ctx = getRequestContext();
  const entry: MetricEntry = {
    level: 'info',
    channel: 'metric',
    time: new Date().toISOString(),
    name,
    kind,
    value,
  };
  if (labels && Object.keys(labels).length > 0) entry.labels = labels;
  if (ctx?.requestId) entry.requestId = ctx.requestId;
  if (ctx?.userId) entry.userId = ctx.userId;
  return entry;
};

/** Increment a counter by `amount` (default 1). */
export const incrementMetric = (
  name: string,
  labels?: MetricLabels,
  amount = 1
): void => {
  emit(baseEntry(name, 'counter', amount, labels));
};

/** Record a point-in-time gauge value. */
export const recordGauge = (
  name: string,
  value: number,
  labels?: MetricLabels
): void => {
  emit(baseEntry(name, 'gauge', value, labels));
};

/** Record a duration in milliseconds. */
export const recordTiming = (
  name: string,
  durationMs: number,
  labels?: MetricLabels
): void => {
  emit(baseEntry(name, 'timing', durationMs, labels));
};

/**
 * Run `fn` and record its duration under `name`. Re-throws on error but still
 * emits the timing with a `success=false` label so failure latency is visible.
 */
export const timedAsync = async <T>(
  name: string,
  fn: () => Promise<T>,
  labels?: MetricLabels
): Promise<T> => {
  const start = Date.now();
  try {
    const result = await fn();
    recordTiming(name, Date.now() - start, { ...labels, success: true });
    return result;
  } catch (err) {
    recordTiming(name, Date.now() - start, { ...labels, success: false });
    throw err;
  }
};
