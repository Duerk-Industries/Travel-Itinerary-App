import { Server } from 'http';
import { app, envLoadedFrom } from './app';
import { initDb, refreshAirportsDaily } from './db';
import { getEnvFlag, getEnvValue } from './env';
import { logError, logInfo } from './logger';
import { doesApiLimitsConfigExist, getResolvedApiLimitsConfigPath } from './config/apiLimits';
import { doesAuthFlagsConfigExist, getResolvedAuthFlagsConfigPath } from './config/authFlags';
import { doesFeatureFlagsConfigExist, getResolvedFeatureFlagsConfigPath } from './config/featureFlags';
import { seedEntitlementDefaults } from './services/entitlementService';
import { syncAttractionsCatalogFromCsvToDbOnStartup } from './services/attractionsCatalogService';

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
  const authFlagsConfigPath = getResolvedAuthFlagsConfigPath();
  const authFlagsConfigExists = doesAuthFlagsConfigExist();
  const featureFlagsConfigPath = getResolvedFeatureFlagsConfigPath();
  const featureFlagsConfigExists = doesFeatureFlagsConfigExist();
  logInfo(`[startup] resolved storage bucket: ${resolvedStorageBucket || '(not set)'} (source: ${bucketSource})`);
  logInfo(`[startup] API limits config path: ${apiLimitsConfigPath} (exists: ${apiLimitsConfigExists})`);
  logInfo(`[startup] auth flags config path: ${authFlagsConfigPath} (exists: ${authFlagsConfigExists})`);
  logInfo(`[startup] feature flags config path: ${featureFlagsConfigPath} (exists: ${featureFlagsConfigExists})`);
  if (envLoadedFrom) {
    logInfo(`[startup] env loaded from: ${envLoadedFrom}`);
  }
  await initDb();
  await seedEntitlementDefaults();
  const portToUse = portOverride ?? defaultPort;
  const server = app.listen(portToUse, '0.0.0.0', () => console.log(`API server running on port ${portToUse}`));

  const runAttractionsStartupSync = getEnvFlag('ATTRACTIONS_STARTUP_SYNC', { defaultValue: true });
  if (runAttractionsStartupSync) {
    syncAttractionsCatalogFromCsvToDbOnStartup().catch((err: any) =>
      logError('[attractions] startup CSV import failed (background)', err)
    );
  } else {
    logInfo('[attractions] startup CSV import disabled via ATTRACTIONS_STARTUP_SYNC=0');
  }

  if (process.env.NODE_ENV !== 'test') {
    refreshAirportsDaily().catch((err: any) => logError('Airport refresh failed', err));
  }

  return server;
};

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err: any) => {
    logError('Failed to initialize database', err);
    process.exit(1);
  });
}
