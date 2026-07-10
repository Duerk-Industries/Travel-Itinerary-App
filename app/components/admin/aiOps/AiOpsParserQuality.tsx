import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { aiOpsStyles, cardStyle } from './shared';
import type { AiAnalyticsMetric } from './types';

export const AiOpsParserQuality: React.FC<{
  theme: AppTheme;
  analytics: AiAnalyticsMetric[];
  saving: string | null;
  onRefresh: () => void;
  title?: string;
}> = ({ theme, analytics, saving, onRefresh, title = 'Parser Evaluation' }) => (
  <View style={[aiOpsStyles.card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>{title}</Text>
    {analytics.filter((metric) => metric.table === 'ai_parser_metrics' || metric.table === 'ai_field_metrics').slice(0, 8).map((metric, index) => (
      <Text key={`${metric.table}-${metric.metricKey}-${index}`} style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
        {metric.table.replace('ai_', '').replace('_metrics', '')}: {metric.metricKey} = {metric.metricValue}
      </Text>
    ))}
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text, marginTop: 12 }]}>Shadow Comparison</Text>
    {analytics.filter((metric) => metric.table === 'ai_daily_metrics' || metric.table === 'ai_cost_metrics').slice(0, 8).map((metric, index) => (
      <Text key={`${metric.table}-${metric.metricKey}-${index}`} style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
        {metric.dimensions.featureKey ?? metric.dimensions.provider ?? metric.table}: {metric.metricKey} = {metric.metricValue}
      </Text>
    ))}
    <TouchableOpacity style={[aiOpsStyles.button, { backgroundColor: theme.colors.cta }, saving === 'analytics-refresh' && aiOpsStyles.disabled]} disabled={saving === 'analytics-refresh'} onPress={onRefresh}>
      <Text style={aiOpsStyles.buttonText}>{saving === 'analytics-refresh' ? 'Refreshing...' : 'Refresh analytics'}</Text>
    </TouchableOpacity>
  </View>
);
