import { Server } from 'http';
import { app, envLoadedFrom } from './app';
import { initDb, refreshAirportsDaily } from './db';
import { getEnvFlag, getEnvValue } from './env';
import { logError, logInfo } from './logger';
import { doesApiLimitsConfigExist, getResolvedApiLimitsConfigPath } from './config/apiLimits';
import { doesAuthFlagsConfigExist, getResolvedAuthFlagsConfigPath } from './config/authFlags';
import { doesFeatureFlagsConfigExist, getResolvedFeatureFlagsConfigPath } from './config/featureFlags';
import { applyStartupFeatureFlagOverrides, seedEntitlementDefaults } from './services/entitlementService';
import { syncAttractionsCatalogFromCsvToDbOnStartup } from './services/attractionsCatalogService';
import { prewarmAutocompleteCache } from './services/destinationAttractionAutocompleteService';
import { logMissingApiPricingConfigurationWarnings } from './apis/providerBudgeting';
import { createSocketServer } from './socket';
import { startGmailPollingScheduler } from './services/gmailPollingService';

const defaultPort = Number(process.env.PORT) || 4000;
const isCloudRunRuntime = Boolean(process.env.K_SERVICE);

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
  logMissingApiPricingConfigurationWarnings();
  logInfo(`[startup] auth flags config path: ${authFlagsConfigPath} (exists: ${authFlagsConfigExists})`);
  logInfo(`[startup] feature flags config path: ${featureFlagsConfigPath} (exists: ${featureFlagsConfigExists})`);
  if (envLoadedFrom) {
    logInfo(`[startup] env loaded from: ${envLoadedFrom}`);
  }
  const portToUse = portOverride ?? defaultPort;
  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(portToUse, '0.0.0.0', () => {
      logInfo(`[startup] API server listening on port ${portToUse}`);
      resolve(listeningServer);
    });
    listeningServer.on('error', reject);
  });

  // Attach Socket.IO to the same HTTP server
  createSocketServer(server);

  try {
    await initDb();
    await seedEntitlementDefaults();
    await applyStartupFeatureFlagOverrides();
  } catch (err) {
    logError('[startup] initialization failed after binding port', err);
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 1000).unref();
    throw err;
  }

  const runAttractionsStartupSync = getEnvFlag('ATTRACTIONS_STARTUP_SYNC', { defaultValue: !isCloudRunRuntime });
  if (runAttractionsStartupSync) {
    syncAttractionsCatalogFromCsvToDbOnStartup().catch((err: any) =>
      logError('[attractions] startup CSV import failed (background)', err)
    );
  } else {
    logInfo('[attractions] startup CSV import disabled');
  }

  const runAutocompletePrewarm = getEnvFlag('AUTOCOMPLETE_PREWARM', { defaultValue: !isCloudRunRuntime });
  if (runAutocompletePrewarm) {
    // Pre-warm the destination/attraction autocomplete cache so the first
    // wizard search doesn't pay the CSV parsing cost (~154k rows).
    prewarmAutocompleteCache().catch((err: any) =>
      logError('[autocomplete] cache pre-warm failed (background)', err)
    );
  } else {
    logInfo('[autocomplete] cache pre-warm disabled');
  }

  if (process.env.NODE_ENV !== 'test') {
    refreshAirportsDaily().catch((err: any) => logError('Airport refresh failed', err));
  }

  startGmailPollingScheduler();

  return server;
};

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err: any) => {
    logError('Failed to initialize database', err);
    process.exit(1);
  });
}
