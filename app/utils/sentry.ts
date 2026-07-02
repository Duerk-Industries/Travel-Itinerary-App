/**
 * Sentry bootstrap for WanderBunnies.
 *
 * Designed to be safe to import unconditionally:
 *  - `initSentry()` is a no-op when EXPO_PUBLIC_SENTRY_DSN is missing, so a
 *    fresh checkout / unconfigured CI never errors out.
 *  - `wrapApp()` returns the bare component when Sentry isn't initialized,
 *    so the ErrorBoundary path doesn't change just because reporting is off.
 *
 * Wiring:
 *  - AppEntry.js calls initSentry() before any other app code so that
 *    startup-time crashes still get captured.
 *  - The Metro side (`metro.shared.cjs` → `withSentryConfig`) handles
 *    Debug ID injection and stack-frame collapsing.
 *  - EAS native builds upload source maps automatically when
 *    SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT are set in the build
 *    environment (the @sentry/react-native/expo plugin handles this).
 *  - For web (`expo export --platform web`), the same env vars trigger
 *    upload during the export step; see docs/sentry.md.
 */
import type { ComponentType } from 'react';

type InitOptions = {
  /** Override for tests; in production this comes from env. */
  dsn?: string | null;
  /** Override for tests; defaults to NODE_ENV. */
  environment?: string;
  /** Override for tests; defaults to 0.1 (10% of transactions traced). */
  tracesSampleRate?: number;
};

type InitResult =
  | { initialized: true; reason: 'configured' }
  | { initialized: false; reason: 'missing-dsn' | 'module-load-failed' | 'already-initialized' };

let initState: InitResult | null = null;

const resolveDsn = (override?: string | null): string | null => {
  if (override !== undefined) return override?.trim() || null;
  const fromEnv = process.env.EXPO_PUBLIC_SENTRY_DSN;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : null;
};

const resolveEnvironment = (override?: string): string => {
  if (override) return override;
  // EXPO_PUBLIC_SENTRY_ENV lets ops pin the bucket explicitly (e.g.
  // "preview" for staging exports) without redeploying code.
  return (
    process.env.EXPO_PUBLIC_SENTRY_ENV ||
    process.env.NODE_ENV ||
    'production'
  );
};

const safeRequireSentry = (): typeof import('@sentry/react-native') | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@sentry/react-native') as typeof import('@sentry/react-native');
  } catch {
    return null;
  }
};

export const initSentry = (options: InitOptions = {}): InitResult => {
  if (initState && initState.initialized) {
    return { initialized: false, reason: 'already-initialized' };
  }
  const dsn = resolveDsn(options.dsn);
  if (!dsn) {
    initState = { initialized: false, reason: 'missing-dsn' };
    return initState;
  }
  const Sentry = safeRequireSentry();
  if (!Sentry) {
    initState = { initialized: false, reason: 'module-load-failed' };
    return initState;
  }
  Sentry.init({
    dsn,
    environment: resolveEnvironment(options.environment),
    // Tracing: low sample rate to keep quota costs manageable. Bump per
    // route / per user via Sentry.startSpan in hot paths if needed.
    tracesSampleRate: options.tracesSampleRate ?? 0.1,
    // Don't ship session replay — kept disabled in Metro config too.
    enableAutoSessionTracking: true,
  });
  initState = { initialized: true, reason: 'configured' };
  return initState;
};

export const getInitState = (): InitResult | null => initState;

/**
 * Returns the input component wrapped with Sentry's error boundary +
 * tracing wrapper, or the component unchanged when Sentry isn't active.
 * Keep this synchronous so JSX trees stay simple.
 */
export const wrapApp = <P extends Record<string, unknown>>(App: ComponentType<P>): ComponentType<P> => {
  if (!initState?.initialized) return App;
  const Sentry = safeRequireSentry();
  if (!Sentry || typeof Sentry.wrap !== 'function') return App;
  return Sentry.wrap(App) as ComponentType<P>;
};

/** Test-only reset. */
export const __resetSentryStateForTests = () => {
  initState = null;
};
