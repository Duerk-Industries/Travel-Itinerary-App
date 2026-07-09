import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
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
  { key: 'ai-audit-log', label: 'AI Audit Log' },
];

export const aiOpsStyles = StyleSheet.create({
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  nav: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  navButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  navButtonActive: { backgroundColor: '#2f6fed' },
  navText: { fontSize: 13, fontWeight: '600' },
  navTextActive: { color: '#fff' },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  cardSub: { fontSize: 13, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  compactRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 6 },
  button: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, alignSelf: 'flex-start', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  error: { marginVertical: 8 },
  save: { marginTop: 8, fontWeight: '600' },
  empty: { fontStyle: 'italic' },
});

export const cardStyle = (theme: AppTheme) => ({
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
});

export const inputStyle = (theme: AppTheme) => ({
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  color: theme.colors.text,
});

export const AiOpsNav: React.FC<{
  active: AiOpsSection;
  theme: AppTheme;
  onSelect: (section: AiOpsSection) => void;
}> = ({ active, theme, onSelect }) => (
  <View style={aiOpsStyles.nav}>
    {aiOpsSections.map((item) => (
      <TouchableOpacity
        key={item.key}
        style={[
          aiOpsStyles.navButton,
          active === item.key && aiOpsStyles.navButtonActive,
          { borderColor: theme.colors.border },
        ]}
        onPress={() => onSelect(item.key)}
      >
        <Text style={[aiOpsStyles.navText, { color: theme.colors.text }, active === item.key && aiOpsStyles.navTextActive]}>
          {item.label}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);
