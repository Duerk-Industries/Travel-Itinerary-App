/**
 * Sentry bootstrap for the backend.
 *
 * Imported as the VERY FIRST module in index.ts — before ./app and before the
 * http/express modules are exercised — so that @sentry/node's
 * OpenTelemetry-based auto-instrumentation can patch them. Errors and
 * performance traces are shipped to the Sentry project identified by
 * SENTRY_DSN (the same project the Expo client reports to). Under the hood the
 * SDK is OTel; pointing an external OTLP pipeline at Sentry is an alternative
 * we don't need here because the SDK exports directly via the DSN.
 *
 * Safe no-op when SENTRY_DSN is unset: a fresh checkout, CI, and the in-memory
 * test runs never initialize Sentry, so nothing on those paths changes.
 */
import * as Sentry from '@sentry/node';
import { loadEnv } from './env_loader';
import { getEnvValue } from './env';

// Sentry must read its config before anything else, so prime the env files
// here. app.ts re-runs dotenv with `override: false` later, a harmless no-op
// for keys already set by this call.
loadEnv();

const dsn = getEnvValue('SENTRY_DSN');

const parseSampleRate = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
};

if (dsn) {
  Sentry.init({
    dsn,
    // Environment bucket: explicit override, else NODE_ENV, else production.
    environment:
      getEnvValue('SENTRY_ENVIRONMENT') || getEnvValue('NODE_ENV') || 'production',
    // Low default trace sample rate to keep quota costs manageable; override
    // with SENTRY_TRACES_SAMPLE_RATE (0..1) per environment.
    tracesSampleRate: parseSampleRate(getEnvValue('SENTRY_TRACES_SAMPLE_RATE'), 0.1),
    // Tags releases when the deploy pipeline provides a version.
    release: getEnvValue('SENTRY_RELEASE'),
  });
}

/** True when Sentry was initialized (a DSN was present at startup). */
export const isSentryEnabled = (): boolean => Boolean(dsn);
