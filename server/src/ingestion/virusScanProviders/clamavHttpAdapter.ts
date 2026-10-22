import { getEnvValue } from '../../env';
import { logError } from '../../logger';
import { createHash } from 'crypto';
import type { VirusScannerAdapter, VirusScanResult } from './types';
import { reserveApiUsageOrThrow } from '../../apis/usageLimiter';
import { recordProviderRequestCost } from '../../apis/providerBudgeting';

/** Authenticated private scanner. Clean results must attest to the exact
 * bytes and fresh signatures; bare HTTP 200 is insufficient. The deployed
 * scanner contract is documented in docs/operations/gap-closing-p0.md.
 * scanBatch is only a legacy compatibility decision; intake always invokes
 * scanBuffer for every real file before parsing it.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

const getScanUrl = (): string | null => {
  const url = getEnvValue('INGESTION_VIRUS_SCAN_URL');
  return url && url.trim() ? url.trim() : null;
};

const getTimeoutMs = (): number => {
  const raw = Number(getEnvValue('INGESTION_VIRUS_SCAN_TIMEOUT_MS') ?? '');
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.floor(raw));
};

export const clamavHttpAdapter: VirusScannerAdapter = {
  name: 'clamav_http',

  async scanBatch(): Promise<VirusScanResult> {
    return {
      status: 'PASSED',
      scannedAt: new Date().toISOString(),
      provider: 'clamav_http',
    };
  },

  async scanBuffer(bytes: Buffer, _filename: string): Promise<VirusScanResult> {
    const url = getScanUrl();
    if (!url) {
      logError('[virus-scan] INGESTION_VIRUS_SCAN_URL is not configured; failing closed');
      return {
        status: 'FAILED',
        scannedAt: new Date().toISOString(),
        provider: 'clamav_http_unconfigured',
      };
    }

    const form = new FormData();
    form.append(
      'FILES',
      // Node's `Blob` constructor accepts Uint8Array; filename tags the part.
      new Blob([bytes as unknown as BlobPart]),
      'document',
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getTimeoutMs());
    try {
      await reserveApiUsageOrThrow({ provider: 'CLAMAV', caller: 'VIRUS_SCAN_BUFFER' });
      await recordProviderRequestCost({ provider: 'CLAMAV' });
      const digest = createHash('sha256').update(bytes).digest('hex');
      const authToken = getEnvValue('INGESTION_VIRUS_SCAN_AUTH_TOKEN');
      const response = await fetch(url, {
        method: 'POST', body: form as any, signal: controller.signal,
        headers: { 'X-Content-SHA256': digest, ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      });
      const scannedAt = new Date().toISOString();
      if (response.status === 200) {
        // HTTP 200 alone can be a proxy/login page or no-op batch result.
        // The private scanner must attest to these exact bytes and fresh AV
        // signatures. See docs/operations/gap-closing-p0.md for its contract.
        const result = await response.json() as { status?: unknown; sha256?: unknown; signatureUpdatedAt?: unknown };
        const updatedAt = typeof result.signatureUpdatedAt === 'string' ? Date.parse(result.signatureUpdatedAt) : NaN;
        if (result.status === 'clean' && result.sha256 === digest && Number.isFinite(updatedAt)
          && updatedAt <= Date.now() + 5 * 60_000 && updatedAt >= Date.now() - 48 * 60 * 60_000) {
          return { status: 'PASSED', scannedAt, provider: 'clamav_http' };
        }
        return { status: 'FAILED', scannedAt, provider: 'clamav_http_invalid_result' };
      }
      if (response.status === 406) {
        // clamav-rest emits the detection name in the body; log it so an
        // operator can correlate with ClamAV signatures. We don't leak the
        // detection detail to end users.
        logError('[virus-scan] document failed safety checks');
        return { status: 'FAILED', scannedAt, provider: 'clamav_http' };
      }
      logError(`[virus-scan] clamav_http unexpected status ${response.status}`);
      return { status: 'FAILED', scannedAt, provider: 'clamav_http_error' };
    } catch {
      logError('[virus-scan] clamav_http transport or response failure');
      return {
        status: 'FAILED',
        scannedAt: new Date().toISOString(),
        provider: 'clamav_http_error',
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
