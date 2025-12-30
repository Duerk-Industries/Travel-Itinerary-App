import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import flightRoutes from './routes/flightRoutes';
import webAuthRoutes from './routes/webAuthRoutes';
import groupRoutes from './routes/groupRoutes';
import tripRoutes from './routes/tripRoutes';
import itineraryRoutes from './routes/itineraryRoutes';
import itineraryDataRoutes from './routes/itineraryDataRoutes';
import traitRoutes from './routes/traitRoutes';
import lodgingRoutes from './routes/lodgingRoutes';
import tourRoutes from './routes/tourRoutes';
import accountRoutes from './routes/accountRoutes';

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

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/web-auth', webAuthRoutes);
app.use('/api/flights', flightRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/itinerary', itineraryRoutes);
app.use('/api/itineraries', itineraryDataRoutes);
app.use('/api/traits', traitRoutes);
app.use('/api/lodgings', lodgingRoutes);
app.use('/api/tours', tourRoutes);
app.use('/api/account', accountRoutes);

export default app;
