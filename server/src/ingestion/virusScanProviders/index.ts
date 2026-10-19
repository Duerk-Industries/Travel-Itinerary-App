import { getEnvValue } from '../../env';
import { stubAdapter } from './stubAdapter';
import { clamavHttpAdapter } from './clamavHttpAdapter';
import type { VirusScannerAdapter } from './types';

/**
 * Resolve the configured virus-scan adapter by env. Defaults to the stub to
 * preserve manual-upload behavior. Unknown values fail closed; mailbox
 * admission additionally requires the real authenticated scanner.
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
      throw new Error('Unknown ingestion virus scanner provider');
  }
};

export { stubAdapter, clamavHttpAdapter };
export type { VirusScannerAdapter };
