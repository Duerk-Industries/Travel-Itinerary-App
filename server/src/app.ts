console.log('Backend starting... WanderBunnies v1.0.0');
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
import internalBlogWorkerRoutes from './routes/internalBlogWorkerRoutes';
import prometheusRoutes from './routes/prometheusRoutes';
import staticMapRoutes from './routes/staticMapRoutes';
import getYourGuideRoutes from './routes/getYourGuideRoutes';
import blogRoutes from './routes/blogRoutes';
import blogAuthoringRoutes from './routes/blogAuthoringRoutes';
import blogEngagementRoutes from './routes/blogEngagementRoutes';
import blogStorageRoutes from './routes/blogStorageRoutes';
import plaidIntegrationRoutes from './routes/plaidIntegrationRoutes';
import blogImportRoutes from './routes/blogImportRoutes';
import blogPublicationRoutes from './routes/blogPublicationRoutes';
import publicBlogRoutes from './routes/publicBlogRoutes';
import blogIndexingRoutes from './routes/blogIndexingRoutes';
import blogSitemapRoutes from './routes/blogSitemapRoutes';
import blogSocialRoutes from './routes/blogSocialRoutes';
import blogModalityRoutes from './routes/blogModalityRoutes';
import blogInsightRoutes from './routes/blogInsightRoutes';
import notificationRoutes from './routes/notificationRoutes';
import { privacyPolicyHtml } from './legal/privacyPolicyHtml';
import dataTransferRoutes from './routes/dataTransferRoutes';

import { loadEnv } from './env_loader';
import { getBackendUrl, getEnvValue, hasRunLocalFlag, isLocalEnv } from './env';
import { startNotificationOutboxWorker } from './services/notificationOutboxWorker';
import { runBlogBackgroundJobs } from './services/blogBackgroundWorker';
import { logError } from './logger';

// Load env vars from server/.env as the primary local source, with server/.secrets
// still supported as a backwards-compatible fallback (plus repo root fallbacks).
// .local_env files load only when RUN_LOCAL=1 is set inside that file.
const localEnvPaths = [
  path.resolve(__dirname, '../.local_env'),
  path.resolve(__dirname, '../../.local_env'),
];
for (const envPath of localEnvPaths) {
  if (hasRunLocalFlag(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}
const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.secrets'),
  path.resolve(__dirname, '../../.secrets'),
];
const loadedEnvPaths: string[] = [];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
    loadedEnvPaths.push(envPath);
  }
}
let envLoadedFrom: string | null = loadedEnvPaths.length === 0 ? 'process.env/default' : loadedEnvPaths.join(', ');

export { envLoadedFrom };

const app = express();

// Phase 4.5 / 6b: Background workers
if (process.env.NODE_ENV !== 'test') {
  startNotificationOutboxWorker();
  setInterval(() => {
    runBlogBackgroundJobs().catch(err => logError('[blog-worker] Background loop error', err));
  }, 3600 * 1000); // run hourly
}

app.set('trust proxy', 1);

app.use('/api/ingestion/webhooks', ingestionWebhookRoutes);
app.use('/api/billing/webhooks', express.raw({ type: 'application/json' }), stripeWebhookRoutes);

const isRunningLocally = isLocalEnv();
const webUrl = getBackendUrl('https://wander-bunnies.com') || 'https://wander-bunnies.com';

const getAllowedOrigins = () => {
  const origins = new Set<string | RegExp>();
  if (isRunningLocally) {
    origins.add(/^http:\/\/localhost(:\d+)?$/);
    origins.add(/^http:\/\/127\.0\.0\.1(:\d+)?$/);
  }
  origins.add(webUrl);
  origins.add('https://wander-bunnies.com');
  const allowlist = getEnvValue('AUTH_REDIRECT_URI_ALLOWLIST') || '';
  allowlist.split(/[;,]/).forEach(origin => {
    const trimmed = origin.trim();
    if (trimmed.startsWith('http')) {
      try {
        origins.add(new URL(trimmed).origin);
      } catch {}
    }
  });
  return Array.from(origins);
};

