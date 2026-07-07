import React from 'react';
import { Text, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { aiOpsStyles, cardStyle } from './shared';

export const AiOpsOverview: React.FC<{
  theme: AppTheme;
  providerCount: number;
  experimentCount: number;
  recommendationCount: number;
  metricCount: number;
}> = ({ theme, providerCount, experimentCount, recommendationCount, metricCount }) => (
  <View style={[aiOpsStyles.card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>AI Operations Overview</Text>
    <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
      {providerCount} providers, {experimentCount} experiments, {recommendationCount} recommendations, {metricCount} aggregate metrics.
    </Text>
  </View>
);
