import React from 'react';
import { Text, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { aiOpsStyles, cardStyle } from './shared';

export const AiOpsExecutiveDashboard: React.FC<{ theme: AppTheme; summary: any }> = ({ theme, summary }) => (
  <View style={[aiOpsStyles.card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>Executive Dashboard</Text>
    <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
      Estimated spend: ${Number(summary?.spend?.estimatedUsd ?? 0).toFixed(2)}
    </Text>
    <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
      Captures: {Number(summary?.throughput?.captures ?? 0)}
    </Text>
    <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>
      Average experiment quality: {Number(summary?.quality?.avgExperimentQuality ?? 0).toFixed(1)}
    </Text>
  </View>
);
