import type { VirusScanStatus } from '../contracts';
import { getVirusScanner } from '../virusScanProviders';

export interface VirusScanResult {
  status: VirusScanStatus;
  scannedAt: string | null;
  provider: string | null;
}

/**
 * Legacy entry point — delegates to the configured virus-scan adapter. New
 * callers should pull the adapter from `ingestion/virusScanProviders` so
 * they can invoke `scanBuffer` when bytes are available.
 */
export const scanDocumentOrStub = async (): Promise<VirusScanResult> => {
  return getVirusScanner().scanBatch();
};
