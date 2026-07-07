export type AiOpsSection =
  | 'overview'
  | 'providers'
  | 'experiments'
  | 'recommendations'
  | 'captures'
  | 'parser-quality'
  | 'shadow-replay'
  | 'executive'
  | 'runtime-settings'
  | 'ai-audit-log';

export type AiProviderOption = { id: string; configured: boolean; registered: boolean; certified?: boolean; supportedModels: string[] };
export type AiProviderFeatureConfig = {
  featureKey: string;
  provider: string;
  model: string;
  enabled: boolean;
  updatedBy?: string | null;
  updatedAt?: string | null;
};
export type AiRuntimeSetting = { key: string; value: string; updatedBy?: string | null; updatedAt?: string | null; source?: string };
export type AiCaptureItem = {
  captureId: string;
  featureKey: string;
  capturedAt: string;
  anonymousUserId?: string;
  provider?: string;
  model?: string;
  outcome: string;
};
export type AiAnalyticsMetric = {
  table: string;
  periodStart: string;
  periodType: string;
  dimensions: Record<string, string>;
  metricKey: string;
  metricValue: number;
};
export type AiExperiment = {
  experimentId: string;
  name: string;
  featureKey: string;
  experimentKind: string;
  status: string;
  variants: Array<{ variantId: string; trafficPercent: number; provider?: string; model?: string }>;
};
export type AiRecommendation = {
  recommendationId: string;
  recommendationType: string;
  featureKey: string;
  rationale: string;
  confidence: string;
  status: string;
};
