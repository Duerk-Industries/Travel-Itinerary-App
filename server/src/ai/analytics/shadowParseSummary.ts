/**
 * Aggregates the raw `shadow_parse` capture records (written by
 * `shadowParseService.maybeRunShadowParse`) into a small, admin-readable
 * summary: how often the shadow LLM extraction agreed with whatever strategy
 * actually served the user, broken down by item type.
 *
 * This deliberately does NOT go through the existing `ai_analytics_metrics`
 * rollup pipeline (`aggregationJob.ts`) — that pipeline only aggregates
 * ground-truth-agreement numbers for captures tied to a running A/B
 * experiment (`experimentId`/`variantId` set). The default shadow-parse mode
 * (background sampling with no experiment configured) never sets those, so
 * its comparisons are captured to disk but never rolled up. This reads the
 * raw captures directly instead of trying to route around that gap.
 *
 * Field-level detail (`topMismatchedFields`) is only available for captures
 * written in local/dev environments. `captureService.ts` stores the full,
 * unredacted record locally, but runs production captures through
 * `allowlistSerializer.ts` first, which strips `fieldComparisons` (and
 * therefore field names/values) down to just `itemType` + `agreementRate`
 * per compared item — a deliberate privacy boundary, since field values can
 * carry traveler names, addresses, etc. `byItemType`/`averageAgreementRate`
 * are unaffected either way. Since this only ever reads the local capture
 * archive (see `listLocalAiCaptures`), `topMismatchedFields` will simply be
 * empty when run against a production deployment's own local disk (which
 * only accumulates whatever ran on that instance, not a central store) —
 * that's expected, not a bug.
 */
import { listLocalAiCaptures, type CaptureBrowserItem } from './captureBrowser';
import type { ComparisonReport } from '../evaluation/comparisonEngine';

export type ShadowParseFieldMismatch = {
  itemType: string;
  fieldName: string;
  mismatchCount: number;
};

export type ShadowParseItemTypeSummary = {
  itemType: string;
  sampleCount: number;
  averageAgreementRate: number;
};

export type ShadowParseSummary = {
  sampleCount: number;
  comparedSampleCount: number;
  averageAgreementRate: number | null;
  byItemType: ShadowParseItemTypeSummary[];
  topMismatchedFields: ShadowParseFieldMismatch[];
  source: 'local_capture_archive';
};

const MISMATCH_KEY_SEPARATOR = '';

const extractComparison = (record: CaptureBrowserItem): ComparisonReport | null => {
  const comparison = record.payloadSummary?.comparison;
  return comparison && typeof comparison === 'object' ? (comparison as ComparisonReport) : null;
};

export const summarizeShadowParseCaptures = (records: CaptureBrowserItem[]): ShadowParseSummary => {
  const comparisons = records.map(extractComparison).filter((c): c is ComparisonReport => c != null);

  const itemTypeAgreement = new Map<string, { sum: number; count: number }>();
  const mismatchCounts = new Map<string, number>();

  for (const comparison of comparisons) {
    for (const itemComparison of comparison.itemComparisons ?? []) {
      const bucket = itemTypeAgreement.get(itemComparison.itemType) ?? { sum: 0, count: 0 };
      bucket.sum += itemComparison.agreementRate;
      bucket.count += 1;
      itemTypeAgreement.set(itemComparison.itemType, bucket);

      // Present only when the capture allowlist retains per-field detail (see file header) —
      // absent in today's default-redacted captures, so this loop is usually a no-op.
      for (const field of itemComparison.fieldComparisons ?? []) {
        if (field.status === 'same') continue;
        const key = [itemComparison.itemType, field.fieldName].join(MISMATCH_KEY_SEPARATOR);
        mismatchCounts.set(key, (mismatchCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const byItemType: ShadowParseItemTypeSummary[] = Array.from(itemTypeAgreement.entries())
    .map(([itemType, { sum, count }]) => ({ itemType, sampleCount: count, averageAgreementRate: sum / count }))
    .sort((a, b) => b.sampleCount - a.sampleCount);

  const topMismatchedFields: ShadowParseFieldMismatch[] = Array.from(mismatchCounts.entries())
    .map(([key, mismatchCount]) => {
      const [itemType, fieldName] = key.split(MISMATCH_KEY_SEPARATOR);
      return { itemType, fieldName, mismatchCount };
    })
    .sort((a, b) => b.mismatchCount - a.mismatchCount)
    .slice(0, 15);

  const overallAgreementSum = comparisons.reduce((sum, c) => sum + c.agreementRate, 0);

  return {
    sampleCount: records.length,
    comparedSampleCount: comparisons.length,
    averageAgreementRate: comparisons.length ? overallAgreementSum / comparisons.length : null,
    byItemType,
    topMismatchedFields,
    source: 'local_capture_archive',
  };
};

export const getShadowParseSummary = async (
  params: { dateFrom?: string; dateTo?: string; limit?: number } = {}
): Promise<ShadowParseSummary> => {
  const records = await listLocalAiCaptures({
    featureKey: 'shadow_parse',
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    limit: params.limit ?? 250,
  });
  return summarizeShadowParseCaptures(records);
};
