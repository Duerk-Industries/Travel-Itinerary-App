import type { ExtractionResult, NormalizedDocument } from '../../ingestion/contracts';
import { INGESTION_LOGIC_VERSION } from '../../ingestion/config';
import { LlmExtractor } from '../../ingestion/extraction/llmExtractor';
import { getAdminSetting } from '../../db';
import { getCurrentApiBudgetStatus } from '../../apis/providerBudgeting';
import { logError, logInfo } from '../../logger';
import { captureAiInteraction } from '../capture/captureService';
import { compareExtractionResults } from '../evaluation/comparisonEngine';

const DEFAULT_SAMPLE_RATE_PERCENT = 10;
const DEFAULT_SHADOW_BUDGET_USD = 20;
let loggedBudgetExhausted = false;

const parseSettingNumber = async (key: string, fallback: number): Promise<number> => {
  const row = await getAdminSetting(key);
  const value = Number(row?.value);
  return Number.isFinite(value) ? value : fallback;
};

const shouldSample = (sampleRatePercent: number, randomValue = Math.random()): boolean => {
  const rate = Math.max(0, Math.min(100, sampleRatePercent));
  return randomValue * 100 < rate;
};

const buildShadowConfig = (doc: NormalizedDocument) => ({
  logicVersion: INGESTION_LOGIC_VERSION,
  allowSmallLlm: true,
  allowLargeLlm: true,
  tokenBudgetUsd: 1,
  contentHash: doc.normalizedContentHash,
  userId: doc.userId,
  importJobId: doc.importJobId,
  correlationId: doc.correlationId,
});

export const maybeRunShadowParse = async (params: {
  intakeId: string;
  doc: NormalizedDocument;
  productionResult: ExtractionResult;
  randomValue?: number;
}): Promise<void> => {
  try {
    const sampleRatePercent = await parseSettingNumber('shadow_parse_sample_rate_percent', DEFAULT_SAMPLE_RATE_PERCENT);
    if (!shouldSample(sampleRatePercent, params.randomValue)) return;

    const budgetLimitUsd = await parseSettingNumber('shadow_parse_monthly_budget_usd', DEFAULT_SHADOW_BUDGET_USD);
    const budgetStatus = await getCurrentApiBudgetStatus('SHADOW_PARSE');
    if (budgetStatus.estimatedSpendUsd >= budgetLimitUsd) {
      if (!loggedBudgetExhausted) {
        logInfo(`[ai-shadow-parse] budget exhausted window=${budgetStatus.windowKey} spend=${budgetStatus.estimatedSpendUsd} budget=${budgetLimitUsd}`);
        loggedBudgetExhausted = true;
      }
      return;
    }
    loggedBudgetExhausted = false;

    const extractor = new LlmExtractor('ShadowLlmExtractor', 1, () => true);
    const llmResult = await extractor.extract(params.doc, buildShadowConfig(params.doc));
    const comparison = compareExtractionResults(params.productionResult, llmResult);
    captureAiInteraction({
      captureSchemaVersion: 1,
      captureId: `${params.intakeId}-shadow`,
      featureKey: 'shadow_parse',
      capturedAt: new Date().toISOString(),
      correlationId: params.doc.correlationId,
      jobId: params.doc.importJobId,
      userId: params.doc.userId,
      provider: llmResult.usageMetrics.provider,
      model: llmResult.usageMetrics.modelName ?? undefined,
      callerId: 'LLM_SHADOW_PARSE',
      outcome: 'success',
      tokenUsage: {
        promptTokens: llmResult.usageMetrics.tokensIn,
        completionTokens: llmResult.usageMetrics.tokensOut,
        totalTokens: llmResult.usageMetrics.tokensIn + llmResult.usageMetrics.tokensOut,
      },
      payload: {
        comparison,
      },
    });
  } catch (err) {
    logError('[ai-shadow-parse] skipped after failure', err);
  }
};

export const __shadowParseShouldSampleForTests = shouldSample;
