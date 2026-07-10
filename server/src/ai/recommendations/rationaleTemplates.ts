const templates: Record<string, (metrics: Record<string, unknown>) => string> = {
  switch_provider: (m) => `${m.proposedProvider ?? 'Proposed provider'} scored ${m.qualityDelta ?? 0} quality points higher at ${m.costDeltaUsdMonthly ?? 0} estimated monthly cost delta.`,
  promote_prompt: (m) => `Prompt ${m.promptVersion ?? 'candidate'} improved quality by ${m.qualityDelta ?? 0} points with ${m.confidence ?? 'low'} confidence.`,
  retire_parser: (m) => `Parser ${m.parserVersion ?? 'candidate'} underperformed by ${m.qualityDelta ?? 0} quality points and should be retired.`,
  reduce_shadow_sampling: (m) => `Shadow sampling can be reduced to ${m.sampleRatePercent ?? 0}% based on stable agreement and budget usage.`,
  cost_anomaly: (m) => `AI cost changed by ${m.costDeltaUsdMonthly ?? 0} projected monthly dollars for ${m.featureKey ?? 'the feature'}.`,
};

export const renderRecommendationRationale = (
  type: string,
  metrics: Record<string, unknown>,
): string => {
  const render = templates[type] ?? templates.cost_anomaly;
  return render(metrics);
};

export const listRecommendationTypes = (): string[] => Object.keys(templates);
