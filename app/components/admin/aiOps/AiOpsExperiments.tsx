import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

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
}> = ({ theme: _providedTheme, experiments, metrics, reason, saving, setReason, onCreate, onUpdateStatus }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsExperiments_1', { theme: theme }, (theme ?? _styleTheme))]}>Experiments</Text>
    <TextInput
      style={[aiOpsStyles((theme ?? _styleTheme)).input, inputStyle(theme)]}
      value={reason}
      onChangeText={setReason}
      placeholder="Reason for audit log"
      placeholderTextColor={theme.colors.textMuted}
    />
    <TouchableOpacity
      style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsExperiments_2', { theme: theme }, (theme ?? _styleTheme)), saving === 'experiment-create' && aiOpsStyles((theme ?? _styleTheme)).disabled]}
      disabled={saving === 'experiment-create'}
      onPress={onCreate}
    >
      <Text style={[aiOpsStyles((theme ?? _styleTheme)).buttonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>{saving === 'experiment-create' ? 'Creating...' : 'Create shadow compare'}</Text>
    </TouchableOpacity>
    {experiments.length === 0 ? <Text style={[aiOpsStyles((theme ?? _styleTheme)).empty, themeStyle('components_admin_aiOps_AiOpsExperiments_3', { theme: theme }, (theme ?? _styleTheme))]}>No experiments running.</Text> : null}
    {experiments.map((experiment) => {
      const metricByVariant = latestMetricsByVariant(metrics, experiment.experimentId);
      const controlVariantId = experiment.controlVariantId ?? experiment.variants[0]?.variantId;
      const controlMetric = controlVariantId ? metricByVariant.get(controlVariantId) : undefined;
      return (
        <View key={experiment.experimentId} style={aiOpsStyles((theme ?? _styleTheme)).compactRow}>
          <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsExperiments_4', { theme: theme }, (theme ?? _styleTheme))]}>{experiment.name}</Text>
          <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsExperiments_5', { theme: theme }, (theme ?? _styleTheme))]}>
            {experiment.featureKey} - {experiment.experimentKind} - {experiment.status} - {experiment.variants.length} variants
          </Text>
          {experiment.variants.map((variant) => {
            const metric = metricByVariant.get(variant.variantId);
            const delta = metric && controlMetric && variant.variantId !== controlVariantId
              ? metric.avgQualityScore - controlMetric.avgQualityScore
              : null;
            const confidence = metric && metric.requestCount >= (experiment.minSampleSize ?? 200) ? 'ready' : 'low';
            return (
              <Text key={variant.variantId} style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsExperiments_6', { theme: theme }, (theme ?? _styleTheme))]}>
                {variant.variantId}: {variant.trafficPercent}% traffic, {metric?.requestCount ?? 0} requests, quality {Math.round(metric?.avgQualityScore ?? 0)}
                {delta == null ? '' : `, delta ${Math.round(delta * 10) / 10}`}, success {formatPercent(metric?.successRate ?? 0)}, cost ${Math.round((metric?.avgCostUsd ?? 0) * 10000) / 10000}, confidence {confidence}
              </Text>
            );
          })}
          <View style={aiOpsStyles((theme ?? _styleTheme)).rowWrap}>
            {experiment.status === 'draft' || experiment.status === 'paused' ? (
              <TouchableOpacity
                style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsExperiments_7', { theme: theme }, (theme ?? _styleTheme)), saving === `experiment-${experiment.experimentId}` && aiOpsStyles((theme ?? _styleTheme)).disabled]}
                disabled={saving === `experiment-${experiment.experimentId}`}
                onPress={() => onUpdateStatus(experiment, 'running')}
              >
                <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>{experiment.status === 'paused' ? 'Resume' : 'Start'}</Text>
              </TouchableOpacity>
            ) : null}
            {experiment.status === 'running' ? (
              <TouchableOpacity
                style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsExperiments_8', { theme: theme }, (theme ?? _styleTheme)), saving === `experiment-${experiment.experimentId}` && aiOpsStyles((theme ?? _styleTheme)).disabled]}
                disabled={saving === `experiment-${experiment.experimentId}`}
                onPress={() => onUpdateStatus(experiment, 'paused')}
              >
                <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>Pause</Text>
              </TouchableOpacity>
            ) : null}
            {experiment.status !== 'completed' ? (
              <TouchableOpacity
                style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsExperiments_9', { theme: theme }, (theme ?? _styleTheme)), saving === `experiment-${experiment.experimentId}` && aiOpsStyles((theme ?? _styleTheme)).disabled]}
                disabled={saving === `experiment-${experiment.experimentId}`}
                onPress={() => onUpdateStatus(experiment, 'completed')}
              >
                <Text style={aiOpsStyles((theme ?? _styleTheme)).buttonText}>End</Text>
              </TouchableOpacity>
            ) : null}
            {experiment.variants.filter((variant) => variant.variantId !== controlVariantId).map((variant) => (
              <TouchableOpacity
                key={variant.variantId}
                style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsExperiments_10', { theme: theme }, (theme ?? _styleTheme)), saving === `experiment-${experiment.experimentId}` && aiOpsStyles((theme ?? _styleTheme)).disabled]}
                disabled={saving === `experiment-${experiment.experimentId}`}
                onPress={() => onUpdateStatus(experiment, 'completed', variant.variantId)}
              >
                <Text style={[aiOpsStyles((theme ?? _styleTheme)).buttonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Promote {variant.variantId}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    })}
  </View>
)); };
