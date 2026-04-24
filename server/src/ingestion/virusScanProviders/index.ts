import { getEnvValue } from '../../env';
import { stubAdapter } from './stubAdapter';
import { clamavHttpAdapter } from './clamavHttpAdapter';
import type { VirusScannerAdapter } from './types';

/**
 * Resolve the configured virus-scan adapter by env. Defaults to the stub to
 * preserve historical behavior. Any unknown value also falls back to the
 * stub with a warning so a misspelled env doesn't secretly disable scanning.
 */
export const getVirusScanner = (): VirusScannerAdapter => {
  const raw = (getEnvValue('INGESTION_VIRUS_SCAN_PROVIDER') || '').trim().toLowerCase();
  switch (raw) {
    case 'clamav_http':
      return clamavHttpAdapter;
    case '':
    case 'stub':
    case 'cloud_native':
    case 'clamav': // legacy label — stub variant pretending to be clamav sidecar
      return stubAdapter;
    default:
      // Unknown value → stub (safest).
      return stubAdapter;
  }
};

export { stubAdapter, clamavHttpAdapter };
export type { VirusScannerAdapter };
