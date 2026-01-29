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
import { loadEnv } from './env_loader';
import { getEnvValue, isLocalEnv } from './env';

const envLoadedFrom = loadEnv();
export { envLoadedFrom };

export const app = express();

const isRunningLocally = isLocalEnv();
const webUrl = getEnvValue('WEB_URL', { defaultValue: 'https://duerk.org' });
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
