import type { ExtractionResult, NormalizedDocument } from '../../ingestion/contracts';
import { INGESTION_LOGIC_VERSION } from '../../ingestion/config';
import { LlmExtractor } from '../../ingestion/extraction/llmExtractor';
import { getAdminSetting } from '../../db';
import { getApiBudgetWindowKey, getCurrentApiBudgetStatus, recordApiCost } from '../../apis/providerBudgeting';
import { logError, logInfo } from '../../logger';
import { captureAiInteraction } from '../capture/captureService';
import { compareExtractionResults } from '../evaluation/comparisonEngine';
import { getRunningExperiment } from '../experiments/experimentConfigService';
import { resolveExperimentVariant } from '../experiments/assignment';
import { getOrCreateAiExperimentAssignment } from '../../db';
import { isExperimentVariantTripped, recordExperimentVariantOutcome } from '../experiments/circuitBreaker';
import { shouldSample } from '../../utils/sampleRate';

const DEFAULT_SAMPLE_RATE_PERCENT = 10;
const DEFAULT_SHADOW_BUDGET_USD = 20;
let loggedBudgetExhausted = false;

const parseSettingNumber = async (key: string, fallback: number): Promise<number> => {
  const row = await getAdminSetting(key);
  const value = Number(row?.value);
  return Number.isFinite(value) ? value : fallback;
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
    const runningExperiment = await getRunningExperiment('ingestion_llm_extract', 'shadow_compare');
    let experimentContext: { experimentId: string; variantId: string; controlVariantId: string } | null = null;
    if (runningExperiment) {
      const assignmentKey = params.doc.userId ?? params.doc.normalizedContentHash ?? params.intakeId;
      const resolved = resolveExperimentVariant(assignmentKey, runningExperiment);
      const assignment = await getOrCreateAiExperimentAssignment({
        assignmentKey,
        experimentId: runningExperiment.experimentId,
        variantId: resolved.variantId,
      });
      const controlVariantId = runningExperiment.controlVariantId ?? runningExperiment.variants[0]?.variantId ?? assignment.variantId;
      if (assignment.variantId === controlVariantId) return;
      if (isExperimentVariantTripped(runningExperiment.experimentId, assignment.variantId)) return;
      experimentContext = {
        experimentId: runningExperiment.experimentId,
        variantId: assignment.variantId,
        controlVariantId,
      };
    } else {
      const sampleRatePercent = await parseSettingNumber('shadow_parse_sample_rate_percent', DEFAULT_SAMPLE_RATE_PERCENT);
      if (!shouldSample(sampleRatePercent, params.randomValue)) return;
    }

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
    let llmResult: ExtractionResult;
    const startedAt = Date.now();
    try {
      llmResult = await extractor.extract(params.doc, buildShadowConfig(params.doc));
      if (experimentContext) {
        await recordExperimentVariantOutcome({ ...experimentContext, success: true });
      }
    } catch (err) {
      if (experimentContext) {
        await recordExperimentVariantOutcome({ ...experimentContext, success: false });
      }
      throw err;
    }

    // The underlying LLM call itself is recorded under the real provider's cost
    // bucket (e.g. OPENAI) by postOpenAiChatCompletion — that's correct for the
    // provider's own monthly budget. But the shadow-mode $/month cap checked
    // above via getCurrentApiBudgetStatus('SHADOW_PARSE') needs its OWN spend
    // recorded under that synthetic key, or it never accrues and the cap is a
    // no-op. Record it here, right after the call, using the cost the
    // extractor already computed.
    const shadowCostUsd = llmResult.usageMetrics.estimatedCostUsd ?? 0;
    if (shadowCostUsd > 0) {
      await recordApiCost({
        provider: 'SHADOW_PARSE',
        windowKey: getApiBudgetWindowKey(),
        amountMicros: Math.round(shadowCostUsd * 1_000_000),
      });
    }

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
      latencyMs: Math.max(0, Date.now() - startedAt),
      tokenUsage: {
        promptTokens: llmResult.usageMetrics.tokensIn,
        completionTokens: llmResult.usageMetrics.tokensOut,
        totalTokens: llmResult.usageMetrics.tokensIn + llmResult.usageMetrics.tokensOut,
      },
      payload: {
        experimentId: experimentContext?.experimentId,
        variantId: experimentContext?.variantId,
        estimatedCostUsd: shadowCostUsd,
        comparison,
      },
    });
  } catch (err) {
    logError('[ai-shadow-parse] skipped after failure', err);
  }
};

export const __shadowParseShouldSampleForTests = shouldSample;
