import { Server } from 'http';
import { app, envLoadedFrom } from './app';
import { initDb, refreshAirportsDaily } from './db';
import { logError } from './logger';

console.log('DATABASE_URL loaded:', process.env.DATABASE_URL, 'from', envLoadedFrom);

const defaultPort = Number(process.env.PORT) || 4000;

process.on('unhandledRejection', (reason) => {
  logError('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (err) => {
  logError('Uncaught exception', err);
  process.exit(1);
});

export const startServer = async (portOverride?: number): Promise<Server> => {
  await initDb();
  if (process.env.NODE_ENV !== 'test') {
    refreshAirportsDaily().catch((err: any) => logError('Airport refresh failed', err));
  }
  const portToUse = portOverride ?? defaultPort;
  return app.listen(portToUse, () => console.log(`API server running on port ${portToUse}`));
};

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err: any) => {
    logError('Failed to initialize database', err);
    process.exit(1);
  });
}
