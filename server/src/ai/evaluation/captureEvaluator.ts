import type { CaptureRecord } from '../types/captureRecord';
import { evaluateFields } from './fieldEvaluator';
import { scoreEvaluation, type EvaluationResult } from './qualityScore';

export const evaluateParsingCaptureRecord = (record: CaptureRecord): EvaluationResult | null => {
  if (record.featureKey !== 'parsing') return null;
  const parsedItems = Array.isArray(record.payload.parsedItems) ? record.payload.parsedItems : [];
  const itemResults = parsedItems.map((item) => {
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const itemType = String(raw.itemType ?? 'generic_note');
    const extractedFields =
      raw.extractedFields && typeof raw.extractedFields === 'object'
        ? raw.extractedFields as Record<string, unknown>
        : {};
    return evaluateFields(itemType, extractedFields);
  });
  return scoreEvaluation(record.captureId, itemResults);
};
