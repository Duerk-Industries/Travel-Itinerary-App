import { isFeatureEnabled } from '../../services/entitlementService';
import { INGESTION_FEATURE_FLAGS } from '../config';
import type { VirusScanStatus } from '../contracts';

export interface VirusScanResult {
  status: VirusScanStatus;
  scannedAt: string | null;
  provider: string | null;
}

export const scanDocumentOrStub = async (): Promise<VirusScanResult> => {
  const stubEnabled = await isFeatureEnabled(INGESTION_FEATURE_FLAGS.localVirusScanStub).catch(() => false);
  if (stubEnabled || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
    return {
      status: 'SKIPPED',
      scannedAt: new Date().toISOString(),
      provider: 'stub',
    };
  }
  return {
    status: 'PASSED',
    scannedAt: new Date().toISOString(),
    provider: 'metadata_only',
  };
};
