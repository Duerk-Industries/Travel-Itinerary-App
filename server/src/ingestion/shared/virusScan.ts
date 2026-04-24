import type { VirusScanStatus } from '../contracts';
import { incrementMetric } from '../../metrics';
import { getVirusScanner } from '../virusScanProviders';

export interface VirusScanResult {
  status: VirusScanStatus;
  scannedAt: string | null;
  provider: string | null;
}

/**
 * Record a `virus_scan_total` counter for every scan outcome so Prometheus
 * scrapes and the AdminTab counter card can see the PASSED / FAILED /
 * SKIPPED distribution per method. Labels: `method` (batch | buffer) plus
 * the scan `status` and `provider`.
 */
export const recordVirusScanResult = (
  method: 'batch' | 'buffer',
  result: VirusScanResult,
): void => {
  incrementMetric('virus_scan_total', {
    method,
    status: String(result.status ?? 'UNKNOWN'),
    provider: String(result.provider ?? 'unknown'),
  });
};

/**
 * Legacy entry point — delegates to the configured virus-scan adapter. New
 * callers should pull the adapter from `ingestion/virusScanProviders` so
 * they can invoke `scanBuffer` when bytes are available.
 */
export const scanDocumentOrStub = async (): Promise<VirusScanResult> => {
  const result = await getVirusScanner().scanBatch();
  recordVirusScanResult('batch', result);
  return result;
};
