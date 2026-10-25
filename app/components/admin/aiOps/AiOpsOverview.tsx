import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { Text, View } from 'react-native';

import { aiOpsStyles, cardStyle } from './shared';

export const AiOpsOverview: React.FC<{
  theme: AppTheme;
  providerCount: number;
  experimentCount: number;
  recommendationCount: number;
  metricCount: number;
}> = ({ theme: _providedTheme, providerCount, experimentCount, recommendationCount, metricCount }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsOverview_1', { theme: theme }, (theme ?? _styleTheme))]}>AI Operations Overview</Text>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsOverview_2', { theme: theme }, (theme ?? _styleTheme))]}>
      {providerCount} providers, {experimentCount} experiments, {recommendationCount} recommendations, {metricCount} aggregate metrics.
    </Text>
  </View>
)); };
