import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { aiOpsStyles, cardStyle, inputStyle } from './shared';
import type { AiAbTestMetric, AiExperiment } from './types';

const latestMetricsByVariant = (metrics: AiAbTestMetric[], experimentId: string) => {
  const latest = new Map<string, AiAbTestMetric>();
  for (const metric of metrics.filter((item) => item.experimentId === experimentId)) {
    const current = latest.get(metric.variantId);
    if (!current || metric.day > current.day) latest.set(metric.variantId, metric);
  }
  return latest;
};

const formatPercent = (value: number) => `${Math.round(value * 1000) / 10}%`;

export const AiOpsExperiments: React.FC<{
  theme: AppTheme;
  experiments: AiExperiment[];
  metrics: AiAbTestMetric[];
  reason: string;
  saving: string | null;
  setReason: (value: string) => void;
  onCreate: () => void;
  onUpdateStatus: (experiment: AiExperiment, status: string, winningVariantId?: string) => void;
}> = ({ theme, experiments, metrics, reason, saving, setReason, onCreate, onUpdateStatus }) => (
  <View style={[aiOpsStyles.card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>Experiments</Text>
    <TextInput
      style={[aiOpsStyles.input, inputStyle(theme)]}
      value={reason}
      onChangeText={setReason}
      placeholder="Reason for audit log"
      placeholderTextColor={theme.colors.textMuted}
    />
    <TouchableOpacity
      style={[aiOpsStyles.button, { backgroundColor: theme.colors.cta }, saving === 'experiment-create' && aiOpsStyles.disabled]}
      disabled={saving === 'experiment-create'}
      onPress={onCreate}
    >
      <Text style={aiOpsStyles.buttonText}>{saving === 'experiment-create' ? 'Creating...' : 'Create shadow compare'}</Text>
    </TouchableOpacity>
    {experiments.length === 0 ? <Text style={[aiOpsStyles.empty, { color: theme.colors.textMuted }]}>No experiments running.</Text> : null}
    {experiments.map((experiment) => {
      const metricByVariant = latestMetricsByVariant(metrics, experiment.experimentId);
      const controlVariantId = experiment.controlVariantId ?? experiment.variants[0]?.variantId;
      const controlMetric = controlVariantId ? metricByVariant.get(controlVariantId) : undefined;
      return (
        <View key={experiment.experimentId} style={aiOpsStyles.compactRow}>
          <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>{experiment.name}</Text>
          <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
            {experiment.featureKey} - {experiment.experimentKind} - {experiment.status} - {experiment.variants.length} variants
          </Text>
          {experiment.variants.map((variant) => {
            const metric = metricByVariant.get(variant.variantId);
            const delta = metric && controlMetric && variant.variantId !== controlVariantId
              ? metric.avgQualityScore - controlMetric.avgQualityScore
              : null;
            const confidence = metric && metric.requestCount >= (experiment.minSampleSize ?? 200) ? 'ready' : 'low';
            return (
              <Text key={variant.variantId} style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
                {variant.variantId}: {variant.trafficPercent}% traffic, {metric?.requestCount ?? 0} requests, quality {Math.round(metric?.avgQualityScore ?? 0)}
                {delta == null ? '' : `, delta ${Math.round(delta * 10) / 10}`}, success {formatPercent(metric?.successRate ?? 0)}, cost ${Math.round((metric?.avgCostUsd ?? 0) * 10000) / 10000}, confidence {confidence}
              </Text>
            );
          })}
          <View style={aiOpsStyles.rowWrap}>
            {experiment.status === 'draft' || experiment.status === 'paused' ? (
              <TouchableOpacity
                style={[aiOpsStyles.button, { backgroundColor: theme.colors.success }, saving === `experiment-${experiment.experimentId}` && aiOpsStyles.disabled]}
                disabled={saving === `experiment-${experiment.experimentId}`}
                onPress={() => onUpdateStatus(experiment, 'running')}
              >
                <Text style={aiOpsStyles.buttonText}>{experiment.status === 'paused' ? 'Resume' : 'Start'}</Text>
              </TouchableOpacity>
            ) : null}
            {experiment.status === 'running' ? (
              <TouchableOpacity
                style={[aiOpsStyles.button, { backgroundColor: theme.colors.alert }, saving === `experiment-${experiment.experimentId}` && aiOpsStyles.disabled]}
                disabled={saving === `experiment-${experiment.experimentId}`}
                onPress={() => onUpdateStatus(experiment, 'paused')}
              >
                <Text style={aiOpsStyles.buttonText}>Pause</Text>
              </TouchableOpacity>
            ) : null}
            {experiment.status !== 'completed' ? (
              <TouchableOpacity
                style={[aiOpsStyles.button, { backgroundColor: theme.colors.alert }, saving === `experiment-${experiment.experimentId}` && aiOpsStyles.disabled]}
                disabled={saving === `experiment-${experiment.experimentId}`}
                onPress={() => onUpdateStatus(experiment, 'completed')}
              >
                <Text style={aiOpsStyles.buttonText}>End</Text>
              </TouchableOpacity>
            ) : null}
            {experiment.variants.filter((variant) => variant.variantId !== controlVariantId).map((variant) => (
              <TouchableOpacity
                key={variant.variantId}
                style={[aiOpsStyles.button, { backgroundColor: theme.colors.cta }, saving === `experiment-${experiment.experimentId}` && aiOpsStyles.disabled]}
                disabled={saving === `experiment-${experiment.experimentId}`}
                onPress={() => onUpdateStatus(experiment, 'completed', variant.variantId)}
              >
                <Text style={aiOpsStyles.buttonText}>Promote {variant.variantId}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    })}
  </View>
);
