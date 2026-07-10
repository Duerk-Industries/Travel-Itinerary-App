import { logError } from '../../logger';
import type { ExtractionResult, NormalizedDocument } from '../../ingestion/contracts';
import { captureAiInteraction } from './captureService';

export const captureParsingInteraction = (params: {
  intakeId: string;
  doc: NormalizedDocument;
  result: ExtractionResult;
  outcome?: 'success' | 'failure';
}): void => {
  try {
    captureAiInteraction({
      captureSchemaVersion: 1,
      captureId: params.intakeId,
      featureKey: 'parsing',
      capturedAt: new Date().toISOString(),
      correlationId: params.doc.correlationId,
      jobId: params.doc.importJobId,
      userId: params.doc.userId,
      provider: params.result.usageMetrics.provider,
      model: params.result.usageMetrics.modelName ?? undefined,
      callerId: params.result.metadata.strategyName,
      outcome: params.outcome ?? 'success',
      tokenUsage: {
        promptTokens: params.result.usageMetrics.tokensIn,
        completionTokens: params.result.usageMetrics.tokensOut,
        totalTokens: params.result.usageMetrics.tokensIn + params.result.usageMetrics.tokensOut,
      },
      payload: {
        sourceType: params.doc.sourceType,
        originalFilename: params.doc.originalFilename,
        normalizationQuality: params.doc.normalizationQuality,
        extractedTextSource: params.doc.extractedTextSource,
        strategyName: params.result.metadata.strategyName,
        logicVersion: params.result.metadata.logicVersion,
        estimatedCostUsd: params.result.usageMetrics.estimatedCostUsd,
        parsedItems: params.result.parsedItems.map((item) => ({
          itemType: item.itemType,
          providerVendor: item.providerVendor,
          confirmationNumber: item.confirmationNumber,
          confidenceScore: item.confidenceScore,
          reviewStatus: item.reviewStatus,
          extractedFields: item.extractedFields,
        })),
      },
    });
  } catch (err) {
    logError('[ai-capture] parsing capture scheduling failed', err);
  }
};
