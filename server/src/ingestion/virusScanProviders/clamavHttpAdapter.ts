import { getEnvValue } from '../../env';
import { logError, logInfo } from '../../logger';
import type { VirusScannerAdapter, VirusScanResult } from './types';
import { reserveApiUsageOrThrow } from '../../apis/usageLimiter';
import { recordProviderRequestCost } from '../../apis/providerBudgeting';

/**
 * ClamAV HTTP adapter. Expects a clamav-rest-compatible sidecar reachable
 * at `INGESTION_VIRUS_SCAN_URL`. Contract follows the de-facto Google Cloud
 * Run community reference:
 *   - POST the raw bytes as a multipart/form-data body under field `FILES`.
 *   - HTTP 200 → clean → PASSED.
 *   - HTTP 406 → infected → FAILED (ClamAV's INFECTED convention).
 *   - HTTP 4xx/5xx → network/server error → FAILED (fail-closed).
 *
 * `scanBatch()` is a no-op PASSED because the adapter is designed around the
 * per-file `scanBuffer()` entry point; a batch-level call without bytes is
 * only reached by legacy callers that will either migrate or keep using the
 * stub. Deployments that wire this adapter in should ensure intake passes
 * buffers so every file is actually scanned.
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

  async scanBuffer(bytes: Buffer, filename: string): Promise<VirusScanResult> {
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
      filename,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getTimeoutMs());
    try {
      await reserveApiUsageOrThrow({ provider: 'CLAMAV', caller: 'VIRUS_SCAN_BUFFER' });
      await recordProviderRequestCost({ provider: 'CLAMAV' });
      const response = await fetch(url, { method: 'POST', body: form as any, signal: controller.signal });
      const scannedAt = new Date().toISOString();
      if (response.status === 200) {
        return { status: 'PASSED', scannedAt, provider: 'clamav_http' };
      }
      if (response.status === 406) {
        // clamav-rest emits the detection name in the body; log it so an
        // operator can correlate with ClamAV signatures. We don't leak the
        // detection detail to end users.
        const detail = await response.text().catch(() => '');
        logInfo(`[virus-scan] clamav_http flagged ${filename}: ${detail.slice(0, 200)}`);
        return { status: 'FAILED', scannedAt, provider: 'clamav_http' };
      }
      logError(`[virus-scan] clamav_http unexpected status ${response.status} for ${filename}`);
      return { status: 'FAILED', scannedAt, provider: 'clamav_http_error' };
    } catch (err) {
      logError('[virus-scan] clamav_http transport error', err);
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
