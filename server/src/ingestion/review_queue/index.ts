import { INGESTION_CONFIDENCE_REVIEW_READY } from '../config';
import type { ExtractionResult, PersistedParsedItem } from '../contracts';
import { createParsedItem, findParsedItemByFingerprint } from '../shared/repository';

const shouldSuppressDuplicateCandidate = (params: {
  candidate: ExtractionResult['parsedItems'][number];
  existing: PersistedParsedItem | null;
}): boolean => {
  const { candidate, existing } = params;
  if (!existing) return false;
  if (candidate.itemType !== 'generic_note') return false;
  if (candidate.confidenceScore >= INGESTION_CONFIDENCE_REVIEW_READY) return false;
  if (candidate.providerVendor || candidate.confirmationNumber) return false;
  return true;
};

export const persistReviewQueueItems = async (params: {
  userId: string;
  importJobId: string;
  rawDocId: string;
  extractionResult: ExtractionResult;
  logicVersion: string;
}): Promise<PersistedParsedItem[]> => {
  const results: PersistedParsedItem[] = [];
  for (const candidate of params.extractionResult.parsedItems) {
    const existing = await findParsedItemByFingerprint(params.userId, candidate.deduplicationFingerprint);
    if (shouldSuppressDuplicateCandidate({ candidate, existing })) {
      continue;
    }
    if (existing) {
      if (existing.status === 'DELETED') {
        candidate.reviewStatus = 'DUPLICATE_FLAGGED';
        candidate.duplicateDisposition = 'PREVIOUSLY_DELETED';
        candidate.duplicateOfParsedItemId = existing.id;
        candidate.duplicateOfTripId = existing.assignedTripId ?? null;
      } else {
        candidate.reviewStatus = 'DUPLICATE_FLAGGED';
        candidate.duplicateDisposition = existing.assignedTripId ? 'ASSIGNED_MATCH' : 'ACTIVE_MATCH';
        candidate.duplicateOfParsedItemId = existing.id;
        candidate.duplicateOfTripId = existing.assignedTripId ?? null;
      }
    } else if (candidate.confidenceScore < INGESTION_CONFIDENCE_REVIEW_READY) {
      candidate.reviewStatus = 'LOW_CONFIDENCE';
    } else {
      candidate.reviewStatus = 'READY_FOR_REVIEW';
    }
    results.push(
      await createParsedItem({
        userId: params.userId,
        importJobId: params.importJobId,
        rawDocId: params.rawDocId,
        candidate,
        logicVersion: params.logicVersion,
      })
    );
  }
  return results;
};
