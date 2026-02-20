import { Server } from 'http';
import { app, envLoadedFrom } from './app';
import { initDb, refreshAirportsDaily } from './db';
import { getEnvValue } from './env';
import { logError, logInfo } from './logger';
import { doesApiLimitsConfigExist, getResolvedApiLimitsConfigPath } from './config/apiLimits';

const defaultPort = Number(process.env.PORT) || 4000;

const normalizeBucketName = (value?: string): string | undefined => {
  if (!value) return undefined;
  let normalized = value.trim();
  if (!normalized) return undefined;
  normalized = normalized.replace(/^gs:\/\//i, '');
  normalized = normalized.replace(/^https?:\/\/storage.googleapis.com\//i, '');
  normalized = normalized.split('?')[0].split('#')[0];
  normalized = normalized.replace(/\/+$/, '');
  if (normalized.includes('/')) {
    normalized = normalized.split('/')[0];
  }
  return normalized || undefined;
};

process.on('unhandledRejection', (reason) => {
  logError('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (err) => {
  logError('Uncaught exception', err);
  process.exit(1);
});

export const startServer = async (portOverride?: number): Promise<Server> => {
  const explicitBucket = normalizeBucketName(getEnvValue('LOCATION_BUCKET') || getEnvValue('FIREBASE_STORAGE_BUCKET'));
  const projectId = getEnvValue('GCLOUD_PROJECT_ID') || getEnvValue('GOOGLE_CLOUD_PROJECT');
  const resolvedStorageBucket = explicitBucket || (projectId ? `${projectId}.appspot.com` : undefined);
  const bucketSource = explicitBucket ? 'LOCATION_BUCKET/FIREBASE_STORAGE_BUCKET' : 'GCLOUD_PROJECT_ID/GOOGLE_CLOUD_PROJECT fallback';
  const apiLimitsConfigPath = getResolvedApiLimitsConfigPath();
  const apiLimitsConfigExists = doesApiLimitsConfigExist();
  logInfo(`[startup] resolved storage bucket: ${resolvedStorageBucket || '(not set)'} (source: ${bucketSource})`);
  logInfo(`[startup] API limits config path: ${apiLimitsConfigPath} (exists: ${apiLimitsConfigExists})`);
  if (envLoadedFrom) {
    logInfo(`[startup] env loaded from: ${envLoadedFrom}`);
  }
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
