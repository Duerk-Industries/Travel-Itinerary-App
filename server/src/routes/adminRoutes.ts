import { Router } from 'express';
import bodyParser from 'body-parser';
import {
  listFeatureFlags, setFeatureFlag, writeAuditLog,
  listAiProviderConfigs,
  createAiExperiment,
  listAiExperiments,
  getAiExperiment,
  updateAiExperimentStatus,
  listAiAbTestMetrics,
  setAiProviderCertification,
  deleteAiProviderCertification,
  listAiProviderCertifications,
  listAiRecommendations,
  updateAiRecommendationStatus,
  getAdminSetting,
  listAiAnalyticsMetrics,
  setAdminSetting,
  listTiers, getTierByKey, listTierLimits, listTierEntitlements, listFeatures,
  upsertTierLimit, upsertTierEntitlement,
  getUserRole, setUserRole, setUserTier, getCurrentUserTier,
  listAuditLog,
  adminSearchUsers, adminGetUser, adminGetUserData,
  getUniversalPackingList, replaceUniversalPackingList,
  listPackingPresetsV2, syncPackingPresetCatalogV2, removePackingPresetV2, reactivatePackingPresetV2, updatePackingPresetV2,
  deleteAttractionDurationMetadata,
} from '../db';
import { TokenPayload } from '../auth';
import { logError } from '../logger';
import { getRegisteredAiProviders } from '../ai/registry/aiProviderRegistry';
import {
  clearAiProviderConfigCache,
  getActiveAiProvider,
  getConfiguredProviderApiKey,
  setAiProviderConfigWithAudit,
} from '../services/aiProviderConfigService';
import {
  getApiBudgetProviderConfig,
  getApiLimitsConfig,
  normalizeApiLimitKeyPart,
  updateApiBudgetProviderConfig,
  updateApiCachingConfig,
  updateApiLimitProviderConfig,
} from '../config/apiLimits';
import { getFeatureFlagSeeds } from '../config/featureFlags';
import { GETYOURGUIDE_FEATURE_FLAG, getGetYourGuidePartnerConfig } from '../config/getYourGuide';
import { getApiUsageSummary } from '../apis/usageLimiter';
import { getApiBudgetSummary } from '../apis/providerBudgeting';
import {
  countImportJobsByState,
  listDataDeletionJobs,
  type DataDeletionJobState,
} from '../ingestion/shared/repository';
import { readDto } from '../utils/dtoParse';
import { bulkSetUserTierDto, bulkSetUserRoleDto } from './adminDtos';
import { getMetricCounterSnapshot } from '../metrics';
import { getGetYourGuideObservabilitySnapshot } from '../services/getYourGuideObservability';
import { invalidatePackingPresetCatalogCache, parsePackingPresetDirectory, parsePresetMarkdown } from '../services/packingListCatalogService';
import { normalizePackingLabel } from '../utils/packingListNormalize';
import { getGetYourGuideApiCircuitStatus } from '../apis/getYourGuideApi';
import { listLocalAiCaptures } from '../ai/analytics/captureBrowser';
import { runAiDailyAggregation } from '../ai/analytics/aggregationJob';
import {
  replayParsingIntake,
  ReplayIntakeNotFoundError,
  ReplaySourceUnavailableError,
} from '../ai/replay/parsingReplayService';
import { isProviderCertified } from '../ai/experiments/certification';
import { getAiExecutiveSummary } from '../ai/analytics/executiveSummary';
import { clearExperimentConfigCache } from '../ai/experiments/experimentConfigService';
import {
  ITINERARY_INSTRUCTION_PHASES,
  listItineraryInstructionDocuments,
  updateItineraryInstructionDocuments,
  type ItineraryInstructionPhase,
} from '../services/itineraryInstructionService';
import {
  getCostEstimatorConfig,
  computeProjectedMonthlyCost,
  getActualMonthlySpend,
  updateCostEstimatorConfig,
  updateCostEstimatorRequestPricing,
  REQUEST_PRICED_PROVIDER_KEYS,
} from '../services/costEstimatorService';

// Admin routes — all guarded by authenticate + requireAdmin in app.ts
const router = Router();
router.use(bodyParser.json());

const getActorId = (req: any): string => (req.user as TokenPayload).userId;

const requireReason = (reason: unknown): string | null => {
  if (typeof reason !== 'string' || reason.trim().length < 3) return null;
  return reason.trim();
};

const AI_FEATURE_KEYS = ['itinerary_generation', 'ingestion_llm_extract'] as const;
const AI_RUNTIME_SETTING_DEFAULTS = {
  shadow_parse_sample_rate_percent: '10',
  shadow_parse_monthly_budget_usd: '20',
  ai_aggregation_run_hour_utc: '3',
  ingestion_parsing_promotion_quality_delta_min: '1',
  ingestion_parsing_promotion_validation_error_max: '0',
  recommendation_weight_quality_ingestion_llm_extract: '0.7',
  recommendation_weight_cost_ingestion_llm_extract: '0.3',
  recommendation_min_delta_threshold: '0.05',
  ai_experiment_circuit_breaker_min_requests: '20',
  ai_experiment_circuit_breaker_failure_rate_threshold: '0.25',
} as const;
const AI_RUNTIME_SETTING_KEYS = Object.keys(AI_RUNTIME_SETTING_DEFAULTS) as Array<keyof typeof AI_RUNTIME_SETTING_DEFAULTS>;
const getAiProviderOptions = (certifiedProviderIds = new Set<string>()) => {
  const registered = new Set(getRegisteredAiProviders().map((provider) => provider.id));
  return Array.from(registered)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({
      id,
      configured: Boolean(getConfiguredProviderApiKey(id)),
      registered: getRegisteredAiProviders().some((provider) => provider.id === id),
      certified: certifiedProviderIds.has(id),
      supportedModels: getRegisteredAiProviders().find((provider) => provider.id === id)?.supportedModels ?? [],
    }));
};

const getRuntimeSettingNumber = async (key: keyof typeof AI_RUNTIME_SETTING_DEFAULTS): Promise<number> => {
  const row = await getAdminSetting(key);
  const parsed = Number(row?.value ?? AI_RUNTIME_SETTING_DEFAULTS[key]);
  return Number.isFinite(parsed) ? parsed : Number(AI_RUNTIME_SETTING_DEFAULTS[key]);
};

const assertExperimentPromotionAllowed = async (experimentId: string, winningVariantId: string): Promise<string | null> => {
  const experiment = await getAiExperiment(experimentId);
  if (!experiment) return 'Experiment not found';
  const controlVariantId = experiment.controlVariantId ?? experiment.variants[0]?.variantId;
  if (!controlVariantId) return 'Experiment has no control variant';
  if (winningVariantId === controlVariantId) return null;
  const metrics = await listAiAbTestMetrics({ experimentId, limit: 1000 });
  const latestByVariant = new Map<string, typeof metrics[number]>();
  for (const metric of metrics) {
    const current = latestByVariant.get(metric.variantId);
    if (!current || metric.day > current.day) latestByVariant.set(metric.variantId, metric);
  }
  const winner = latestByVariant.get(winningVariantId);
  const control = latestByVariant.get(controlVariantId);
  if (!winner || !control) return 'Promotion requires metrics for both the winning and control variants';
  const minSampleSize = Math.max(experiment.minSampleSize, 1);
  if (winner.requestCount < minSampleSize || control.requestCount < minSampleSize) {
    return `Promotion requires at least ${minSampleSize} requests for both winning and control variants`;
  }
  const minQualityDelta = await getRuntimeSettingNumber('ingestion_parsing_promotion_quality_delta_min');
  if (winner.avgQualityScore - control.avgQualityScore < minQualityDelta) {
    return `Promotion requires quality delta >= ${minQualityDelta}`;
  }
  const maxValidationErrorDelta = await getRuntimeSettingNumber('ingestion_parsing_promotion_validation_error_max');
  const winnerFailureRate = 1 - winner.successRate;
  const controlFailureRate = 1 - control.successRate;
  if (winnerFailureRate - controlFailureRate > maxValidationErrorDelta) {
    return `Promotion requires non-worse validation error rate (max delta ${maxValidationErrorDelta})`;
  }
  return null;
};

// ---------------------------------------------------------------------------
// AI provider config
// ---------------------------------------------------------------------------

router.get('/ai-config', async (_req, res) => {
  try {
    const stored = await listAiProviderConfigs();
    const certifications = await listAiProviderCertifications();
    const certifiedProviderIds = new Set(certifications.map((cert) => cert.providerId));
    const byFeature = new Map(stored.map((row) => [row.featureKey, row]));
    const features = await Promise.all(AI_FEATURE_KEYS.map(async (featureKey) => {
      const row = byFeature.get(featureKey);
      return row ?? await getActiveAiProvider(featureKey);
    }));
    res.json({ features, providers: getAiProviderOptions(certifiedProviderIds), certifications });
  } catch (err) {
    logError('[admin] failed to list AI provider config', err);
    res.status(500).json({ error: 'Failed to list AI provider config' });
  }
});

