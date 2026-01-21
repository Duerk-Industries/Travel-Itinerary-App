console.log('Backend starting... Travel Itinerary App v1.0.0');
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import flightRoutes from './routes/flightRoutes';
import webAuthRoutes from './routes/webAuthRoutes';
import tripRoutes from './routes/tripRoutes';
import itineraryRoutes from './routes/itineraryRoutes';
import itineraryDataRoutes from './routes/itineraryDataRoutes';
import traitRoutes from './routes/traitRoutes';
import lodgingRoutes from './routes/lodgingRoutes';
import tourRoutes from './routes/tourRoutes';
import accountRoutes, { groupsRouter } from './routes/accountRoutes';
import { hasRunLocalFlag } from './env';

// Load env vars from server/.env and server/.secrets (plus repo root fallbacks).
// .local_env files load only when RUN_LOCAL=1 is set inside that file.
// Later files override earlier ones to make local overrides and secrets take precedence.
const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.secrets'),
  path.resolve(__dirname, '../../.secrets'),
];
const localEnvPaths = [
  path.resolve(__dirname, '../.local_env'),
  path.resolve(__dirname, '../../.local_env'),
];
const loadedEnvPaths: string[] = [];
const shouldOverride = !process.env.JEST_WORKER_ID;
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
app.use(cors({
  origin: 'https://duerk.org',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

if (!hasWebApp) {
  app.get('/', (_req, res) => {
    res.sendFile(loginPath);
  });
}

app.use(express.static(publicDir));

app.use('/api/auth', authRoutes);
// Alias web-auth routes under /api/auth to keep legacy tests and clients working.
app.use('/api/auth', webAuthRoutes);
app.use('/api/web-auth', webAuthRoutes);
app.use('/api/flights', flightRoutes);
app.use('/api/groups', groupsRouter);
app.use('/api/trips', tripRoutes);
app.use('/api/itinerary', itineraryRoutes);
app.use('/api/itineraries', itineraryDataRoutes);
app.use('/api/traits', traitRoutes);
app.use('/api/lodgings', lodgingRoutes);
app.use('/api/tours', tourRoutes);
app.use('/api/account', accountRoutes);

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

app.use((req, res, _next) => {
  console.log(`Final handler: 404 for ${req.method} ${req.originalUrl}`);
  res.status(404).send('Not Found from final handler');
});

export default app;
