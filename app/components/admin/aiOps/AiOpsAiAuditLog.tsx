import React from 'react';
import { Text, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { aiOpsStyles, cardStyle } from './shared';

export const AiOpsAiAuditLog: React.FC<{ theme: AppTheme }> = ({ theme }) => (
  <View style={[aiOpsStyles.card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles.cardTitle, { color: theme.colors.text }]}>AI Audit Log</Text>
    <Text style={[aiOpsStyles.empty, { color: theme.colors.textMuted }]}>Use the main Audit Log filtered to AI actions.</Text>
  </View>
);