router.patch('/ai-config/:featureKey', async (req, res) => {
  const featureKey = String(req.params.featureKey ?? '').trim();
  const { provider, model, enabled, reason } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!AI_FEATURE_KEYS.includes(featureKey as any)) {
    res.status(404).json({ error: `Unknown AI feature key: ${featureKey}` });
    return;
  }
  if (typeof provider !== 'string' || !provider.trim()) {
    res.status(400).json({ error: 'provider is required' });
    return;
  }
  if (typeof model !== 'string' || !model.trim()) {
    res.status(400).json({ error: 'model is required' });
    return;
  }
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled boolean is required' });
    return;
  }
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  const providerId = provider.trim().toLowerCase();
  const certifications = await listAiProviderCertifications();
  const providerOption = getAiProviderOptions(new Set(certifications.map((cert) => cert.providerId))).find((item) => item.id === providerId);
  if (!providerOption?.configured || !providerOption.registered) {
    res.status(400).json({ error: `Provider is not configured or registered: ${providerId}` });
    return;
  }
  try {
    const actorId = getActorId(req);
    const updated = await setAiProviderConfigWithAudit({
      featureKey,
      provider: providerId,
      model: model.trim(),
      enabled,
      actorUserId: actorId,
      reason: reasonStr,
    });
    clearAiProviderConfigCache(featureKey);
    res.json({ config: updated, providers: getAiProviderOptions(new Set(certifications.map((cert) => cert.providerId))) });
  } catch (err) {
    logError('[admin] failed to update AI provider config', err);
    res.status(500).json({ error: 'Failed to update AI provider config' });
  }
});

router.get('/itinerary-instructions', async (_req, res) => {
  try {
    const phases = await listItineraryInstructionDocuments();
    res.json({ phases });
  } catch (err) {
    logError('[admin] failed to list itinerary instructions', err);
    res.status(500).json({ error: 'Failed to list itinerary instructions' });
  }
});

router.patch('/itinerary-instructions', async (req, res) => {
  const reasonStr = requireReason(req.body?.reason);
  const phases = req.body?.phases;
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  if (!phases || typeof phases !== 'object' || Array.isArray(phases)) {
    res.status(400).json({ error: 'phases object is required' });
    return;
  }
  const phaseUpdates: Partial<Record<ItineraryInstructionPhase, string>> = {};
  for (const phase of ITINERARY_INSTRUCTION_PHASES) {
    const value = phases[phase];
    if (typeof value === 'string' && value.trim()) phaseUpdates[phase] = value;
  }
  if (!Object.keys(phaseUpdates).length) {
    res.status(400).json({ error: 'At least one non-empty phase markdown document is required' });
    return;
  }
  try {
    const updated = await updateItineraryInstructionDocuments({
      phases: phaseUpdates,
      actorId: getActorId(req),
      reason: reasonStr,
    });
    res.json({ phases: updated });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Instruction markdown|phase markdown/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    logError('[admin] failed to update itinerary instructions', err);
    res.status(500).json({ error: 'Failed to update itinerary instructions' });
  }
});

router.post('/providers/:providerId/certify', async (req, res) => {
  const providerId = String(req.params.providerId ?? '').trim().toLowerCase();
  const { contractSuiteVersion, notes, reason } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!getRegisteredAiProviders().some((provider) => provider.id === providerId)) {
    res.status(404).json({ error: `Unknown provider: ${providerId}` });
    return;
  }
  if (typeof contractSuiteVersion !== 'string' || contractSuiteVersion.trim().length < 3) {
    res.status(400).json({ error: 'contractSuiteVersion is required' });
    return;
  }
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const certification = await setAiProviderCertification({
      providerId,
      certifiedBy: actorId,
      contractSuiteVersion: contractSuiteVersion.trim(),
      notes: typeof notes === 'string' ? notes : null,
    });
    await writeAuditLog({
      actorUserId: actorId,
      action: 'AI_PROVIDER_CERTIFIED',
      afterState: { certification },
      reason: reasonStr,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.json({ certification });
  } catch (err) {
    logError('[admin] failed to certify AI provider', err);
    res.status(500).json({ error: 'Failed to certify AI provider' });
  }
});

