console.log('Backend starting... Travel Itinerary App v1.0.0');
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import * as Sentry from '@sentry/node';
import './expressAsyncPatch';
import authRoutes from './routes/authRoutes';
import transferRoutes from './routes/transferRoutes';
import webAuthRoutes from './routes/webAuthRoutes';
import tripRoutes from './routes/tripRoutes';
import itineraryRoutes from './routes/itineraryRoutes';
import itineraryDataRoutes from './routes/itineraryDataRoutes';
import traitRoutes from './routes/traitRoutes';
import lodgingRoutes from './routes/lodgingRoutes';
import activityRoutes from './routes/activityRoutes';
import carRentalRoutes from './routes/carRentalRoutes';
import accountRoutes, { groupsRouter } from './routes/accountRoutes';
import placeRoutes from './routes/placeRoutes';
import expenseRoutes from './routes/expenseRoutes';
import paymentRoutes from './routes/ledgerPaymentRoutes';
import adminRoutes from './routes/adminRoutes';
import adminBillingRoutes from './routes/adminBillingRoutes';
import ingestionRoutes from './routes/ingestionRoutes';
import ingestionAdminRoutes from './routes/ingestionAdminRoutes';
import ingestionWebhookRoutes from './routes/ingestionWebhookRoutes';
import stripeWebhookRoutes from './routes/stripeWebhookRoutes';
import billingRoutes from './routes/billingRoutes';
import ingestionGmailOAuthRoutes from './routes/ingestionGmailOAuthRoutes';
import internalIngestionWorkerRoutes from './routes/internalIngestionWorkerRoutes';
import internalBillingRoutes from './routes/internalBillingRoutes';
import internalDeployRoutes from './routes/internalDeployRoutes';
import prometheusRoutes from './routes/prometheusRoutes';
import staticMapRoutes from './routes/staticMapRoutes';
import getYourGuideRoutes from './routes/getYourGuideRoutes';
import blogRoutes from './routes/blogRoutes';

import { loadEnv } from './env_loader';
import { getBackendUrl, getEnvValue, hasRunLocalFlag, isLocalEnv } from './env';

// Load env vars from server/.env as the primary local source, with server/.secrets
// still supported as a backwards-compatible fallback (plus repo root fallbacks).
// .local_env files load only when RUN_LOCAL=1 is set inside that file.
//
// Precedence (highest to lowest): shell env > .local_env > .env > .secrets.
// Achieved by loading .local_env FIRST with `override: false`, so its keys
// take precedence over the .env/.secrets values loaded afterward (which
// also use `override: false` and so leave already-set keys alone). Shell
// env vars are set before any of this runs and are preserved by
// `override: false` throughout.
const localEnvPaths = [
  path.resolve(__dirname, '../.local_env'),
  path.resolve(__dirname, '../../.local_env'),
];
const isLocalFlag = localEnvPaths.some((envPath) => hasRunLocalFlag(envPath));
const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.secrets'),
  path.resolve(__dirname, '../../.secrets'),
];
const loadedEnvPaths: string[] = [];
for (const envPath of localEnvPaths) {
  if (hasRunLocalFlag(envPath)) {
    dotenv.config({ path: envPath, override: false });
    loadedEnvPaths.push(envPath);
  }
}
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
    loadedEnvPaths.push(envPath);
  }
}
let envLoadedFrom: string | null = null;
if (loadedEnvPaths.length === 0) {
  dotenv.config(); // default search (process cwd)
  envLoadedFrom = 'process.env/default';
} else {
  envLoadedFrom = loadedEnvPaths.join(', ');
}

export { envLoadedFrom };

export const app = express();
app.set('trust proxy', 1);

// Mailgun may send larger multipart or urlencoded webhook payloads than the
// app-wide default body parser limits, so mount webhook routes before them.
app.use('/api/ingestion/webhooks', ingestionWebhookRoutes);

// Stripe webhook must receive the raw body for signature verification.
// Mount before express.json() so body-parser does not consume the raw bytes.
app.use('/api/billing/webhooks', express.raw({ type: 'application/json' }), stripeWebhookRoutes);

const isRunningLocally = isLocalEnv();
const webUrl = getBackendUrl('https://wander-bunnies.com') || 'https://wander-bunnies.com';

