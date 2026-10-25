import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { Text, View } from 'react-native';

import { aiOpsStyles, cardStyle } from './shared';

export const AiOpsAiAuditLog: React.FC<{ theme: AppTheme }> = ({ theme: _providedTheme }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View style={[aiOpsStyles((theme ?? _styleTheme)).card, cardStyle(theme)]}>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).cardTitle, themeStyle('components_admin_aiOps_AiOpsAiAuditLog_1', { theme: theme }, (theme ?? _styleTheme))]}>AI Audit Log</Text>
    <Text style={[aiOpsStyles((theme ?? _styleTheme)).empty, themeStyle('components_admin_aiOps_AiOpsAiAuditLog_2', { theme: theme }, (theme ?? _styleTheme))]}>Use the main Audit Log filtered to AI actions.</Text>
  </View>
)); };
