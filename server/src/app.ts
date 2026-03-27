console.log('Backend starting... Travel Itinerary App v1.0.0');
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
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
import adminRoutes from './routes/adminRoutes';
import ingestionRoutes from './routes/ingestionRoutes';
import ingestionAdminRoutes from './routes/ingestionAdminRoutes';
import ingestionWebhookRoutes from './routes/ingestionWebhookRoutes';
import ingestionGmailOAuthRoutes from './routes/ingestionGmailOAuthRoutes';
import internalIngestionWorkerRoutes from './routes/internalIngestionWorkerRoutes';

import { loadEnv } from './env_loader';
import { getEnvValue, hasRunLocalFlag, isLocalEnv } from './env';

// Load env vars from server/.env as the primary local source, with server/.secrets
// still supported as a backwards-compatible fallback (plus repo root fallbacks).
// .local_env files load only when RUN_LOCAL=1 is set inside that file.
// Later files override earlier ones to make local overrides and secrets take precedence.
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
const shouldOverride = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: shouldOverride });
    loadedEnvPaths.push(envPath);
  }
}
for (const envPath of localEnvPaths) {
  if (hasRunLocalFlag(envPath)) {
    dotenv.config({ path: envPath, override: shouldOverride });
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

const isRunningLocally = isLocalEnv();
const webUrl = getEnvValue('WEB_URL', { defaultValue: 'https://duerk.org' }) || 'https://duerk.org';
const allowedOrigins = isRunningLocally
  ? [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/]
  : [webUrl];

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
  allowedHeaders: ['Content-Type', 'Authorization'],
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

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const line = `[api] ${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms\n`;
    if (accessLogStream) {
      accessLogStream.write(line);
    } else {
      console.info(line.trim());
    }
  });
  next();
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

if (!hasWebApp) {
  app.get('/', (_req, res) => {
    res.sendFile(loginPath);
  });
}

app.use(express.static(publicDir));

import passport from 'passport';
import { initPassport, createToken, createOAuthState, decodeOAuthState, authenticate } from './auth';
import { ensureCurrentUserTier, ensureDefaultGroupForUser, ensureWebPasswordAccountForOAuth, getUserRole } from './db';
import { ensureAdminBootstrap, getSeededTierForEmail } from './services/entitlementService';
import { requireAdmin } from './middleware/requireAdmin';
import { appendTokenToRedirect, isRedirectUriAllowed, resolveAndValidateRedirectUri } from './redirects';
import { logError } from './logger';

initPassport();
app.use(passport.initialize());
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

if (!isLocalEnv() && getEnvValue('AUTH_SECRET') === 'development-secret') {
    logError('[WARNING] AUTH_SECRET is not set or is using the default value in a non-local environment. This is a security risk and will cause authentication to fail.');
}

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
        if (redirectUri) {
          const next = new URL(appendTokenToRedirect(redirectUri, token));
          if (requiresPasswordSetup) {
            next.searchParams.set('require_password_setup', '1');
          }
          res.redirect(next.toString());
          return;
        }
        const suffix = requiresPasswordSetup ? `&require_password_setup=1` : '';
        res.redirect(`/login?token=${encodeURIComponent(token)}${suffix}`);
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
app.use('/api/itinerary', itineraryRoutes);
app.use('/api/itineraries', itineraryDataRoutes);
app.use('/api/traits', traitRoutes);
app.use('/api/lodgings', lodgingRoutes);
app.use('/api/places', placeRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/car-rentals', carRentalRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/internal/ingestion', internalIngestionWorkerRoutes);
app.use('/api/ingestion/webhooks', ingestionWebhookRoutes);
app.use('/api/ingestion/gmail', ingestionGmailOAuthRoutes);
app.use('/api/ingestion', ingestionRoutes);
app.use('/api/admin', authenticate, requireAdmin, adminRoutes);
app.use('/api/admin/ingestion', authenticate, requireAdmin, ingestionAdminRoutes);

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


