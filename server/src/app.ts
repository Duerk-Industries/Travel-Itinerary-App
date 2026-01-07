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

// Load env vars from server/.env if present, otherwise fall back to repo root .env or existing process env
const envPaths = [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../.env')];
let envLoadedFrom: string | null = null;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    envLoadedFrom = envPath;
    break;
  }
}
if (!envLoadedFrom) {
  dotenv.config(); // default search (process cwd)
  envLoadedFrom = 'process.env/default';
}

export { envLoadedFrom };

export const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const logDir = path.resolve(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const accessLogPath = path.join(logDir, 'api-access.log');
const accessLogStream = fs.createWriteStream(accessLogPath, { flags: 'a' });

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const line = `[api] ${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms\n`;
    accessLogStream.write(line);
  });
  next();
});

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.use('/api/auth', authRoutes);
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

export default app;
