import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load env vars from server/.env if present, otherwise fall back to repo root .env or existing process env
const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
];
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

const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes').default;
const flightRoutes = require('./routes/flightRoutes').default;
const webAuthRoutes = require('./routes/webAuthRoutes').default;
const groupRoutes = require('./routes/groupRoutes').default;
const tripRoutes = require('./routes/tripRoutes').default;
const itineraryRoutes = require('./routes/itineraryRoutes').default;
const itineraryDataRoutes = require('./routes/itineraryDataRoutes').default;
const traitRoutes = require('./routes/traitRoutes').default;
const lodgingRoutes = require('./routes/lodgingRoutes').default;
const tourRoutes = require('./routes/tourRoutes').default;

// Import db AFTER dotenv has run
const { initDb, refreshAirportsDaily } = require('./db');

console.log('DATABASE_URL loaded:', process.env.DATABASE_URL, 'from', envLoadedFrom); // should print the URL

const app = express();
app.use(cors());
app.use(express.json());

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

app.get('/', (_req: any, res: any) => {
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

const port = Number(process.env.PORT) || 4000;

initDb()
  .then(() => {
    refreshAirportsDaily().catch((err: any) => console.error('Airport refresh failed', err));
    app.listen(port, () => console.log(`API server running on port ${port}`));
  })
  .catch((err: any) => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
