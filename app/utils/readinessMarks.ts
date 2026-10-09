import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { getInitState } from './sentry';

/**
 * Readiness timings (docs/implementation-plans/analytics-upgrade.md Phase 3): how long until the
 * trip list is usable and until a newly selected page has painted. Sent as Sentry spans, so they
 * exist only for users who granted Detailed Diagnostics (Sentry is not initialized otherwise).
 * Without that consent a measurement is dropped, never queued or stored. Attributes are bounded
 * enums only: no user, trip or URL values.
 */

type Attributes = Record<string, string | number | boolean>;

const perf = (): { now: () => number; timeOrigin?: number } | null => {
  const p = (globalThis as { performance?: { now?: () => number; timeOrigin?: number } }).performance;
  return p && typeof p.now === 'function' ? (p as { now: () => number; timeOrigin?: number }) : null;
};

/** Milliseconds on the performance clock (0 ≈ page navigation on web, JS runtime start on native). */
export const nowMs = (): number => perf()?.now() ?? Date.now();

const toEpochSeconds = (perfMs: number): number => {
  const p = perf();
  if (!p) return perfMs / 1000; // nowMs() fell back to Date.now()
  const origin = typeof p.timeOrigin === 'number' ? p.timeOrigin : Date.now() - p.now();
  return (origin + perfMs) / 1000;
};

type SentrySpanApi = {
  startInactiveSpan: (options: {
    name: string;
    op: string;
    startTime: number;
    forceTransaction?: boolean;
    attributes?: Attributes;
  }) => { end: (endTime?: number) => void } | undefined;
};

let loadSentry = (): SentrySpanApi | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@sentry/react-native') as SentrySpanApi;
  } catch {
    return null;
  }
};

/** Records one readiness span; returns false (and records nothing) without diagnostics consent. */
export const recordReadiness = (name: string, startMs: number, endMs: number, attributes: Attributes = {}): boolean => {
  if (!getInitState()?.initialized) return false;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return false;
  const sentry = loadSentry();
  if (!sentry) return false;
  const span = sentry.startInactiveSpan({
    name,
    op: 'ui.ready',
    startTime: toEpochSeconds(startMs),
    forceTransaction: true,
    attributes: { platform: Platform.OS, ...attributes },
  });
  span?.end(toEpochSeconds(endMs));
  return Boolean(span);
};

let coldStartRecorded = false;
let loginStartedAtMs: number | null = null;

/** Call when sign-in completes; the next trip load is measured from here. */
export const markLoginStarted = (): void => {
  loginStartedAtMs = nowMs();
};

/** Call when the trip list has loaded. Cold start is measured once per JS runtime. */
export const markTripReady = (attributes: { hasTrips: boolean }): void => {
  const end = nowMs();
  if (!coldStartRecorded) {
    coldStartRecorded = true;
    loginStartedAtMs = null;
    recordReadiness('app.trip_ready', 0, end, { trigger: 'cold_start', hasTrips: attributes.hasTrips });
    return;
  }
  if (loginStartedAtMs != null) {
    const start = loginStartedAtMs;
    loginStartedAtMs = null;
    recordReadiness('app.trip_ready', start, end, { trigger: 'login', hasTrips: attributes.hasTrips });
  }
};

/**
 * Measures from the render that switches `page` to the first animation frame after it commits,
 * i.e. roughly until the new page is visible. The initial page is skipped (covered by trip_ready).
 */
export const useScreenReadyMark = (page: string): void => {
  const previous = useRef<string | null>(null);
  const startedAt = useRef<number | null>(null);
  if (previous.current !== null && previous.current !== page && startedAt.current === null) {
    startedAt.current = nowMs();
  }
  useEffect(() => {
    const from = previous.current;
    previous.current = page;
    const start = startedAt.current;
    startedAt.current = null;
    if (from === null || start === null) return;
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
    const finish = () => recordReadiness('ui.screen_ready', start, nowMs(), { page });
    if (raf) raf(finish);
    else finish();
  }, [page]);
};

export const __resetReadinessForTests = (sentryLoader?: () => SentrySpanApi | null): void => {
  coldStartRecorded = false;
  loginStartedAtMs = null;
  if (sentryLoader) loadSentry = sentryLoader;
};
