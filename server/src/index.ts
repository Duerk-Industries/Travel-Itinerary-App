import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

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

// Import db AFTER dotenv has run
const { initDb, refreshAirportsDaily } = require('./db');

console.log('DATABASE_URL loaded:', process.env.DATABASE_URL); // should print the URL

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
