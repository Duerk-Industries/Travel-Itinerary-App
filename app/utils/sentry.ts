/**
 * Sentry bootstrap for WanderBunnies.
 *
 * Designed to be safe to import unconditionally:
 *  - `initSentry()` is a no-op when EXPO_PUBLIC_SENTRY_DSN is missing, so a
 *    fresh checkout / unconfigured CI never errors out.
 *  - `wrapApp()` installs the error boundary without initializing collection.
 *
 * Wiring:
 *  - Privacy consent bootstrap calls initSentry() only after the server
 *    confirms a current diagnostics grant and collection flag.
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
  pseudonym?: string;
};

type InitResult =
  | { initialized: true; reason: 'configured' }
  | { initialized: false; reason: 'missing-dsn' | 'missing-consent' | 'module-load-failed' | 'already-initialized' };

let initState: InitResult | null = null;
let closePromise: Promise<void> | null = null;

const scrubDiagnosticEvent = (event: any): any => {
  const pseudonym = event.user?.id;
  delete event.request;
  delete event.breadcrumbs;
  delete event.extra;
  delete event.tags;
  delete event.contexts;
  delete event.spans;
  delete event.message;
  delete event.transaction;
  event.user = pseudonym ? { id: pseudonym } : undefined;
  for (const exception of event.exception?.values ?? []) {
    delete exception.value;
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = frame.filename.split('?')[0];
      delete frame.vars;
    }
  }
  return event;
};

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
  if (!options.pseudonym) {
    initState = { initialized: false, reason: 'missing-consent' };
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
    sendDefaultPii: false,
    beforeSend: scrubDiagnosticEvent,
    beforeSendTransaction: scrubDiagnosticEvent,
    beforeBreadcrumb: () => null,
    // Don't ship session replay — kept disabled in Metro config too.
    enableAutoSessionTracking: true,
  });
  Sentry.setUser({ id: options.pseudonym });
  initState = { initialized: true, reason: 'configured' };
  return initState;
};

export const getInitState = (): InitResult | null => initState;

export const closeSentry = async (): Promise<void> => {
  if (closePromise) return closePromise;
  if (!initState?.initialized) return;
  const Sentry = safeRequireSentry();
  initState = null;
  if (Sentry) {
    Sentry.setUser(null);
    // A zero timeout prevents a withdrawal from intentionally flushing queued
    // optional envelopes. Device tests must confirm native transport behavior.
    closePromise = Sentry.close().then(() => undefined).finally(() => { closePromise = null; });
    await closePromise;
  }
};

/**
 * Returns the input component wrapped with Sentry's error boundary +
 * tracing wrapper, or the component unchanged when Sentry isn't active.
 * Keep this synchronous so JSX trees stay simple.
 */
export const wrapApp = <P extends Record<string, unknown>>(App: ComponentType<P>): ComponentType<P> => {
  if (!resolveDsn()) return App;
  const Sentry = safeRequireSentry();
  if (!Sentry || typeof Sentry.wrap !== 'function') return App;
  return Sentry.wrap(App) as ComponentType<P>;
};

/** Test-only reset. */
export const __resetSentryStateForTests = () => {
  initState = null;
  closePromise = null;
};
