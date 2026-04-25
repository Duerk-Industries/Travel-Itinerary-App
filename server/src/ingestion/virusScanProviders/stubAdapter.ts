import { getEnvValue } from '../../env';
import { isFeatureEnabled } from '../../services/entitlementService';
import { INGESTION_FEATURE_FLAGS, INGESTION_VIRUS_SCAN_PROVIDER_DEFAULT } from '../config';
import type { VirusScannerAdapter, VirusScanResult } from './types';

/**
 * No-op virus scanner. Keeps every historical behavior of the previous
 * `scanDocumentOrStub`:
 *   - In test/development: always SKIPPED.
 *   - In production with the stub feature-flag on: FAILED (defensive — the
 *     stub must not "pass" in prod).
 *   - In production without the flag: PASSED (trust the pre-existing
 *     out-of-band scanner, e.g. GCS Cloud Native).
 *
 * Keeping this adapter around lets deployments opt out of a real scanner
 * (e.g. during a provider outage) without changing code.
 */
const providerLabel = (): string => {
  const configured = (getEnvValue('INGESTION_VIRUS_SCAN_PROVIDER', {
    defaultValue: INGESTION_VIRUS_SCAN_PROVIDER_DEFAULT,
  }) || INGESTION_VIRUS_SCAN_PROVIDER_DEFAULT).trim().toLowerCase();
  return configured === 'clamav' ? 'clamav_sidecar' : 'cloud_native';
};

export const stubAdapter: VirusScannerAdapter = {
  name: 'stub',
  async scanBatch(): Promise<VirusScanResult> {
    const appEnv = (getEnvValue('APP_ENV', { defaultValue: process.env.NODE_ENV || 'development' }) || 'development').toLowerCase();
    const stubEnabled = await isFeatureEnabled(INGESTION_FEATURE_FLAGS.localVirusScanStub).catch(() => false);
    if (stubEnabled) {
      if (appEnv === 'production') {
        return {
          status: 'FAILED',
          scannedAt: new Date().toISOString(),
          provider: 'stub_blocked_in_production',
        };
      }
      return {
        status: 'SKIPPED',
        scannedAt: new Date().toISOString(),
        provider: 'stub',
      };
    }

    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      return {
        status: 'SKIPPED',
        scannedAt: new Date().toISOString(),
        provider: 'stub',
      };
    }

    return {
      status: 'PASSED',
      scannedAt: new Date().toISOString(),
      provider: providerLabel(),
    };
  },
};