const allowedOrigins = getAllowedOrigins();

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    for (const allowedOrigin of allowedOrigins) {
      if (typeof allowedOrigin === 'string') {
        if (allowedOrigin === origin) return callback(null, true);
      } else if (allowedOrigin && allowedOrigin.test(origin)) {
        return callback(null, true);
      }
    }
    return callback(new Error(`The CORS policy for this site does not allow access from the specified Origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'X-Analytics-Consent'],
  exposedHeaders: ['X-Request-Id'],
};

app.use((req, res, next) => {
  if (req.path === '/api/auth/apple/callback' && req.header('Origin') === 'https://appleid.apple.com') {
    next();
    return;
  }
  cors(corsOptions)(req, res, next);
});
app.use('/api', dataTransferRoutes);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

import { generateRequestId, runWithRequestContext } from './requestContext';
const REQUEST_ID_HEADER = 'x-request-id';
const isStructuredOutput = process.env.LOG_FORMAT === 'json' || (process.env.LOG_FORMAT !== 'text' && (process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE)));

app.use((req, res, next) => {
  const inbound = req.header(REQUEST_ID_HEADER);
  const requestId = inbound && inbound.trim().length > 0 ? inbound.trim() : generateRequestId();
  res.setHeader('X-Request-Id', requestId);
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const timestamp = new Date().toISOString();
    const line = isStructuredOutput
      ? JSON.stringify({ level: 'info', time: timestamp, channel: 'api', requestId, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: ms })
      : `[api] ${timestamp} [req=${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`;
    console.info(line);
  });
  runWithRequestContext({ requestId, method: req.method, path: req.originalUrl }, () => next());
});

const publicDir = path.join(__dirname, '..', 'public');
const loginPath = path.join(publicDir, 'login.html');
const webIndexPath = path.join(publicDir, 'index.html');
const hasWebApp = fs.existsSync(webIndexPath);

app.get('/login', (_req, res) => res.sendFile(loginPath));
app.get('/privacy', (_req, res) => res.type('html').send(privacyPolicyHtml));
app.get('/api/diagnostics/google-client-id', (_req, res) => {
  const clientId = getEnvValue('GOOGLE_CLIENT_ID') || '';
  res.json({ configured: Boolean(clientId), last6: clientId.trim().slice(-6) || null });
});
app.get('/api/healthz', (_req, res) => res.status(200).json({ ok: true, sha: getEnvValue('GIT_SHA') ?? null, revision: getEnvValue('K_REVISION') ?? null }));

if (!hasWebApp) {
  app.get('/', (_req, res) => res.sendFile(loginPath));
}

app.use(express.static(publicDir));

import passport from 'passport';
import { initPassport, createToken, createOAuthState, createOAuthNonce, decodeOAuthState, authenticate } from './auth';
import { assertSafeAuthSecretConfig } from './authConfig';
import { ensureCurrentUserTier, ensureDefaultGroupForUser, ensureWebPasswordAccountForOAuth, findOrCreateAppleUser, getUserRole } from './db';
import { ensureAdminBootstrap, getSeededTierForEmail } from './services/entitlementService';
import { getAuthFlag } from './config/authFlags';
import { isAppleOAuthConfigured, exchangeAppleAuthorizationCode, verifyAppleIdToken, parseAppleUserPayload } from './appleAuth';
import { requireAdmin } from './middleware/requireAdmin';
import { appendAuthCodeToRedirect, consumeRedirectTokenExchangeCode, createRedirectTokenExchangeCode, isRedirectUriAllowed, resolveAndValidateRedirectUri } from './redirects';
import { assertNoPubliclyExposedServerSecrets } from './secrets';
import { canarySafeMode } from './middleware/canarySafeMode';

assertSafeAuthSecretConfig();
assertNoPubliclyExposedServerSecrets();
initPassport();
app.use(passport.initialize());
app.use(canarySafeMode);

const googleOAuthConfigured = Boolean(getEnvValue('GOOGLE_CLIENT_ID') && getEnvValue('GOOGLE_CLIENT_SECRET'));

app.get('/api/auth/google', (req, res, next) => {
  if (!googleOAuthConfigured) return res.status(503).json({ error: 'Google OAuth not configured' });
  const rawRedirectUri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : undefined;
  const { redirectUri, error } = resolveAndValidateRedirectUri(rawRedirectUri, webUrl);
  if (error) return res.status(400).json({ error });
  const state = redirectUri ? createOAuthState({ redirectUri }) : undefined;
  passport.authenticate('google', { scope: ['profile', 'email'], state })(req, res, next);
});

app.post('/api/auth/exchange', (req, res) => {
  const code = String(req.body?.code ?? '').trim();
  if (!code) return res.status(400).json({ error: 'code is required' });
  const exchanged = consumeRedirectTokenExchangeCode(code);
  if (!exchanged) return res.status(400).json({ error: 'Invalid exchange code' });
  res.json(exchanged);
});

app.get('/api/auth/google/callback', async (req, res, next) => {
  passport.authenticate('google', { session: false }, async (err: any, user: any) => {
    if (err || !user) return res.redirect('/login?auth_error=google_failed');
    try {
      await ensureDefaultGroupForUser(user.id, user.email);
      await ensureCurrentUserTier(user.id, getSeededTierForEmail(user.email));
      const { requiresPasswordSetup } = await ensureWebPasswordAccountForOAuth(user.id, user.email, user.firstName, user.lastName);
      await ensureAdminBootstrap(user.id, user.email);
      const role = await getUserRole(user.id);
      const token = createToken({ userId: user.id, email: user.email, provider: user.provider, role });
      const authCode = createRedirectTokenExchangeCode({ token, requirePasswordSetup: requiresPasswordSetup });
      res.redirect(`/login?auth_code=${encodeURIComponent(authCode)}`);
    } catch (e) {
      res.redirect('/login?auth_error=post_login_failed');
    }
  })(req, res, next);
});

// Restored after the "more fixes" rewrite silently dropped this entire block (app/auth-audit
// pass) — Apple Sign-In has no other mount point, so its absence 404'd every request rather than
// erroring loudly, which is exactly why appleOAuthRoutes.test.ts existed to catch it.
const redirectToLoginWithError = (req: express.Request, res: express.Response, webUrl: string, code: string) => {
  const rawState =
    typeof req.query.state === 'string'
      ? req.query.state
      : typeof req.body?.state === 'string'
        ? req.body.state
        : undefined;
  const state = rawState ? decodeOAuthState(rawState) : null;
  let redirectUri = state?.redirectUri;
  if (redirectUri && !isRedirectUriAllowed(redirectUri, webUrl)) {
    redirectUri = undefined;
  }
  const fallback = new URL('/login', webUrl);
  const nextUrl = new URL(redirectUri ?? fallback.toString());
  nextUrl.searchParams.set('auth_error', code);
  res.redirect(nextUrl.toString());
};

const appleOAuthConfigured = () => isAppleOAuthConfigured() && getAuthFlag('appleOAuthEnabled');
const APPLE_OAUTH_NONCE_COOKIE = 'apple_oauth_nonce';

const getRequestCookie = (req: express.Request, name: string): string | undefined => {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const prefix = `${name}=`;
  const value = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!value) return undefined;
  try {
    return decodeURIComponent(value.slice(prefix.length));
  } catch {
    return undefined;
  }
};

const setAppleOAuthNonceCookie = (res: express.Response, nonce: string): void => {
  res.cookie(APPLE_OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: isLocalEnv() ? 'lax' : 'none',
    secure: !isLocalEnv(),
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
};

const clearAppleOAuthNonceCookie = (res: express.Response): void => {
  res.clearCookie(APPLE_OAUTH_NONCE_COOKIE, { path: '/' });
};

app.get('/api/auth/apple', (req, res) => {
  if (!appleOAuthConfigured()) {
    res.status(503).json({ error: 'Apple OAuth is not configured on the server.' });
    return;
  }
  const rawRedirectUri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : undefined;
  const { redirectUri, error } = resolveAndValidateRedirectUri(rawRedirectUri, webUrl);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  const nonce = createOAuthNonce();
  const state = createOAuthState({ redirectUri, nonce });
  setAppleOAuthNonceCookie(res, nonce);
  const authorizeUrl = new URL('https://appleid.apple.com/auth/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('response_mode', 'form_post');
  authorizeUrl.searchParams.set('client_id', getEnvValue('APPLE_CLIENT_ID') || '');
  authorizeUrl.searchParams.set('redirect_uri', getEnvValue('APPLE_CALLBACK_URL') || '');
  authorizeUrl.searchParams.set('scope', 'name email');
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('state', state);
  res.redirect(authorizeUrl.toString());
});

// Apple uses response_mode=form_post, so the callback arrives as a POST with a
// form-encoded body (code, state, and — first authorization only — user).
app.post('/api/auth/apple/callback', async (req, res) => {
  if (!appleOAuthConfigured()) {
    res.status(503).json({ error: 'Apple OAuth is not configured on the server.' });
    return;
  }
  const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
  const stateRaw = typeof req.body?.state === 'string' ? req.body.state : undefined;
  const state = stateRaw ? decodeOAuthState(stateRaw) : null;
  const cookieNonce = getRequestCookie(req, APPLE_OAUTH_NONCE_COOKIE);
  if (!stateRaw || !state || !cookieNonce || cookieNonce !== state.nonce) {
    logError('[auth] Apple OAuth callback missing or invalid state');
    clearAppleOAuthNonceCookie(res);
    redirectToLoginWithError(req, res, webUrl, 'apple_callback_failed');
    return;
  }
  let redirectUri = state?.redirectUri;
  if (redirectUri && !isRedirectUriAllowed(redirectUri, webUrl)) {
    redirectUri = undefined;
  }

  if (req.body?.error) {
    logError('[auth] Apple OAuth callback returned an error', { error: req.body.error });
    clearAppleOAuthNonceCookie(res);
    redirectToLoginWithError(req, res, webUrl, 'apple_callback_failed');
    return;
  }
  if (!code) {
    logError('[auth] Apple OAuth callback missing code');
    clearAppleOAuthNonceCookie(res);
    redirectToLoginWithError(req, res, webUrl, 'apple_callback_failed');
    return;
  }

  try {
    const { idToken } = await exchangeAppleAuthorizationCode(code);
    const claims = await verifyAppleIdToken(idToken, state.nonce);
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    const { firstName, lastName } = parseAppleUserPayload(
      typeof req.body?.user === 'string' ? req.body.user : undefined
    );
    const user = await findOrCreateAppleUser({
      appleId: claims.sub,
      email: claims.email,
      emailVerified,
      firstName,
      lastName,
    });

    await ensureDefaultGroupForUser(user.id, user.email);
    await ensureCurrentUserTier(user.id, getSeededTierForEmail(user.email));
    // ensureWebPasswordAccountForOAuth still backs this account with a (randomly-seeded,
    // never-shown) web_users row for a possible future email/password fallback login — that part
    // is unchanged. What must never happen for Apple is *forcing* the "Set Your Password" prompt
    // on the client: Sign in with Apple already completes authentication via the Authentication
    // Services framework, and Apple's HIG explicitly forbids requiring any additional
    // account-creation step (password included) afterward — App Store Guideline 4 rejected this
    // exact flow. Unlike the Google callback below, this always reports false regardless of what
    // ensureWebPasswordAccountForOAuth returns.
    await ensureWebPasswordAccountForOAuth(
      user.id,
      user.email,
      user.firstName,
      user.lastName
    );
    await ensureAdminBootstrap(user.id, user.email);
    const role = await getUserRole(user.id);
    const token = createToken({ userId: user.id, email: user.email, provider: user.provider, role });
    const authCode = createRedirectTokenExchangeCode({ token, requirePasswordSetup: false });
    clearAppleOAuthNonceCookie(res);
    if (redirectUri) {
      const next = new URL(appendAuthCodeToRedirect(redirectUri, authCode));
      res.redirect(next.toString());
      return;
    }
    res.redirect(`/login?auth_code=${encodeURIComponent(authCode)}`);
  } catch (callbackErr: any) {
    clearAppleOAuthNonceCookie(res);
    logError('[auth] Apple OAuth post-login setup failed', {
      name: callbackErr?.name,
      message: callbackErr?.message,
    });
    redirectToLoginWithError(req, res, webUrl, 'apple_post_login_failed');
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/auth', webAuthRoutes);
app.use('/api/web-auth', webAuthRoutes);
app.use('/api/transfers', transferRoutes);
// Backward-compatible alias for older clients/tests still calling flights endpoints — do not remove.
app.use('/api/flights', transferRoutes);
app.use('/api/groups', groupsRouter);
app.use('/api/trips', tripRoutes);
app.use('/api/trips', blogRoutes);
app.use('/api/trips', blogAuthoringRoutes);
app.use('/api/trips', blogEngagementRoutes);
app.use('/api/trips', blogImportRoutes);
app.use('/api/trips', blogPublicationRoutes);
app.use('/api/trips', blogIndexingRoutes);
app.use('/api/trips', blogSocialRoutes);
app.use('/api/trips', blogModalityRoutes);
app.use('/api/trips', blogInsightRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/public/blog', publicBlogRoutes);
app.use('/', blogSitemapRoutes);
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
app.use('/api/account', blogStorageRoutes);
app.use('/api/plaid', plaidIntegrationRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/internal/ingestion', internalIngestionWorkerRoutes);
app.use('/api/internal/billing', internalBillingRoutes);
app.use('/api/internal/deploy', internalDeployRoutes);
app.use('/api/internal/blog', internalBlogWorkerRoutes);
app.use('/api/ingestion/gmail', ingestionGmailOAuthRoutes);
app.use('/api/ingestion', ingestionRoutes);
app.use('/api/admin', authenticate, requireAdmin, adminRoutes);
app.use('/api/admin/billing', authenticate, requireAdmin, adminBillingRoutes);
app.use('/api/admin/ingestion', authenticate, requireAdmin, ingestionAdminRoutes);
app.use('/metrics', prometheusRoutes);

if (hasWebApp) {
  app.get(['/app', '/app/*', '/'], (_req, res) => res.sendFile(webIndexPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path === '/login') return res.status(404).end();
    res.sendFile(webIndexPath);
  });
}

Sentry.setupExpressErrorHandler(app);

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status || 500;
  res.status(status).json({ error: status >= 500 ? 'Internal server error.' : err.message });
});

export { app };
