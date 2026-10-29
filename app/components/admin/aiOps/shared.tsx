import { resolveComponentTheme as resolveStyleTheme, themeStyle, getAppTheme as getStyleTheme, type AppTheme } from '../../../theme/theme';

import { useAppTheme as useStyleTheme } from '../../../theme/ThemeContext';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { AiOpsSection } from './types';

export const aiOpsSections: Array<{ key: AiOpsSection; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'providers', label: 'Providers' },
  { key: 'experiments', label: 'Experiments' },
  { key: 'recommendations', label: 'Recommendations' },
  { key: 'captures', label: 'Captures' },
  { key: 'parser-quality', label: 'Parser Quality' },
  { key: 'shadow-replay', label: 'Shadow Replay' },
  { key: 'executive', label: 'Executive' },
  { key: 'runtime-settings', label: 'Runtime Settings' },
  { key: 'itinerary-instructions', label: 'Itinerary Instructions' },
  { key: 'ai-audit-log', label: 'AI Audit Log' },
];

export const aiOpsStyles = (_theme: import('../../../theme/theme').AppTheme) => themeStyle('components_admin_aiOps_shared_5', { StyleSheet: StyleSheet }, _theme);

export const cardStyle = (theme: AppTheme) => (themeStyle('components_admin_aiOps_shared_1', { theme: theme }, (theme ?? getStyleTheme('light', 'light'))));

export const inputStyle = (theme: AppTheme) => (themeStyle('components_admin_aiOps_shared_2', { theme: theme }, (theme ?? getStyleTheme('light', 'light'))));

export const AiOpsNav: React.FC<{
  active: AiOpsSection;
  theme: AppTheme;
  onSelect: (section: AiOpsSection) => void;
}> = ({ active, theme: _providedTheme, onSelect }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View style={aiOpsStyles((theme ?? _styleTheme)).nav}>
    {aiOpsSections.map((item) => (
      <TouchableOpacity
        key={item.key}
        style={[
          aiOpsStyles((theme ?? _styleTheme)).navButton,
          active === item.key && aiOpsStyles((theme ?? _styleTheme)).navButtonActive,
          themeStyle('components_admin_aiOps_shared_3', { theme: theme }, (theme ?? _styleTheme)),
        ]}
        onPress={() => onSelect(item.key)}
      >
        <Text style={[aiOpsStyles((theme ?? _styleTheme)).navText, themeStyle('components_admin_aiOps_shared_4', { theme: theme }, (theme ?? _styleTheme)), active === item.key && aiOpsStyles((theme ?? _styleTheme)).navTextActive]}>
          {item.label}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
)); };
