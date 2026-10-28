import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { aiOpsStyles, cardStyle } from './shared';
import type { AiAnalyticsMetric } from './types';

export const AiOpsParserQuality: React.FC<{
  theme: AppTheme;
  analytics: AiAnalyticsMetric[];
  saving: string | null;
  onRefresh: () => void;
  title?: string;
}> = ({ theme: _providedTheme, analytics, saving, onRefresh, title = 'Parser Evaluation' }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsParserQuality_1', { theme: theme }, (theme ?? _styleTheme))]}>{title}</Text>
    {analytics.filter((metric) => metric.table === 'ai_parser_metrics' || metric.table === 'ai_field_metrics').slice(0, 8).map((metric, index) => (
      <Text key={`${metric.table}-${metric.metricKey}-${index}`} style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsParserQuality_2', { theme: theme }, (theme ?? _styleTheme))]}>
        {metric.table.replace('ai_', '').replace('_metrics', '')}: {metric.metricKey} = {metric.metricValue}
      </Text>
    ))}
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsParserQuality_3', { theme: theme }, (theme ?? _styleTheme))]}>Shadow Comparison</Text>
    {analytics.filter((metric) => metric.table === 'ai_daily_metrics' || metric.table === 'ai_cost_metrics').slice(0, 8).map((metric, index) => (
      <Text key={`${metric.table}-${metric.metricKey}-${index}`} style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsParserQuality_4', { theme: theme }, (theme ?? _styleTheme))]}>
        {metric.dimensions.featureKey ?? metric.dimensions.provider ?? metric.table}: {metric.metricKey} = {metric.metricValue}
      </Text>
    ))}
    <TouchableOpacity style={[aiOpsStyles((theme ?? _styleTheme)).button, themeStyle('components_admin_aiOps_AiOpsParserQuality_5', { theme: theme }, (theme ?? _styleTheme)), saving === 'analytics-refresh' && aiOpsStyles((theme ?? _styleTheme)).disabled]} disabled={saving === 'analytics-refresh'} onPress={onRefresh}>
      <Text style={[aiOpsStyles((theme ?? _styleTheme)).buttonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>{saving === 'analytics-refresh' ? 'Refreshing...' : 'Refresh analytics'}</Text>
    </TouchableOpacity>
  </View>
)); };
