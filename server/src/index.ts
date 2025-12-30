import { Server } from 'http';
import { app, envLoadedFrom } from './app';
import { initDb, refreshAirportsDaily } from './db';

console.log('DATABASE_URL loaded:', process.env.DATABASE_URL, 'from', envLoadedFrom);

const defaultPort = Number(process.env.PORT) || 4000;

export const startServer = async (portOverride?: number): Promise<Server> => {
  await initDb();
  if (process.env.NODE_ENV !== 'test') {
    refreshAirportsDaily().catch((err: any) => console.error('Airport refresh failed', err));
  }
  const portToUse = portOverride ?? defaultPort;
  return app.listen(portToUse, () => console.log(`API server running on port ${portToUse}`));
};

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err: any) => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
}