const getAllowedOrigins = () => {
  const origins = new Set<string | RegExp>();
  if (isRunningLocally) {
    origins.add(/^http:\/\/localhost(:\d+)?$/);
    origins.add(/^http:\/\/127\.0\.0\.1(:\d+)?$/);
  }

  // Add primary webUrl
  origins.add(webUrl);

  // Add origins from allowlist if configured
  const allowlist = getEnvValue('AUTH_REDIRECT_URI_ALLOWLIST') || '';
  allowlist.split(/[;,]/).forEach(origin => {
    const trimmed = origin.trim();
    if (trimmed.startsWith('http')) {
      try {
        origins.add(new URL(trimmed).origin);
      } catch {
        // invalid URL in allowlist, skip
      }
    }
  });

  return Array.from(origins);
};

const allowedOrigins = getAllowedOrigins();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      // Allow requests with no origin, like mobile apps or curl requests.
      return callback(null, true);
    }
    for (const allowedOrigin of allowedOrigins) {
      if (typeof allowedOrigin === 'string') {
        if (allowedOrigin === origin) {
          return callback(null, true);
        }
      } else if (allowedOrigin && allowedOrigin.test(origin)) {
        return callback(null, true);
      }
    }
    const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
    return callback(new Error(msg));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'X-Analytics-Consent'],
  exposedHeaders: ['X-Request-Id'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let accessLogStream: fs.WriteStream | null = null;
try {
  const logDir = path.resolve(__dirname, '..', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const accessLogPath = path.join(logDir, 'api-access.log');
  accessLogStream = fs.createWriteStream(accessLogPath, { flags: 'a' });
} catch (err) {
  console.error('[api] Failed to initialize access log file:', err);
  accessLogStream = null;
}

import { generateRequestId, runWithRequestContext } from './requestContext';

const REQUEST_ID_HEADER = 'x-request-id';
const isStructuredOutput =
  process.env.LOG_FORMAT === 'json' ||
  (process.env.LOG_FORMAT !== 'text' &&
    (process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE)));

app.use((req, res, next) => {
  const inbound = req.header(REQUEST_ID_HEADER);
  const requestId = inbound && inbound.trim().length > 0 ? inbound.trim() : generateRequestId();
  res.setHeader('X-Request-Id', requestId);
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const timestamp = new Date().toISOString();
    const line = isStructuredOutput
      ? JSON.stringify({
          level: 'info',
          time: timestamp,
          channel: 'api',
          requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: ms,
        })
      : `[api] ${timestamp} [req=${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`;
    if (accessLogStream) {
      accessLogStream.write(`${line}\n`);
    } else {
      console.info(line);
    }
  });
  runWithRequestContext(
    { requestId, method: req.method, path: req.originalUrl },
    () => next()
  );
});

const publicDir = path.join(__dirname, '..', 'public');
const loginPath = path.join(publicDir, 'login.html');
const webIndexPath = path.join(publicDir, 'index.html');
const hasWebApp = fs.existsSync(webIndexPath);

app.get('/login', (_req, res) => {
  res.sendFile(loginPath);
});

app.get('/api/diagnostics/google-client-id', (_req, res) => {
  const clientId = getEnvValue('GOOGLE_CLIENT_ID') || '';
  const trimmed = clientId.trim();
  const suffix = trimmed ? trimmed.slice(-6) : '';
  res.json({
    configured: Boolean(trimmed),
    last6: suffix || null,
  });
});

