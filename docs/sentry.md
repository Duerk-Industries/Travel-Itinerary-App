# Sentry error reporting & source maps

WanderBunnies wires `@sentry/react-native` into the Expo app **and**
`@sentry/node` into the Express backend so that production crashes (native,
web, and server) report to Sentry with symbolicated stack traces. Everything
is gated on environment variables, so the codebase ships safely whether or not
a Sentry project is provisioned.

The frontend and backend both report to the same Sentry project
(`duerk-industries / wanderbunnies-app`). Events are separated by SDK/platform
inside Sentry, so a single DSN is sufficient.

## What gets reported

- **Runtime errors** (uncaught exceptions, unhandled promise rejections)
  via `Sentry.init()` in `app/utils/sentry.ts`, called from
  `app/AppEntry.js` before any other app code runs.
- **React render errors** via `Sentry.wrap(Root)` around the entry
  component — that adds a Sentry-aware error boundary in front of the
  existing `EntryErrorBoundary`.
- **Light performance tracing** at a 10 % sample rate. Bump per-route
  via `Sentry.startSpan` in hot paths if needed.

Disabled on purpose:

- **Session replay** — `includeWebReplay: false` in Metro config to keep
  the web bundle small.
- **`annotateReactComponents`** in Metro — extra babel work for no
  diagnostic win unless we wire up the Performance product.

## Required environment variables

| Variable                       | Where to set it                          | Effect                                                                                       |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SENTRY_DSN`       | `app/.env`, EAS Build secrets, web build | Enables `Sentry.init`. **Without this, the entire integration is a no-op at runtime.**       |
| `EXPO_PUBLIC_SENTRY_ENV`       | optional                                 | Overrides the `environment` tag (e.g. `"preview"` for staging). Falls back to `NODE_ENV`.    |
| `SENTRY_AUTH_TOKEN`            | EAS Build secret + local export shell    | Authenticates the source-map upload. Without it, no maps upload; runtime reporting still works. |
| `SENTRY_ORG`                   | EAS Build secret + local export shell    | Sentry organization slug.                                                                    |
| `SENTRY_PROJECT`               | EAS Build secret + local export shell    | Sentry project slug.                                                                         |
| `SENTRY_URL`                   | optional                                 | Override for self-hosted Sentry. Defaults to `https://sentry.io/`.                           |

## How upload works

### Native (EAS)

The `@sentry/react-native/expo` config plugin (registered in
`app/app.config.ts`, the single source of truth for the Expo config) hooks
into EAS's `expo prebuild` /
`xcodebuild` / `gradle` flow. When `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` +
`SENTRY_PROJECT` are present in the EAS Build environment, the plugin
invokes `sentry-cli` to upload native source maps after the bundle is
generated. Crashes from production native builds are then symbolicated
against the uploaded maps using the Debug ID that `withSentryConfig`
injected into the JS bundle.

To set the secrets in EAS:

```bash
eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token>
eas secret:create --scope project --name SENTRY_ORG       --value <org-slug>
eas secret:create --scope project --name SENTRY_PROJECT   --value <project-slug>
```

(Provide `--scope account` instead if you want them shared across all
EAS projects.)

### Web (`expo export --platform web`)

The same env vars trigger upload during the export step. Run:

```bash
SENTRY_AUTH_TOKEN=… SENTRY_ORG=… SENTRY_PROJECT=… \
  EXPO_PUBLIC_SENTRY_DSN=… \
  npm --prefix app run export:web
```

The Metro side (`withSentryConfig` in `metro.shared.cjs`) injects a
Debug ID into the web bundle; the plugin uploads the corresponding
source maps so production web stack traces resolve to the original
TypeScript.

## Local development

Leave all the env vars unset for normal local work. `initSentry()`
returns `{ initialized: false, reason: 'missing-dsn' }` and the Metro
wrapper degrades to a no-op. Nothing on the developer path changes.

If you need to test the integration end-to-end locally:

```bash
EXPO_PUBLIC_SENTRY_DSN=https://… npm --prefix app run web
```

…and trigger an error in the UI. It should appear in the configured
project within a few seconds.

## Backend (server)

The Express backend reports via `@sentry/node`, whose v10 SDK is built on
OpenTelemetry — so traces and errors export directly to Sentry over the DSN. An
external OTLP pipeline (Sentry's OTLP endpoint) is an alternative we don't need
because the SDK exports on its own.

Wiring:

- `server/src/instrument.ts` — calls `Sentry.init()` and is imported as the
  **very first** module in `server/src/index.ts`, before `http`/`express` are
  used, so auto-instrumentation can patch them. No-op when `SENTRY_DSN` is
  unset.
- `server/src/app.ts` — registers `Sentry.setupExpressErrorHandler(app)` after
  all routes but before the custom error handler, so unhandled request errors
  are captured. The custom handler below it still formats the client response.

### Backend environment variables

| Variable                    | Effect                                                                         |
| --------------------------- | ------------------------------------------------------------------------------ |
| `SENTRY_DSN`                | Enables backend `Sentry.init`. **Without it the backend integration is off.**  |
| `SENTRY_ENVIRONMENT`        | Environment tag. Falls back to `NODE_ENV`, then `production`.                   |
| `SENTRY_TRACES_SAMPLE_RATE` | Fraction of requests traced (0..1). Defaults to `0.1`.                          |
| `SENTRY_RELEASE`            | Optional release tag for grouping events by deploy.                            |

Read these through the standard server config: locally they live in
`server/.env`; in production set them as Cloud Run env vars on the service. The
`_FILE` suffix convention works too (e.g. `SENTRY_DSN_FILE=/run/secrets/...`).

## Files

- `app/utils/sentry.ts` — runtime init helper. Safe to import always.
- `app/AppEntry.js` — calls `initSentry()` early, wraps `Root` with
  `wrapApp()`.
- `metro.shared.cjs` — wraps the Metro config with `withSentryConfig`
  so Debug IDs end up in every bundle.
- `app/app.config.ts` — registers the Expo config plugin
  that triggers source-map upload.

## Disabling Sentry for a build

Unset `EXPO_PUBLIC_SENTRY_DSN` (or pass `--public-env EXPO_PUBLIC_SENTRY_DSN=`
to `expo export`). Runtime reporting goes silent. To also skip the
source-map upload step, unset `SENTRY_AUTH_TOKEN`.
