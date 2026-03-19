/**
 * Source-specific learned parser extractor.
 *
 * Uses regex patterns stored in `learned_source_parsers` (populated by LLM learning).
 * Falls through to generic regex if no learned parser exists or match ratio is too low.
 */

import { INGESTION_CONFIDENCE_HIGH, INGESTION_CONFIDENCE_REVIEW_READY } from '../config';
import type { ExtractionConfig, ExtractionResult, NormalizedDocument, ParsedItemCandidate, ParsedItemType } from '../contracts';
import type { ExtractionStrategy } from './index';
import { detectSource, detectItemType } from './sourceDetection';
import { getLearnedParser } from '../shared/repository';
import { logInfo } from '../../logger';

const INGESTION_SOURCE_PARSER_MIN_MATCH_RATIO = 0.4;

const emptyResult = (config: ExtractionConfig): ExtractionResult => ({
  parsedItems: [],
  usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'source_specific', modelName: null, estimatedCostUsd: 0 },
  metadata: { logicVersion: config.logicVersion, extractedAt: new Date().toISOString(), strategyName: 'SourceSpecificExtractor' },
});

export class SourceSpecificExtractor implements ExtractionStrategy {
  readonly strategyName = 'SourceSpecificExtractor';
  readonly minConfidenceToSkipNext = INGESTION_CONFIDENCE_REVIEW_READY;

  canHandle(doc: NormalizedDocument): boolean {
    return detectSource(doc) !== null;
  }

  async extract(doc: NormalizedDocument, config: ExtractionConfig): Promise<ExtractionResult> {
    const sourceKey = detectSource(doc);
    if (!sourceKey) return emptyResult(config);

    const itemType = detectItemType(doc.normalizedText) as ParsedItemType;
    const parser = await getLearnedParser(sourceKey, itemType);
    if (!parser || !Object.keys(parser.fieldPatterns).length) return emptyResult(config);

    // Apply each learned regex pattern
    const extractedFields: Record<string, unknown> = {};
    let fieldsMatched = 0;
    const totalFields = Object.keys(parser.fieldPatterns).length;

    for (const [fieldName, pattern] of Object.entries(parser.fieldPatterns)) {
      try {
        const regex = new RegExp(pattern, 'i');
        const match = doc.normalizedText.match(regex);
        if (match?.[1]) {
          extractedFields[fieldName] = match[1].trim();
          fieldsMatched++;
        }
      } catch {
        // Invalid regex in stored pattern — skip
      }
    }

    const matchRatio = fieldsMatched / Math.max(totalFields, 1);
    if (matchRatio < INGESTION_SOURCE_PARSER_MIN_MATCH_RATIO) {
      logInfo(`[ingestion][source-specific] ${sourceKey}/${itemType} match ratio ${matchRatio.toFixed(2)} below threshold, skipping`);
      return emptyResult(config);
    }

    const confidence = Math.min(0.95, 0.7 + matchRatio * 0.25);

    logInfo(`[ingestion][source-specific] ${sourceKey}/${itemType} matched ${fieldsMatched}/${totalFields} fields (${(matchRatio * 100).toFixed(0)}%), confidence=${confidence.toFixed(2)}`);

    // Lazy-import createCandidate to avoid circular dependency
    const { createCandidateExported } = await import('./index');

    const candidate = await createCandidateExported({
      itemType,
      doc,
      providerVendor: String(extractedFields.name ?? extractedFields.providerVendor ?? sourceKey),
      confirmationNumber: String(extractedFields.confirmationNumber ?? '') || null,
      extractedFields: { ...extractedFields, learnedSourceKey: sourceKey },
      confidenceScore: confidence,
      startDateTimeUtcOverride: extractedFields.checkInDate ? String(extractedFields.checkInDate) : undefined,
      endDateTimeUtcOverride: extractedFields.checkOutDate ? String(extractedFields.checkOutDate) : undefined,
    });

    return {
      parsedItems: [candidate],
      usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'source_specific', modelName: null, estimatedCostUsd: 0 },
      metadata: {
        logicVersion: config.logicVersion,
        extractedAt: new Date().toISOString(),
        strategyName: this.strategyName,
      },
    };
  }
}
