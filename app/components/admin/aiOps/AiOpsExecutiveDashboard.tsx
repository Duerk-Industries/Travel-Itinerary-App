import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { Text, View } from 'react-native';

import { aiOpsStyles, cardStyle } from './shared';

export const AiOpsExecutiveDashboard: React.FC<{ theme: AppTheme; summary: any }> = ({ theme: _providedTheme, summary }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsExecutiveDashboard_1', { theme: theme }, (theme ?? _styleTheme))]}>Executive Dashboard</Text>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsExecutiveDashboard_2', { theme: theme }, (theme ?? _styleTheme))]}>
      Estimated spend: ${Number(summary?.spend?.estimatedUsd ?? 0).toFixed(2)}
    </Text>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsExecutiveDashboard_3', { theme: theme }, (theme ?? _styleTheme))]}>
      Captures: {Number(summary?.throughput?.captures ?? 0)}
    </Text>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardSub, themeStyle('components_admin_aiOps_AiOpsExecutiveDashboard_4', { theme: theme }, (theme ?? _styleTheme))]}>
      Average experiment quality: {Number(summary?.quality?.avgExperimentQuality ?? 0).toFixed(1)}
    </Text>
  </View>
)); };
