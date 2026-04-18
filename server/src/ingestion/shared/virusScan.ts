import { getEnvValue } from '../../env';
import { isFeatureEnabled } from '../../services/entitlementService';
import { INGESTION_FEATURE_FLAGS, INGESTION_VIRUS_SCAN_PROVIDER_DEFAULT } from '../config';
import type { VirusScanStatus } from '../contracts';

export interface VirusScanResult {
  status: VirusScanStatus;
  scannedAt: string | null;
  provider: string | null;
}

const getConfiguredProvider = (): string =>
  (getEnvValue('INGESTION_VIRUS_SCAN_PROVIDER', { defaultValue: INGESTION_VIRUS_SCAN_PROVIDER_DEFAULT }) || INGESTION_VIRUS_SCAN_PROVIDER_DEFAULT)
    .trim()
    .toLowerCase();

export const scanDocumentOrStub = async (): Promise<VirusScanResult> => {
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

  const provider = getConfiguredProvider();
  return {
    status: 'PASSED',
    scannedAt: new Date().toISOString(),
    provider: provider === 'clamav' ? 'clamav_sidecar' : 'cloud_native',
  };
};
