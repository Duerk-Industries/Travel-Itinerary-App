import type { VirusScanResult } from '../shared/virusScan';

/**
 * Shape every virus-scan adapter must satisfy. `scanBatch` is the
 * back-compatible entry used by today's intake code paths that don't have a
 * per-file buffer at the validation step. `scanBuffer` is the real entry
 * point for future streaming scans once those callers pass the bytes
 * through.
 */
export interface VirusScannerAdapter {
  /** Short identifier emitted in `provider` of the `VirusScanResult`. */
  readonly name: string;
  /** Coarse-grained scan decision without a buffer. Current intake path. */
  scanBatch(): Promise<VirusScanResult>;
  /** Per-file scan when bytes are available. Not required of every adapter. */
  scanBuffer?(bytes: Buffer, filename: string): Promise<VirusScanResult>;
}

export type { VirusScanResult };