router.delete('/providers/:providerId/certify', async (req, res) => {
  const providerId = String(req.params.providerId ?? '').trim().toLowerCase();
  const reasonStr = requireReason(req.body?.reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    await deleteAiProviderCertification(providerId);
    await writeAuditLog({
      actorUserId: actorId,
      action: 'AI_PROVIDER_CERTIFICATION_REVOKED',
      afterState: { providerId },
      reason: reasonStr,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.json({ providerId, revoked: true });
  } catch (err) {
    logError('[admin] failed to revoke AI provider certification', err);
    res.status(500).json({ error: 'Failed to revoke AI provider certification' });
  }
});

router.get('/experiments', async (req, res) => {
  try {
    const experiments = await listAiExperiments({
      featureKey: typeof req.query.featureKey === 'string' ? req.query.featureKey : undefined,
      status: typeof req.query.status === 'string' ? req.query.status as any : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 100,
    });
    const metrics = await listAiAbTestMetrics({ limit: 500 });
    res.json({ experiments, metrics });
  } catch (err) {
    logError('[admin] failed to list AI experiments', err);
    res.status(500).json({ error: 'Failed to list AI experiments' });
  }
});

router.post('/experiments', async (req, res) => {
  const { featureKey, experimentKind, name, variants, controlVariantId, minSampleSize, maxDurationDays, reason, actorRole } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (typeof featureKey !== 'string' || !featureKey.trim()) {
    res.status(400).json({ error: 'featureKey is required' });
    return;
  }
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (!Array.isArray(variants) || variants.length < 1) {
    res.status(400).json({ error: 'variants array is required' });
    return;
  }
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    for (const variant of variants) {
      if (variant.provider && !(await isProviderCertified(String(variant.provider)))) {
        res.status(400).json({ error: `Provider is not certified: ${variant.provider}` });
        return;
      }
    }
    const actorId = getActorId(req);
    const experiment = await createAiExperiment({
      featureKey: featureKey.trim(),
      experimentKind: experimentKind === 'traffic_split' ? 'traffic_split' : 'shadow_compare',
      name: name.trim(),
      variants,
      controlVariantId: typeof controlVariantId === 'string' ? controlVariantId : null,
      minSampleSize: Number(minSampleSize) || 200,
      maxDurationDays: Number(maxDurationDays) || 30,
      createdBy: actorId,
    });
    await writeAuditLog({
      actorUserId: actorId,
      action: 'AI_EXPERIMENT_CREATED',
      afterState: { experiment, actorRole: actorRole ?? 'engineering_admin' },
      reason: reasonStr,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    clearExperimentConfigCache();
    res.status(201).json({ experiment });
  } catch (err) {
    logError('[admin] failed to create AI experiment', err);
    res.status(500).json({ error: 'Failed to create AI experiment' });
  }
});

router.patch('/experiments/:experimentId', async (req, res) => {
  const experimentId = String(req.params.experimentId ?? '');
  const { status, winningVariantId, reason, actorRole } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!['draft', 'running', 'paused', 'completed'].includes(String(status))) {
    res.status(400).json({ error: 'valid status is required' });
    return;
  }
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const before = await getAiExperiment(experimentId);
    if (!before) {
      res.status(404).json({ error: 'Experiment not found' });
      return;
    }
    const nextWinningVariantId = typeof winningVariantId === 'string' ? winningVariantId : null;
    if (nextWinningVariantId) {
      const promotionError = await assertExperimentPromotionAllowed(experimentId, nextWinningVariantId);
      if (promotionError) {
        res.status(400).json({ error: promotionError });
        return;
      }
    }
    const after = await updateAiExperimentStatus({
      experimentId,
      status,
      winningVariantId: nextWinningVariantId,
    });
    await writeAuditLog({
      actorUserId: actorId,
      action: nextWinningVariantId ? 'AI_EXPERIMENT_PROMOTED' : 'AI_EXPERIMENT_STATUS_CHANGED',
      beforeState: { experiment: before },
      afterState: {
        experiment: after,
        actorRole: actorRole ?? 'engineering_admin',
        promotionThresholds: nextWinningVariantId ? {
          qualityDeltaMin: await getRuntimeSettingNumber('ingestion_parsing_promotion_quality_delta_min'),
          validationErrorMax: await getRuntimeSettingNumber('ingestion_parsing_promotion_validation_error_max'),
        } : undefined,
      },
      reason: reasonStr,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    clearExperimentConfigCache();
    res.json({ experiment: after });
  } catch (err) {
    logError('[admin] failed to update AI experiment', err);
    res.status(500).json({ error: 'Failed to update AI experiment' });
  }
});

router.get('/recommendations', async (req, res) => {
  try {
    const recommendations = await listAiRecommendations({
      status: typeof req.query.status === 'string' ? req.query.status as any : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 100,
    });
    res.json({ recommendations });
  } catch (err) {
    logError('[admin] failed to list AI recommendations', err);
    res.status(500).json({ error: 'Failed to list AI recommendations' });
  }
});

router.patch('/recommendations/:recommendationId', async (req, res) => {
  const recommendationId = String(req.params.recommendationId ?? '');
  const action = String(req.body?.action ?? '');
  const reasonStr = requireReason(req.body?.reason);
  if (!['apply', 'dismiss'].includes(action)) {
    res.status(400).json({ error: 'action must be apply or dismiss' });
    return;
  }
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const recommendation = await updateAiRecommendationStatus({
      recommendationId,
      status: action === 'apply' ? 'applied' : 'dismissed',
      respondedBy: actorId,
    });
    await writeAuditLog({
      actorUserId: actorId,
      action: action === 'apply' ? 'AI_RECOMMENDATION_APPLIED' : 'AI_RECOMMENDATION_DISMISSED',
      afterState: { recommendation },
      reason: reasonStr,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.json({ recommendation });
  } catch (err) {
    logError('[admin] failed to update AI recommendation', err);
    res.status(500).json({ error: 'Failed to update AI recommendation' });
  }
});

router.get('/ai-ops/executive', async (req, res) => {
  try {
    const range = req.query.range === '90d' || req.query.range === '180d' ? req.query.range : '30d';
    res.json({ summary: await getAiExecutiveSummary(range) });
  } catch (err) {
    logError('[admin] failed to load AI executive summary', err);
    res.status(500).json({ error: 'Failed to load AI executive summary' });
  }
});

router.post('/parsing-eval/replay', async (req, res) => {
  const { intakeId, dateFrom, dateTo, dryRun } = req.body ?? {};
  const isDryRun = dryRun !== false;
  try {
    if (typeof intakeId === 'string' && intakeId.trim()) {
      const trimmedIntakeId = intakeId.trim();
      const result = await replayParsingIntake({ intakeId: trimmedIntakeId, dryRun: isDryRun });
      await writeAuditLog({
        actorUserId: getActorId(req),
        action: 'ADMIN_SETTING_UPDATED',
        afterState: {
          action: 'PARSING_EVAL_REPLAY_REQUESTED',
          intakeId: trimmedIntakeId,
          dryRun: isDryRun,
          agreementRate: result.comparison.agreementRate,
          persistedCaptureId: result.persistedCaptureId,
        },
        reason: 'Parsing evaluation replay requested',
      });
      res.json({
        dryRun: isDryRun,
        intakeId: trimmedIntakeId,
        status: 'completed',
        overwriteOriginalCapture: false,
        productionItemCount: result.productionItemCount,
        llmItemCount: result.llmItemCount,
        comparison: result.comparison,
        persistedCaptureId: result.persistedCaptureId,
      });
      return;
    }
    if (typeof dateFrom === 'string' && typeof dateTo === 'string' && dateFrom.trim() && dateTo.trim()) {
      // Bounded batch: enumerate intakes with a parsing capture in range and
      // replay each one for real, capped to keep this endpoint's latency and
      // LLM spend predictable. Larger batches should be split into multiple
      // date-range calls rather than raising this cap.
      const BATCH_LIMIT = 25;
      const matches = await listLocalAiCaptures({ featureKey: 'parsing', dateFrom, dateTo, limit: BATCH_LIMIT });
      const intakeIds = Array.from(new Set(matches.map((m) => m.jobId).filter((id): id is string => Boolean(id))));

      const results = await Promise.all(
        intakeIds.map(async (id) => {
          try {
            const result = await replayParsingIntake({ intakeId: id, dryRun: isDryRun });
            return {
              intakeId: id,
              status: 'completed' as const,
              agreementRate: result.comparison.agreementRate,
              persistedCaptureId: result.persistedCaptureId,
            };
          } catch (err) {
            return {
              intakeId: id,
              status: 'failed' as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })
      );

      await writeAuditLog({
        actorUserId: getActorId(req),
        action: 'ADMIN_SETTING_UPDATED',
        afterState: {
          action: 'PARSING_EVAL_REPLAY_BATCH_REQUESTED',
          dateFrom,
          dateTo,
          dryRun: isDryRun,
          intakeCount: intakeIds.length,
        },
        reason: 'Parsing evaluation replay batch requested',
      });
      res.json({
        dryRun: isDryRun,
        dateFrom,
        dateTo,
        status: 'completed',
        overwriteOriginalCapture: false,
        batchLimit: BATCH_LIMIT,
        results,
      });
      return;
    }
    res.status(400).json({ error: 'intakeId or dateFrom/dateTo is required' });
  } catch (err) {
    if (err instanceof ReplayIntakeNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof ReplaySourceUnavailableError) {
      res.status(409).json({ error: err.message, code: 'REPLAY_SOURCE_UNAVAILABLE' });
      return;
    }
    logError('[admin] failed to request parsing eval replay', err);
    res.status(500).json({ error: 'Failed to request parsing eval replay' });
  }
});

router.get('/ai-captures', async (req, res) => {
  try {
    const query = {
      featureKey: typeof req.query.featureKey === 'string' ? req.query.featureKey : undefined,
      captureId: typeof req.query.captureId === 'string' ? req.query.captureId : undefined,
      correlationId: typeof req.query.correlationId === 'string' ? req.query.correlationId : undefined,
      jobId: typeof req.query.jobId === 'string' ? req.query.jobId : undefined,
      anonymousUserId: typeof req.query.anonymousUserId === 'string' ? req.query.anonymousUserId : undefined,
      provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
      model: typeof req.query.model === 'string' ? req.query.model : undefined,
      outcome: typeof req.query.outcome === 'string' ? req.query.outcome : undefined,
      dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
      dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
    };
    const captures = await listLocalAiCaptures(query);
    res.json({ captures, source: 'local_capture_archive' });
  } catch (err) {
    logError('[admin][ai-captures] failed to list captures', err);
    res.status(500).json({ error: 'Failed to list AI captures' });
  }
});

router.get('/analytics', async (req, res) => {
  try {
    const day = typeof req.query.day === 'string' && req.query.day.trim()
      ? req.query.day.trim()
      : new Date().toISOString().slice(0, 10);
    const run = req.query.run === '1' || req.query.run === 'true';
    const aggregation = run ? await runAiDailyAggregation({ day, jobId: `admin-ai-analytics-${day}` }) : null;
    const metrics = await listAiAnalyticsMetrics({
      periodType: 'day',
      periodStart: day,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 250,
    });
    res.json({
      day,
      aggregation,
      metrics,
      counters: getMetricCounterSnapshot(),
    });
  } catch (err) {
    logError('[admin][ai-analytics] failed to load analytics', err);
    res.status(500).json({ error: 'Failed to load AI analytics' });
  }
});

router.get('/runtime-settings', async (_req, res) => {
  try {
    const settings = await Promise.all(AI_RUNTIME_SETTING_KEYS.map(async (key) => {
      const row = await getAdminSetting(key);
      return row ?? {
        key,
        value: AI_RUNTIME_SETTING_DEFAULTS[key],
        updatedBy: null,
        updatedAt: null,
        source: 'default',
      };
    }));
    res.json({ settings });
  } catch (err) {
    logError('[admin][runtime-settings] failed to load settings', err);
    res.status(500).json({ error: 'Failed to load runtime settings' });
  }
});

router.patch('/runtime-settings', async (req, res) => {
  const { settings, reason } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    res.status(400).json({ error: 'settings object is required' });
    return;
  }
  const entries = Object.entries(settings as Record<string, unknown>)
    .filter(([key]) => AI_RUNTIME_SETTING_KEYS.includes(key as any));
  if (!entries.length) {
    res.status(400).json({ error: 'No supported runtime settings provided' });
    return;
  }
  for (const [key, value] of entries) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      res.status(400).json({ error: `${key} must be a non-negative number` });
      return;
    }
    if (key === 'shadow_parse_sample_rate_percent' && numeric > 100) {
      res.status(400).json({ error: `${key} must be between 0 and 100` });
      return;
    }
    if (key === 'ai_aggregation_run_hour_utc' && (!Number.isInteger(numeric) || numeric > 23)) {
      res.status(400).json({ error: `${key} must be an integer between 0 and 23` });
      return;
    }
  }

  try {
    const actorId = getActorId(req);
    const before = await Promise.all(entries.map(([key]) => getAdminSetting(key)));
    const updated = await Promise.all(entries.map(([key, value]) => setAdminSetting({
      key,
      value: String(value),
      updatedBy: actorId,
    })));
    await writeAuditLog({
      actorUserId: actorId,
      action: 'ADMIN_SETTING_UPDATED',
      beforeState: { settings: before },
      afterState: { settings: updated },
      reason: reasonStr,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.json({ settings: updated });
  } catch (err) {
    logError('[admin][runtime-settings] failed to update settings', err);
    res.status(500).json({ error: 'Failed to update runtime settings' });
  }
});

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

const listAdminFeatureFlags = async () => {
  const storedFlags = await listFeatureFlags();
  const seeds = getFeatureFlagSeeds();
  const now = new Date().toISOString();
  const mergedByKey = new Map(
    storedFlags.map((flag) => [
      flag.key,
      {
        ...flag,
        description: seeds[flag.key]?.description ?? null,
      },
    ])
  );

  for (const [key, seed] of Object.entries(seeds)) {
    if (mergedByKey.has(key)) continue;
    mergedByKey.set(key, {
      id: key,
      key,
      enabled: seed.enabled,
      scope: 'global' as const,
      updatedBy: null,
      updatedAt: now,
      createdAt: now,
      description: seed.description ?? null,
    });
  }

  return [...mergedByKey.values()].sort((a, b) => a.key.localeCompare(b.key));
};

router.get('/features', async (_req, res) => {
  try {
    const flags = await listAdminFeatureFlags();
    res.json({ features: flags });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list feature flags' });
  }
});

router.patch('/features/:key/flag', async (req, res) => {
  const { key } = req.params;
  const { enabled, reason } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled (boolean) is required' });
    return;
  }
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const flags = await listAdminFeatureFlags();
    const existing = flags.find(f => f.key === key);
    if (!existing) {
      res.status(404).json({ error: `Feature flag not found: ${key}` });
      return;
    }
    const previousEnabled = existing.enabled;
    await setFeatureFlag(key, enabled, actorId);
    const audit = await writeAuditLog({
      actorUserId: actorId,
      action: 'FEATURE_FLAG_UPDATED',
      beforeState: { key, enabled: previousEnabled },
      afterState: { key, enabled },
      reason: reasonStr,
    });
    res.json({ key, enabled, previousEnabled, auditId: audit.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update feature flag' });
  }
});

router.get('/packing-list-defaults', async (_req, res) => {
  try {
    const items = await getUniversalPackingList();
    res.json({ items });
  } catch (err) {
    logError('[admin] failed to list packing defaults', err);
    res.status(500).json({ error: 'Failed to list packing defaults' });
  }
});

router.put('/packing-list-defaults', async (req, res) => {
  try {
    const items = await replaceUniversalPackingList(Array.isArray(req.body?.items) ? req.body.items : []);
    await writeAuditLog({
      actorUserId: getActorId(req),
      action: 'PACKING_DEFAULTS_UPDATED',
      afterState: { packingListDefaultsCount: items.length },
      reason: typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Updated universal packing list defaults',
    });
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/packing-list-presets', async (_req, res) => {
  try {
    res.json({ presets: await listPackingPresetsV2(true) });
  } catch (err) {
    logError('[admin] failed to list packing presets', err);
    res.status(500).json({ error: 'Failed to list packing presets' });
  }
});

router.post('/packing-list-presets', async (req, res) => {
  try {
    const filename = String(req.body?.filename ?? '').trim().toLowerCase();
    const markdown = typeof req.body?.markdown === 'string' ? req.body.markdown : '';
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*\.md$/.test(filename) || !markdown) {
      res.status(400).json({ error: 'filename and markdown are required' });
      return;
    }
    if (filename === 'general.md') {
      res.status(400).json({ error: 'General is managed by the repository catalog' });
      return;
    }
    const general = parsePackingPresetDirectory().find((preset) => preset.key === 'general');
    const parsed = parsePresetMarkdown(markdown, filename, general?.items.map((item) => item.normalizedLabel) ?? []);
    const existing = (await listPackingPresetsV2(true)).filter((preset) => preset.isActive && preset.key !== parsed.key).map((preset) => ({
      key: preset.key,
      label: preset.label,
      description: preset.description,
      gendered: preset.gendered,
      contentHash: preset.contentHash,
      filename: preset.sourceFilename,
      items: preset.items.map((item) => ({ category: item.category, label: item.label, normalizedLabel: normalizePackingLabel(item.label), position: item.position })),
    }));
    const saved = await syncPackingPresetCatalogV2([...existing, { ...parsed, filename: `admin:${filename}` }]);
    invalidatePackingPresetCatalogCache();
    await writeAuditLog({ actorUserId: getActorId(req), action: 'PACKING_PRESET_UPLOADED', afterState: { key: parsed.key, filename }, reason: 'Uploaded packing preset markdown' });
    res.json({ preset: saved.find((preset) => preset.key === parsed.key) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/packing-list-presets/:presetKey', async (req, res) => {
  try {
    if (req.params.presetKey === 'general') {
      res.status(400).json({ error: 'General cannot be removed' });
      return;
    }
    await removePackingPresetV2(req.params.presetKey);
    invalidatePackingPresetCatalogCache();
    await writeAuditLog({ actorUserId: getActorId(req), action: 'PACKING_PRESET_REMOVED', afterState: { key: req.params.presetKey }, reason: 'Removed packing preset' });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/packing-list-presets/:presetKey/reactivate', async (req, res) => {
  try {
    if (req.params.presetKey === 'general') {
      res.status(400).json({ error: 'General is always active' });
      return;
    }
    await reactivatePackingPresetV2(req.params.presetKey);
    invalidatePackingPresetCatalogCache();
    await writeAuditLog({ actorUserId: getActorId(req), action: 'PACKING_PRESET_UPLOADED', afterState: { key: req.params.presetKey, active: true }, reason: 'Reactivated packing preset' });
    res.json({ presets: await listPackingPresetsV2(true) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put('/packing-list-presets/:presetKey', async (req, res) => {
  try {
    const preset = await updatePackingPresetV2(req.params.presetKey, {
      label: typeof req.body?.label === 'string' ? req.body.label : undefined,
      description: typeof req.body?.description === 'string' ? req.body.description : undefined,
      items: Array.isArray(req.body?.items) ? req.body.items : undefined,
    });
    if (!preset) {
      res.status(404).json({ error: 'Packing preset not found' });
      return;
    }
    invalidatePackingPresetCatalogCache();
    await writeAuditLog({ actorUserId: getActorId(req), action: 'PACKING_PRESET_UPLOADED', afterState: { key: req.params.presetKey, edited: true }, reason: 'Edited packing preset' });
    res.json({ preset });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

router.get('/users', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
  try {
    const result = await adminSearchUsers({ search, page, limit });
    res.json(result);
  } catch (err) {
    logError('[admin] failed to search users', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

router.get('/users/:userId', async (req, res) => {
  try {
    const user = await adminGetUser(req.params.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    logError('[admin] failed to get user', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

router.patch('/users/:userId/tier', async (req, res) => {
  const { tierKey, reason } = req.body ?? {};
  if (typeof tierKey !== 'string' || !tierKey.trim()) {
    res.status(400).json({ error: 'tierKey is required' });
    return;
  }
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const targetId = req.params.userId;
    const targetRole = await getUserRole(targetId);
    const resolvedTierKey = targetRole === 'admin' ? 'pro' : tierKey.trim();
    const before = await getCurrentUserTier(targetId);
    await setUserTier(targetId, resolvedTierKey, 'admin', actorId, reasonStr);
    const after = await getCurrentUserTier(targetId);
    await writeAuditLog({
      actorUserId: actorId,
      targetUserId: targetId,
      action: 'USER_TIER_CHANGED',
      beforeState: { tierKey: before?.tierKey ?? null, requestedTierKey: tierKey.trim() },
      afterState: { tierKey: after?.tierKey ?? null },
      reason: reasonStr,
    });
    res.json({ userId: targetId, tierKey: after?.tierKey ?? null, lockedToPro: targetRole === 'admin' });
  } catch (err: any) {
    if (/not found/i.test(err?.message ?? '')) {
      res.status(404).json({ error: err.message });
      return;
    }
    logError('[admin] failed to change user tier', err);
    res.status(500).json({ error: 'Failed to change user tier' });
  }
});

/**
 * Bulk set the tier for up to 100 users in a single request. Mirrors the
 * ingestion bulk-action convention: per-id try/catch, dedupe + empty-id strip
 * in the DTO, and 207 Multi-Status when any id fails so partial success is
 * first-class. Admin-role targets are resolved to 'pro' server-side (matching
 * the single-user PATCH); this is surfaced in the response as `lockedToPro`
 * and does not count as a failure.
 */
router.post('/users/bulk-tier', async (req, res) => {
  const dto = readDto(bulkSetUserTierDto, req.body, res);
  if (!dto) return;
  const actorId = getActorId(req);
  const tierKey = dto.tierKey;
  const reason = dto.reason;

  const updated: Array<{ id: string; tierKey: string; lockedToPro: boolean }> = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const targetId of dto.ids) {
    try {
      const targetUser = await adminGetUser(targetId);
      if (!targetUser) {
        failed.push({ id: targetId, reason: 'User not found' });
        continue;
      }
      const resolvedTierKey = targetUser.role === 'admin' ? 'pro' : tierKey;
      const before = await getCurrentUserTier(targetId);
      await setUserTier(targetId, resolvedTierKey, 'admin', actorId, reason);
      const after = await getCurrentUserTier(targetId);
      await writeAuditLog({
        actorUserId: actorId,
        targetUserId: targetId,
        action: 'USER_TIER_CHANGED',
        beforeState: { tierKey: before?.tierKey ?? null, requestedTierKey: tierKey },
        afterState: { tierKey: after?.tierKey ?? null, bulk: true },
        reason,
      });
      updated.push({
        id: targetId,
        tierKey: after?.tierKey ?? resolvedTierKey,
        lockedToPro: targetUser.role === 'admin',
      });
    } catch (err: any) {
      const message = String(err?.message ?? 'Tier change failed');
      logError('[admin] bulk tier change: per-id failure', { targetId, err: message });
      failed.push({ id: targetId, reason: message });
    }
  }

  res.status(failed.length > 0 ? 207 : 200).json({ updated, failed });
});

/**
 * Bulk change the role for up to 100 users. Mirrors the bulk-tier pattern
 * (100-id cap, per-id try/catch, 207 Multi-Status when any id fails, per-id
 * audit log entries). Critical guardrail: the acting admin cannot demote
 * THEIR OWN account in a bulk update — self-demotion would lock an admin
 * out of follow-up recovery. That single id is surfaced in `failed` with a
 * clear reason; the rest of the batch still proceeds.
 *
 * Granting admin also auto-assigns Pro tier (parity with the single-user
 * PATCH at `/users/:userId/role`). The tier change writes its own audit
 * entry via `setUserTier`.
 */
router.post('/users/bulk-role', async (req, res) => {
  const dto = readDto(bulkSetUserRoleDto, req.body, res);
  if (!dto) return;
  const actorId = getActorId(req);
  const role = dto.role;
  const reason = dto.reason;

  const updated: Array<{ id: string; role: 'admin' | 'user'; previousRole: string | null }> = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const targetId of dto.ids) {
    try {
      if (actorId === targetId && role !== 'admin') {
        failed.push({ id: targetId, reason: 'Admins cannot revoke their own admin role' });
        continue;
      }
      const previousRole = await getUserRole(targetId);
      await setUserRole(targetId, role);
      if (role === 'admin') {
        await setUserTier(targetId, 'pro', 'admin', actorId, 'Admin users are automatically assigned Pro tier');
      }
      await writeAuditLog({
        actorUserId: actorId,
        targetUserId: targetId,
        action: role === 'admin' ? 'USER_ROLE_GRANTED' : 'USER_ROLE_REVOKED',
        beforeState: { role: previousRole },
        afterState: { role, bulk: true },
        reason,
      });
      updated.push({ id: targetId, role, previousRole });
    } catch (err: any) {
      const message = String(err?.message ?? 'Role change failed');
      logError('[admin] bulk role change: per-id failure', { targetId, err: message });
      failed.push({ id: targetId, reason: message });
    }
  }

  res.status(failed.length > 0 ? 207 : 200).json({ updated, failed });
});

router.patch('/users/:userId/role', async (req, res) => {
  const { role, reason } = req.body ?? {};
  if (role !== 'admin' && role !== 'user') {
    res.status(400).json({ error: 'role must be "admin" or "user"' });
    return;
  }
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const targetId = req.params.userId;
    if (actorId === targetId && role !== 'admin') {
      res.status(403).json({ error: 'Admins cannot revoke their own admin role' });
      return;
    }
    const previousRole = await getUserRole(targetId);
    await setUserRole(targetId, role);
    if (role === 'admin') {
      await setUserTier(targetId, 'pro', 'admin', actorId, 'Admin users are automatically assigned Pro tier');
    }
    await writeAuditLog({
      actorUserId: actorId,
      targetUserId: targetId,
      action: role === 'admin' ? 'USER_ROLE_GRANTED' : 'USER_ROLE_REVOKED',
      beforeState: { role: previousRole },
      afterState: { role },
      reason: reasonStr,
    });
    res.json({ userId: targetId, role, previousRole });
  } catch (err) {
    logError('[admin] failed to change user role', err);
    res.status(500).json({ error: 'Failed to change user role' });
  }
});

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

router.get('/tiers', async (_req, res) => {
  try {
    const tiers = await listTiers();
    const features = await listFeatures();
    const result = await Promise.all(
      tiers.map(async tier => {
        const limits = await listTierLimits(tier.id);
        const entitlements = await listTierEntitlements(tier.id);
        return {
          ...tier,
          limits,
          entitlements: entitlements.map(e => ({
            ...e,
            featureKey: features.find(f => f.id === e.featureId)?.key ?? null,
          })),
        };
      })
    );
    res.json({ tiers: result });
  } catch (err) {
    logError('[admin] failed to list tiers', err);
    res.status(500).json({ error: 'Failed to list tiers' });
  }
});

router.patch('/tiers/:tierKey/limits/:limitKey', async (req, res) => {
  const { tierKey, limitKey } = req.params;
  const { limitValue, reason } = req.body ?? {};
  if (typeof limitValue !== 'number' || !Number.isFinite(limitValue)) {
    res.status(400).json({ error: 'limitValue (number) is required' });
    return;
  }
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const tier = await getTierByKey(tierKey);
    if (!tier) {
      res.status(404).json({ error: `Tier not found: ${tierKey}` });
      return;
    }
    const limits = await listTierLimits(tier.id);
    const before = limits.find(l => l.limitKey === limitKey)?.limitValue ?? null;
    await upsertTierLimit(tier.id, limitKey, limitValue);
    await writeAuditLog({
      actorUserId: actorId,
      action: 'TIER_LIMIT_UPDATED',
      beforeState: { tierKey, limitKey, limitValue: before },
      afterState: { tierKey, limitKey, limitValue },
      reason: reasonStr,
    });
    res.json({ tierKey, limitKey, limitValue, previous: before });
  } catch (err) {
    logError('[admin] failed to upsert tier limit', err);
    res.status(500).json({ error: 'Failed to update tier limit' });
  }
});

router.patch('/tiers/:tierKey/features/:featureKey', async (req, res) => {
  const { tierKey, featureKey } = req.params;
  const { isAllowed, reason } = req.body ?? {};
  if (typeof isAllowed !== 'boolean') {
    res.status(400).json({ error: 'isAllowed (boolean) is required' });
    return;
  }
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  try {
    const actorId = getActorId(req);
    const tiers = await listTiers();
    const tier = await getTierByKey(tierKey);
    if (!tier) {
      res.status(404).json({ error: `Tier not found: ${tierKey}` });
      return;
    }
    const features = await listFeatures();
    const feature = features.find(f => f.key === featureKey);
    if (!feature) {
      res.status(404).json({ error: `Feature not found: ${featureKey}` });
      return;
    }
    const entitlements = await listTierEntitlements(tier.id);
    const before = entitlements.find(e => e.featureId === feature.id)?.isAllowed ?? null;
    if (before === null) {
      const inheritedSourceTiers = tiers
        .filter((candidate) => candidate.rank < tier.rank)
        .sort((a, b) => b.rank - a.rank);
      for (const sourceTier of inheritedSourceTiers) {
        const sourceEntitlements = await listTierEntitlements(sourceTier.id);
        const sourceMatch = sourceEntitlements.find((entry) => entry.featureId === feature.id);
        if (sourceMatch) {
          res.status(409).json({
            error: `Feature '${featureKey}' is inherited from '${sourceTier.key}'. Update the lower tier first.`,
            inheritedFromTierKey: sourceTier.key,
            inheritedValue: sourceMatch.isAllowed,
          });
          return;
        }
      }
    }
    await upsertTierEntitlement(tier.id, feature.id, isAllowed);
    await writeAuditLog({
      actorUserId: actorId,
      action: 'TIER_ENTITLEMENT_UPDATED',
      beforeState: { tierKey, featureKey, isAllowed: before },
      afterState: { tierKey, featureKey, isAllowed },
      reason: reasonStr,
    });
    res.json({ tierKey, featureKey, isAllowed, previous: before });
  } catch (err) {
    logError('[admin] failed to upsert tier entitlement', err);
    res.status(500).json({ error: 'Failed to update tier entitlement' });
  }
});

// ---------------------------------------------------------------------------
// User data (aggregate stats)
// ---------------------------------------------------------------------------

router.get('/user-data', async (req, res) => {
  const windowParam = req.query.window as string | undefined;
  const window = (windowParam === '7d' || windowParam === '30d' || windowParam === 'all-time')
    ? windowParam
    : undefined;
  const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
  try {
    const result = await adminGetUserData({ window, page, limit });
    res.json(result);
  } catch (err) {
    logError('[admin] failed to get user data', err);
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

router.get('/audit-log', async (req, res) => {
  const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
  const actorUserId = typeof req.query.actorUserId === 'string' ? req.query.actorUserId : undefined;
  const targetUserId = typeof req.query.targetUserId === 'string' ? req.query.targetUserId : undefined;
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  try {
    const result = await listAuditLog({ page, limit, actorUserId, targetUserId, action });
    res.json(result);
  } catch (err) {
    logError('[admin] failed to list audit log', err);
    res.status(500).json({ error: 'Failed to list audit log' });
  }
});

// ---------------------------------------------------------------------------
// API Limits
// ---------------------------------------------------------------------------

router.get('/api-limits', async (_req, res) => {
  try {
    const config = getApiLimitsConfig();
    const [usage, budgets, featureFlags] = await Promise.all([getApiUsageSummary(), getApiBudgetSummary(), listAdminFeatureFlags()]);
    const providers = Object.entries(config.providers).map(([provider, providerConfig]) => ({
      budgetingModels: Object.entries(getApiBudgetProviderConfig(provider)?.models ?? {}).map(([model, pricing]) => ({
        model,
        inputCostPer1MTokensUsd: pricing.inputCostPer1MTokensUsd,
        outputCostPer1MTokensUsd: pricing.outputCostPer1MTokensUsd,
      })),
      provider,
      window: providerConfig.window ?? 'day',
      windowHours: providerConfig.windowHours ?? 1,
      overallLimit: providerConfig.overall ?? null,
      monthlyBudgetUsd: budgets.find((entry) => entry.provider === provider)?.monthlyBudgetUsd ?? null,
      estimatedSpendUsd: budgets.find((entry) => entry.provider === provider)?.estimatedSpendUsd ?? 0,
      budgetWindowKey: budgets.find((entry) => entry.provider === provider)?.windowKey ?? null,
      budgetUsagePercent: budgets.find((entry) => entry.provider === provider)?.budgetUsagePercent ?? null,
      budgetAlertThresholdPercent: budgets.find((entry) => entry.provider === provider)?.alertThresholdPercent ?? null,
      isBudgetExceeded: budgets.find((entry) => entry.provider === provider)?.isOverBudget ?? false,
      callers: Object.entries(providerConfig.callers).map(([caller, limit]) => ({
        caller,
        limit,
        currentUsage: usage.find((u) => u.provider === provider && u.caller === caller)?.used ?? 0,
      })),
      overallUsage: usage.find((u) => u.provider === provider && u.scope === 'overall')?.used ?? 0,
    }));
    const gygProvider = providers.find((provider) => provider.provider === 'GETYOURGUIDE') ?? null;
    const gygConfig = getGetYourGuidePartnerConfig();
    res.json({
      providers,
      caching: config.caching,
      getYourGuide: {
        featureEnabled: featureFlags.find((flag) => flag.key === GETYOURGUIDE_FEATURE_FLAG)?.enabled === true,
        partnerConfigured: Boolean(gygConfig.partnerId),
        apiConfigured: Boolean(gygConfig.apiBaseUrl && gygConfig.hasApiToken),
        cachePermission: gygConfig.hasApiCachePermission,
        provider: gygProvider,
        observability: getGetYourGuideObservabilitySnapshot(),
        circuit: getGetYourGuideApiCircuitStatus(),
        revenueDashboard: 'separate',
      },
    });
  } catch (err) {
    logError('[admin] failed to get api limits', err);
    res.status(500).json({ error: 'Failed to get API limits' });
  }
});

router.patch('/api-limits/:provider', async (req, res) => {
  const { provider } = req.params;
  const { window, windowHours, overallLimit, callers, monthlyBudgetUsd, alertThresholdPercent, budgetingModels, reason } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  if (window !== 'hour' && window !== 'day') {
    res.status(400).json({ error: 'window must be "hour" or "day"' });
    return;
  }
  if (typeof windowHours !== 'number' || !Number.isFinite(windowHours) || windowHours <= 0) {
    res.status(400).json({ error: 'windowHours must be a positive number' });
    return;
  }
  if (overallLimit !== null && (typeof overallLimit !== 'number' || !Number.isFinite(overallLimit) || overallLimit <= 0)) {
    res.status(400).json({ error: 'overallLimit must be null or a positive number' });
    return;
  }
  if (typeof callers !== 'object' || callers === null || Array.isArray(callers)) {
    res.status(400).json({ error: 'callers must be an object of positive numeric limits' });
    return;
  }
  if (
    monthlyBudgetUsd !== null &&
    typeof monthlyBudgetUsd !== 'undefined' &&
    (!Number.isFinite(Number(monthlyBudgetUsd)) || Number(monthlyBudgetUsd) <= 0)
  ) {
    res.status(400).json({ error: 'monthlyBudgetUsd must be null or a positive number' });
    return;
  }
  if (
    alertThresholdPercent !== null &&
    typeof alertThresholdPercent !== 'undefined' &&
    (!Number.isFinite(Number(alertThresholdPercent)) || Number(alertThresholdPercent) <= 0 || Number(alertThresholdPercent) > 100)
  ) {
    res.status(400).json({ error: 'alertThresholdPercent must be null or a number between 0 and 100' });
    return;
  }
  if (
    typeof budgetingModels !== 'undefined' &&
    (typeof budgetingModels !== 'object' || budgetingModels === null || Array.isArray(budgetingModels))
  ) {
    res.status(400).json({ error: 'budgetingModels must be an object keyed by model name' });
    return;
  }

  try {
    const actorId = getActorId(req);
    const config = getApiLimitsConfig();
    const normalizedProvider = normalizeApiLimitKeyPart(provider);
    const currentProvider = config.providers[normalizedProvider];
    if (!currentProvider) {
      res.status(404).json({ error: `API provider not found: ${provider}` });
      return;
    }

    const normalizedCallers = Object.fromEntries(
      Object.entries(callers as Record<string, unknown>).map(([callerKey, rawLimit]) => [
        normalizeApiLimitKeyPart(callerKey),
        Number(rawLimit),
      ])
    );
    const unknownCallers = Object.keys(normalizedCallers).filter((callerKey) => !(callerKey in currentProvider.callers));
    if (unknownCallers.length > 0) {
      res.status(400).json({ error: `Unknown caller limits: ${unknownCallers.join(', ')}` });
      return;
    }
    const invalidCallers = Object.entries(normalizedCallers).filter(([, limit]) => !Number.isFinite(limit) || limit <= 0);
    if (invalidCallers.length > 0) {
      res.status(400).json({ error: 'All caller limits must be positive numbers' });
      return;
    }
    const currentBudgeting = getApiBudgetProviderConfig(normalizedProvider);
    const normalizedBudgetingModels = Object.fromEntries(
      Object.entries((budgetingModels as Record<string, any> | undefined) ?? {}).map(([modelKey, rawPricing]) => [
        normalizeApiLimitKeyPart(modelKey),
        {
          inputCostPer1MTokensUsd: Number(rawPricing?.inputCostPer1MTokensUsd),
          outputCostPer1MTokensUsd: Number(rawPricing?.outputCostPer1MTokensUsd),
        },
      ])
    );
    const mergedBudgetingModels = Object.fromEntries(
      Object.entries(currentBudgeting?.models ?? {}).map(([modelKey, pricing]) => [
        modelKey,
        {
          inputCostPer1MTokensUsd:
            normalizedBudgetingModels[modelKey]?.inputCostPer1MTokensUsd ?? pricing.inputCostPer1MTokensUsd,
          outputCostPer1MTokensUsd:
            normalizedBudgetingModels[modelKey]?.outputCostPer1MTokensUsd ?? pricing.outputCostPer1MTokensUsd,
        },
      ])
    );
    for (const [modelKey, pricing] of Object.entries(normalizedBudgetingModels)) {
      if (!(modelKey in mergedBudgetingModels)) {
        mergedBudgetingModels[modelKey] = pricing;
      }
    }
    const invalidBudgetingModel = Object.entries(mergedBudgetingModels).find(
      ([, pricing]) =>
        !Number.isFinite(pricing.inputCostPer1MTokensUsd) ||
        pricing.inputCostPer1MTokensUsd <= 0 ||
        !Number.isFinite(pricing.outputCostPer1MTokensUsd) ||
        pricing.outputCostPer1MTokensUsd <= 0
    );
    if (invalidBudgetingModel) {
      res.status(400).json({ error: `All model pricing values must be positive numbers (${invalidBudgetingModel[0]})` });
      return;
    }

    const nextProvider = {
      window,
      windowHours: Math.floor(windowHours),
      overall: overallLimit === null ? null : Math.floor(overallLimit),
      callers: Object.fromEntries(
        Object.keys(currentProvider.callers).map((callerKey) => [
          callerKey,
          Math.floor(normalizedCallers[callerKey] ?? currentProvider.callers[callerKey]),
        ])
      ),
    };
    const nextBudgeting = {
      monthlyBudgetUsd:
        monthlyBudgetUsd === null
          ? null
          : typeof monthlyBudgetUsd === 'undefined'
            ? (currentBudgeting?.monthlyBudgetUsd ?? null)
            : Number(monthlyBudgetUsd),
      alertThresholdPercent:
        alertThresholdPercent === null
          ? null
          : typeof alertThresholdPercent === 'undefined'
            ? (currentBudgeting?.alertThresholdPercent ?? null)
            : Number(alertThresholdPercent),
      models: mergedBudgetingModels,
    };

    updateApiLimitProviderConfig(normalizedProvider, nextProvider);
    updateApiBudgetProviderConfig(normalizedProvider, nextBudgeting);
    await writeAuditLog({
      actorUserId: actorId,
      action: 'API_LIMITS_UPDATED',
      beforeState: {
        provider: normalizedProvider,
        window: currentProvider.window ?? 'day',
        windowHours: currentProvider.windowHours ?? 1,
        overallLimit: currentProvider.overall ?? null,
        callers: currentProvider.callers,
        budgeting: {
          monthlyBudgetUsd: currentBudgeting?.monthlyBudgetUsd ?? null,
          alertThresholdPercent: currentBudgeting?.alertThresholdPercent ?? null,
          models: currentBudgeting?.models ?? {},
        },
      },
      afterState: {
        provider: normalizedProvider,
        window: nextProvider.window,
        windowHours: nextProvider.windowHours,
        overallLimit: nextProvider.overall,
        callers: nextProvider.callers,
        budgeting: nextBudgeting,
      },
      reason: reasonStr,
    });

    res.json({
      provider: normalizedProvider,
      window: nextProvider.window,
      windowHours: nextProvider.windowHours,
      overallLimit: nextProvider.overall,
      callers: nextProvider.callers,
      monthlyBudgetUsd: nextBudgeting.monthlyBudgetUsd,
      alertThresholdPercent: nextBudgeting.alertThresholdPercent,
      budgetingModels: nextBudgeting.models,
    });
  } catch (err) {
    logError('[admin] failed to update api limits', err);
    res.status(500).json({ error: 'Failed to update API limits' });
  }
});

router.patch('/api-limits/caching/:group', async (req, res) => {
  const { group } = req.params;
  const { values, reason } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    res.status(400).json({ error: 'values must be an object of positive integer settings' });
    return;
  }

  try {
    const config = getApiLimitsConfig();
    const normalizedGroup = normalizeApiLimitKeyPart(group);
    const currentGroup = config.caching[normalizedGroup];
    if (!currentGroup) {
      res.status(404).json({ error: `Caching group not found: ${group}` });
      return;
    }

    const normalizedValues = Object.fromEntries(
      Object.entries(values as Record<string, unknown>).map(([key, value]) => [normalizeApiLimitKeyPart(key), Number(value)])
    );
    const unknownKeys = Object.keys(normalizedValues).filter((key) => !(key in currentGroup));
    if (unknownKeys.length > 0) {
      res.status(400).json({ error: `Unknown caching settings: ${unknownKeys.join(', ')}` });
      return;
    }
    const invalid = Object.entries(normalizedValues).filter(([, value]) => !Number.isFinite(value) || value <= 0 || !Number.isInteger(value));
    if (invalid.length > 0) {
      res.status(400).json({ error: 'All caching settings must be positive integers' });
      return;
    }

    const merged = { ...currentGroup, ...normalizedValues };
    const actorId = getActorId(req);
    updateApiCachingConfig(normalizedGroup, merged);
    await writeAuditLog({
      actorUserId: actorId,
      action: 'API_CACHING_CONFIG_UPDATED',
      beforeState: { group: normalizedGroup, values: currentGroup },
      afterState: { group: normalizedGroup, values: merged },
      reason: reasonStr,
    });

    res.json({ group: normalizedGroup, values: merged });
  } catch (err) {
    logError('[admin] failed to update api caching config', err);
    res.status(500).json({ error: 'Failed to update API caching config' });
  }
});

// ---------------------------------------------------------------------------
// Cost estimator (Phase 3 of cost-estimator-admin-panel-plan.md)
// ---------------------------------------------------------------------------

router.get('/cost-estimate', async (req, res) => {
  try {
    const monthsBackParam = Number(req.query.monthsBack);
    // Keep the admin endpoint bounded even if a client submits an untrusted
    // lookback value; the database retains history, but the UI only needs a
    // practical reporting window.
    const monthsBack = Number.isFinite(monthsBackParam) && monthsBackParam > 0
      ? Math.min(36, Math.floor(monthsBackParam))
      : 6;
    const config = await getCostEstimatorConfig();
    const [projected, actualMonths] = await Promise.all([
      Promise.resolve(computeProjectedMonthlyCost(config)),
      getActualMonthlySpend(monthsBack),
    ]);
    res.json({
      assumptions: config.assumptions,
      requestPricing: config.requestPricing,
      hostingLineItems: config.hostingLineItems,
      projected,
      actual: { months: actualMonths },
    });
  } catch (err) {
    logError('[admin] failed to get cost estimate', err);
    res.status(500).json({ error: 'Failed to get cost estimate' });
  }
});

router.patch('/cost-estimate/assumptions', async (req, res) => {
  const { reason, ...assumptions } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  if (typeof assumptions !== 'object' || assumptions === null || Array.isArray(assumptions)) {
    res.status(400).json({ error: 'request body must be an object of assumption fields plus reason' });
    return;
  }
  const NUMERIC_FIELDS = [
    'totalUsers',
    'premiumConversionPercent',
    'freeGenerationsPerMonth',
    'premiumGenerationsPerMonth',
    'costPerGenerationUsd',
    'stripeFeePercent',
    'stripeFeeFixedUsd',
  ] as const;
  for (const field of NUMERIC_FIELDS) {
    const value = (assumptions as Record<string, unknown>)[field];
    if (typeof value !== 'undefined' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
      res.status(400).json({ error: `${field} must be a non-negative number` });
      return;
    }
  }
  if (typeof assumptions.premiumConversionPercent !== 'undefined' && Number(assumptions.premiumConversionPercent) > 100) {
    res.status(400).json({ error: 'premiumConversionPercent must be between 0 and 100' });
    return;
  }
  if (
    typeof assumptions.premiumMonthlyPriceUsdOverride !== 'undefined' &&
    assumptions.premiumMonthlyPriceUsdOverride !== null &&
    (!Number.isFinite(Number(assumptions.premiumMonthlyPriceUsdOverride)) || Number(assumptions.premiumMonthlyPriceUsdOverride) < 0)
  ) {
    res.status(400).json({ error: 'premiumMonthlyPriceUsdOverride must be null or a non-negative number' });
    return;
  }
  if (
    typeof assumptions.providerCallsPerUserPerMonth !== 'undefined' &&
    (typeof assumptions.providerCallsPerUserPerMonth !== 'object' ||
      assumptions.providerCallsPerUserPerMonth === null ||
      Array.isArray(assumptions.providerCallsPerUserPerMonth))
  ) {
    res.status(400).json({ error: 'providerCallsPerUserPerMonth must be an object of non-negative numbers' });
    return;
  }
  if (typeof assumptions.providerCallsPerUserPerMonth !== 'undefined') {
    const unknownProvider = Object.keys(assumptions.providerCallsPerUserPerMonth as Record<string, unknown>)
      .map((provider) => normalizeApiLimitKeyPart(provider))
      .find((provider) => !(REQUEST_PRICED_PROVIDER_KEYS as readonly string[]).includes(provider));
    if (unknownProvider) {
      res.status(400).json({ error: `providerCallsPerUserPerMonth.${unknownProvider} is not a request-priced provider` });
      return;
    }
    const invalidVolume = Object.entries(assumptions.providerCallsPerUserPerMonth as Record<string, unknown>)
      .find(([, value]) => !Number.isFinite(Number(value)) || Number(value) < 0);
    if (invalidVolume) {
      res.status(400).json({ error: `providerCallsPerUserPerMonth.${invalidVolume[0]} must be a non-negative number` });
      return;
    }
  }

  try {
    const actorId = getActorId(req);
    const config = await updateCostEstimatorConfig({ assumptions, actorId, reason: reasonStr });
    res.json(config);
  } catch (err) {
    logError('[admin] failed to update cost estimator assumptions', err);
    res.status(500).json({ error: 'Failed to update cost estimator assumptions' });
  }
});

router.patch('/cost-estimate/request-pricing', async (req, res) => {
  const { reason, requestPricing } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  if (typeof requestPricing !== 'object' || requestPricing === null || Array.isArray(requestPricing)) {
    res.status(400).json({ error: 'requestPricing must be an object of non-negative per-provider prices' });
    return;
  }
  const invalidEntry = Object.entries(requestPricing as Record<string, unknown>).find(
    ([provider, value]) => !(REQUEST_PRICED_PROVIDER_KEYS as readonly string[]).includes(normalizeApiLimitKeyPart(provider)) || !Number.isFinite(Number(value)) || Number(value) < 0
  );
  if (invalidEntry) {
    const provider = normalizeApiLimitKeyPart(invalidEntry[0]);
    res.status(400).json({ error: (REQUEST_PRICED_PROVIDER_KEYS as readonly string[]).includes(provider)
      ? `requestPricing.${invalidEntry[0]} must be a non-negative number`
      : `requestPricing.${invalidEntry[0]} is not a request-priced provider` });
    return;
  }

  try {
    const actorId = getActorId(req);
    const config = await updateCostEstimatorRequestPricing({ requestPricing, actorId, reason: reasonStr });
    res.json(config);
  } catch (err) {
    logError('[admin] failed to update cost estimator request pricing', err);
    res.status(500).json({ error: 'Failed to update cost estimator request pricing' });
  }
});

router.patch('/cost-estimate/hosting', async (req, res) => {
  const { reason, hostingLineItems } = req.body ?? {};
  const reasonStr = requireReason(reason);
  if (!reasonStr) {
    res.status(400).json({ error: 'reason (min 3 chars) is required' });
    return;
  }
  if (!Array.isArray(hostingLineItems)) {
    res.status(400).json({ error: 'hostingLineItems must be an array' });
    return;
  }
  const invalidItem = hostingLineItems.find(
    (item: any) =>
      typeof item?.id !== 'string' ||
      !item.id.trim() ||
      typeof item?.name !== 'string' ||
      !item.name.trim() ||
      !Number.isFinite(Number(item?.monthlyCostUsd)) ||
      Number(item.monthlyCostUsd) < 0
  );
  if (invalidItem) {
    res.status(400).json({ error: 'each hosting line item requires a non-empty id, a non-empty name, and a non-negative monthlyCostUsd' });
    return;
  }

  try {
    const actorId = getActorId(req);
    const config = await updateCostEstimatorConfig({ hostingLineItems, actorId, reason: reasonStr });
    res.json(config);
  } catch (err) {
    logError('[admin] failed to update cost estimator hosting line items', err);
    res.status(500).json({ error: 'Failed to update cost estimator hosting line items' });
  }
});

// ---------------------------------------------------------------------------
// Metrics snapshot (in-process counters + cache hit-rate)
// ---------------------------------------------------------------------------

router.get('/metrics', (_req, res) => {
  // Per-instance best-effort aggregation — if the deployment has multiple
  // instances each returns its own counters. Client should label accordingly.
  res.json(getMetricCounterSnapshot());
});

// ---------------------------------------------------------------------------
// Ingestion queue depth — import_jobs grouped by state (live, not a cache)
// ---------------------------------------------------------------------------

/**
 * Returns `{ countsByState: { PENDING: N, PROCESSING: N, FAILED: N, ... },
 * totalActive: N, totalTerminal: N, snapshotAtIso }`. Powers the AdminTab
 * queue-depth card and gives operators an at-a-glance view of how many
 * imports are stuck in retriable vs terminal states without having to shell
 * into Prometheus.
 */
router.get('/ingestion-queue-depth', async (_req, res) => {
  try {
    const countsByState = await countImportJobsByState();
    const ACTIVE = new Set(['PENDING', 'QUEUED', 'NORMALIZING', 'PARSING', 'AWAITING_REVIEW', 'PROCESSING']);
    const TERMINAL = new Set(['COMPLETED', 'DEAD_LETTERED', 'CANCELLED']);
    let totalActive = 0;
    let totalTerminal = 0;
    for (const [state, count] of Object.entries(countsByState)) {
      if (ACTIVE.has(state)) totalActive += count;
      else if (TERMINAL.has(state)) totalTerminal += count;
    }
    res.json({
      countsByState,
      totalActive,
      totalTerminal,
      failedRetriable: countsByState.FAILED ?? 0,
      snapshotAtIso: new Date().toISOString(),
    });
  } catch (err) {
    logError('[admin] failed to compute ingestion queue depth', err);
    res.status(500).json({ error: 'Failed to compute queue depth' });
  }
});

// ---------------------------------------------------------------------------
// Data deletion jobs (Gmail/ingestion provider disconnect observability)
// ---------------------------------------------------------------------------

const VALID_DELETION_STATES: readonly DataDeletionJobState[] = ['pending', 'running', 'succeeded', 'failed'];

// ---------------------------------------------------------------------------
// Attraction duration/description ("activityContext") cache invalidation.
// Lets an operator bust the cached Wikipedia-backed duration metadata for a
// single attraction (destinationKey + name) or a whole destination
// (destinationKey only) without a code deploy or waiting out
// durationMetadataRefreshDays, per itinerary-improvements-coding-plan.md
// Phase 2C "Maintainability".
// ---------------------------------------------------------------------------
router.post('/attractions/duration-metadata/invalidate', async (req, res) => {
  const destinationKey = typeof req.body?.destinationKey === 'string' ? req.body.destinationKey.trim() : '';
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null;
  if (!destinationKey) {
    res.status(400).json({ error: 'destinationKey is required' });
    return;
  }
  try {
    const deletedCount = await deleteAttractionDurationMetadata(destinationKey, name);
    const actorId = (req as any).user ? ((req as any).user as TokenPayload).userId : null;
    try {
      await writeAuditLog({
        actorUserId: actorId,
        action: 'ATTRACTION_DURATION_METADATA_CACHE_INVALIDATED' as any,
        beforeState: { destinationKey, name },
        afterState: { deletedCount },
        reason: name
          ? `Invalidate cached duration/description metadata for "${name}" in ${destinationKey}`
          : `Invalidate all cached duration/description metadata for ${destinationKey}`,
      });
    } catch (err) {
      logError('[admin] audit write failed on duration-metadata cache invalidate', err);
    }
    res.json({ destinationKey, name, deletedCount });
  } catch (err) {
    logError('[admin] failed to invalidate attraction duration metadata cache', err);
    res.status(500).json({ error: 'Failed to invalidate attraction duration metadata cache' });
  }
});

router.get('/data-deletion-jobs', async (req, res) => {
  const stateParam = typeof req.query.state === 'string' ? req.query.state : undefined;
  const state = stateParam && VALID_DELETION_STATES.includes(stateParam as DataDeletionJobState)
    ? (stateParam as DataDeletionJobState)
    : undefined;
  if (stateParam && !state) {
    res.status(400).json({ error: `state must be one of: ${VALID_DELETION_STATES.join(', ')}` });
    return;
  }
  const userId = typeof req.query.userId === 'string' && req.query.userId.trim() ? req.query.userId.trim() : undefined;
  const limitParam = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
  const limit = Number.isFinite(limitParam) && (limitParam as number) > 0 ? (limitParam as number) : undefined;
  try {
    const jobs = await listDataDeletionJobs({ state, userId, limit });
    res.json({ jobs });
  } catch (err) {
    logError('[admin] failed to list data deletion jobs', err);
    res.status(500).json({ error: 'Failed to list data deletion jobs' });
  }
});

export default router;