app.get('/api/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

if (!hasWebApp) {
  app.get('/', (_req, res) => {
    res.sendFile(loginPath);
  });
}

app.use(express.static(publicDir));

import passport from 'passport';
import { initPassport, createToken, createOAuthState, decodeOAuthState, authenticate } from './auth';
import { assertSafeAuthSecretConfig } from './authConfig';
import { ensureCurrentUserTier, ensureDefaultGroupForUser, ensureWebPasswordAccountForOAuth, getUserRole, listPackingPresetsV2 } from './db';
import { ensureAdminBootstrap, getSeededTierForEmail, isFeatureEnabled } from './services/entitlementService';
import { requireAdmin } from './middleware/requireAdmin';
import {
  appendAuthCodeToRedirect,
  consumeRedirectTokenExchangeCode,
  createRedirectTokenExchangeCode,
  isRedirectUriAllowed,
  resolveAndValidateRedirectUri,
} from './redirects';
import { logError } from './logger';
import { assertNoPubliclyExposedServerSecrets } from './secrets';
import { canarySafeMode } from './middleware/canarySafeMode';

assertSafeAuthSecretConfig();
assertNoPubliclyExposedServerSecrets();

initPassport();
app.use(passport.initialize());
// Default res.locals.canarySafeMode = false here; `authenticate()` (auth.ts)
// re-derives the real value from the DB once req.user is resolved, since
// canary status isn't embedded in the JWT payload.
app.use(canarySafeMode);
const googleOAuthConfigured = Boolean(getEnvValue('GOOGLE_CLIENT_ID') && getEnvValue('GOOGLE_CLIENT_SECRET'));

const redirectToLoginWithError = (req: express.Request, res: express.Response, webUrl: string, code: string) => {
  const state = typeof req.query.state === 'string' ? decodeOAuthState(req.query.state) : null;
  let redirectUri = state?.redirectUri;
  if (redirectUri && !isRedirectUriAllowed(redirectUri, webUrl)) {
    redirectUri = undefined;
  }
  const fallback = new URL('/login', webUrl);
  const nextUrl = new URL(redirectUri ?? fallback.toString());
  nextUrl.searchParams.set('auth_error', code);
  res.redirect(nextUrl.toString());
};

app.get('/api/auth/google', (req, res, next) => {
  if (!googleOAuthConfigured) {
    res.status(503).json({ error: 'Google OAuth is not configured on the server.' });
    return;
  }
  const rawRedirectUri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : undefined;
  const { redirectUri, error } = resolveAndValidateRedirectUri(rawRedirectUri, webUrl);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  const state = redirectUri ? createOAuthState({ redirectUri }) : undefined;
  const handler = passport.authenticate('google', { scope: ['profile', 'email'], state });
  handler(req, res, next);
});

app.post('/api/auth/exchange', express.json(), (req, res) => {
  const code = String(req.body?.code ?? '').trim();
  if (!code) {
    res.status(400).json({ error: 'code is required' });
    return;
  }
  const exchanged = consumeRedirectTokenExchangeCode(code);
  if (!exchanged) {
    res.status(400).json({ error: 'Invalid or expired auth exchange code.' });
    return;
  }
  res.json(exchanged);
});

app.get(
  '/api/auth/google/callback',
  (_req, res, next) => {
    if (!googleOAuthConfigured) {
      res.status(503).json({ error: 'Google OAuth is not configured on the server.' });
      return;
    }
    next();
  },
  async (req, res, next) => {
    passport.authenticate('google', { session: false }, async (err: any, user: any, info: unknown) => {
      if (err) {
        logError('[auth] Google OAuth callback failed', {
          name: err?.name,
          message: err?.message,
          oauthError: err?.oauthError?.data,
          hasCode: typeof req.query.code === 'string',
          hasState: typeof req.query.state === 'string',
          info,
        });
        redirectToLoginWithError(req, res, webUrl, 'google_callback_failed');
        return;
      }
      if (!user) {
        logError('[auth] Google OAuth callback returned no user', {
          hasCode: typeof req.query.code === 'string',
          hasState: typeof req.query.state === 'string',
          info,
        });
        redirectToLoginWithError(req, res, webUrl, 'google_login_failed');
        return;
      }

      try {
        await ensureDefaultGroupForUser(user.id, user.email);
        await ensureCurrentUserTier(user.id, getSeededTierForEmail(user.email));
        const { requiresPasswordSetup } = await ensureWebPasswordAccountForOAuth(
          user.id,
          user.email,
          user.firstName,
          user.lastName
        );
        await ensureAdminBootstrap(user.id, user.email);
        const role = await getUserRole(user.id);
        const token = createToken({ userId: user.id, email: user.email, provider: user.provider, role });
        const state = typeof req.query.state === 'string' ? decodeOAuthState(req.query.state) : null;
        let redirectUri = state?.redirectUri;
        if (redirectUri && !isRedirectUriAllowed(redirectUri, webUrl)) {
          redirectUri = undefined;
        }
        const authCode = createRedirectTokenExchangeCode({
          token,
          requirePasswordSetup: requiresPasswordSetup,
        });
        if (redirectUri) {
          const next = new URL(appendAuthCodeToRedirect(redirectUri, authCode));
          res.redirect(next.toString());
          return;
        }
        res.redirect(`/login?auth_code=${encodeURIComponent(authCode)}`);
      } catch (callbackErr: any) {
        logError('[auth] Google OAuth post-login setup failed', {
          name: callbackErr?.name,
          message: callbackErr?.message,
          userId: user?.id,
          email: user?.email,
        });
        redirectToLoginWithError(req, res, webUrl, 'google_post_login_failed');
      }
    })(req, res, next);
  }
);

app.use('/api/auth', authRoutes);
// Alias web-auth routes under /api/auth to keep legacy tests and clients working.
app.use('/api/auth', webAuthRoutes);
app.use('/api/web-auth', webAuthRoutes);
app.use('/api/transfers', transferRoutes);
// Backward-compatible alias for older clients/tests still calling flights endpoints.
app.use('/api/flights', transferRoutes);
app.use('/api/groups', groupsRouter);
app.use('/api/trips', tripRoutes);
app.use('/api/trips', blogRoutes);
app.use('/api/itinerary', itineraryRoutes);
app.use('/api/itineraries', itineraryDataRoutes);
app.use('/api/traits', traitRoutes);
app.use('/api/lodgings', lodgingRoutes);
app.use('/api/places', placeRoutes);
app.use('/api/maps', staticMapRoutes);
app.use('/api/affiliate', getYourGuideRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/car-rentals', carRentalRoutes);
app.use('/api/account', accountRoutes);
app.get('/api/packing-list-presets', authenticate, async (_req, res) => {
  if (!(await isFeatureEnabled('packing_lists_v2'))) {
    res.status(404).json({ error: 'Packing lists v2 is not enabled' });
    return;
  }
  res.json({ presets: await listPackingPresetsV2() });
});
app.use('/api/expenses', expenseRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/internal/ingestion', internalIngestionWorkerRoutes);
app.use('/api/internal/billing', internalBillingRoutes);
app.use('/api/internal/deploy', internalDeployRoutes);
app.use('/api/ingestion/gmail', ingestionGmailOAuthRoutes);
app.use('/api/ingestion', ingestionRoutes);
app.use('/api/admin', authenticate, requireAdmin, adminRoutes);
app.use('/api/admin/billing', authenticate, requireAdmin, adminBillingRoutes);
app.use('/api/admin/ingestion', authenticate, requireAdmin, ingestionAdminRoutes);
// Prometheus scrape endpoint. Unauthenticated, text-only, per-instance.
// Mounted at the root (`/metrics`) since that's the conventional path most
// scrapers assume.
app.use('/metrics', prometheusRoutes);

if (hasWebApp) {
  app.get(['/app', '/app/*', '/'], (_req, res) => {
    res.sendFile(webIndexPath);
  });
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path === '/login') {
      res.status(404).end();
      return;
    }
    res.sendFile(webIndexPath);
  });
}

// Sentry's error handler must run after all controllers/routes but before any
// other error-handling middleware, so it sees unhandled errors first. It's a
// no-op when Sentry wasn't initialized (no SENTRY_DSN), and it does not send a
// response — the custom handler below still formats the client reply.
Sentry.setupExpressErrorHandler(app);

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = Number(err?.statusCode ?? err?.status ?? 500);
  const safeStatus = Number.isFinite(status) && status >= 400 && status <= 599 ? status : 500;
  logError('[api] request failed', {
    method: req.method,
    path: req.originalUrl,
    status: safeStatus,
    name: err?.name,
    message: err?.message,
    stack: err?.stack,
  });
  if (res.headersSent) {
    return;
  }
  res.status(safeStatus).json({
    error: safeStatus >= 500 ? 'Internal server error.' : String(err?.message ?? 'Request failed.'),
  });
});

app.use((req, res, _next) => {
  console.log(`Final handler: 404 for ${req.method} ${req.originalUrl}`);
  res.status(404).send('Not Found from final handler');
});

export default app;


