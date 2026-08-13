import React, { memo, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../theme/theme';
import DialogShell from './DialogShell';

export type TripItemDetailRow = {
  label: string;
  value: React.ReactNode;
  onPress?: () => void;
};

export type TripItemDetailsDialogProps = {
  visible: boolean;
  kind: 'flight' | 'lodging' | 'activity';
  title: string;
  subtitle?: string;
  status?: string;
  rows: TripItemDetailRow[];
  styles: Record<string, any>;
  theme?: AppTheme;
  readOnly?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  supplementalContent?: React.ReactNode;
  testID?: string;
};

const TripItemDetailsDialogComponent: React.FC<TripItemDetailsDialogProps> = ({
  visible,
  kind,
  title,
  subtitle,
  status,
  rows,
  styles,
  theme,
  readOnly = false,
  onClose,
  onEdit,
  onDelete,
  supplementalContent,
  testID,
}) => {
  const detailStyles = useMemo(() => StyleSheet.create({
    card: {
      width: '100%',
      maxWidth: 520,
      maxHeight: '92%',
      borderRadius: 16,
      padding: 0,
      overflow: 'hidden',
    },
    header: {
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme?.colors.border ?? '#e5e7eb',
    },
    headerLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    title: { flex: 1, fontSize: 20, fontWeight: '700', color: theme?.colors.text ?? '#0f172a' },
    subtitle: { marginTop: 4, color: theme?.colors.textMuted ?? '#64748b' },
    status: {
      borderWidth: 1,
      borderColor: theme?.colors.border ?? '#cbd5e1',
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    statusText: { color: theme?.colors.text ?? '#0f172a', fontSize: 12, fontWeight: '600' },
    close: { padding: 4 },
    closeText: { fontSize: 18, color: theme?.colors.textMuted ?? '#64748b' },
    body: { paddingHorizontal: 18, paddingVertical: 12 },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 7 },
    label: { width: 125, color: theme?.colors.text ?? '#0f172a', fontWeight: '700', fontSize: 13 },
    value: { flex: 1, color: theme?.colors.text ?? '#111827', fontSize: 13 },
    footer: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: theme?.colors.border ?? '#e5e7eb' },
    actionGroup: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  }), [theme]);

  if (!visible) return null;
  return (
    <DialogShell
      visible={visible}
      title={`${kind[0].toUpperCase()}${kind.slice(1)} details`}
      styles={styles}
      onClose={onClose}
      testID={testID}
      cardStyle={[styles.modalCard, detailStyles.card]}
      showTitle={false}
    >
      <View style={detailStyles.header}>
        <View style={detailStyles.headerLine}>
          <Text style={detailStyles.title} accessibilityRole="header">{title || `${kind} details`}</Text>
          {status ? <View style={detailStyles.status}><Text style={detailStyles.statusText}>{status}</Text></View> : null}
          <TouchableOpacity style={detailStyles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={`Close ${kind} details`}>
            <Text style={detailStyles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
        {subtitle ? <Text style={detailStyles.subtitle} numberOfLines={3}>{subtitle}</Text> : null}
      </View>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={detailStyles.body} keyboardShouldPersistTaps="handled">
        {rows.map((row) => (
          <View key={row.label} style={detailStyles.row}>
            <Text style={detailStyles.label}>{row.label}</Text>
            {row.onPress ? (
              <TouchableOpacity style={{ flex: 1 }} onPress={row.onPress}><Text style={[detailStyles.value, styles.linkText]}>{row.value}</Text></TouchableOpacity>
            ) : <Text style={detailStyles.value}>{row.value || '-'}</Text>}
          </View>
        ))}
        {supplementalContent}
      </ScrollView>
      <View style={detailStyles.footer}>
        <View style={detailStyles.actionGroup}>
          <TouchableOpacity style={styles.button} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"><Text style={styles.buttonText}>Close</Text></TouchableOpacity>
        </View>
        {!readOnly ? (
          <View style={detailStyles.actionGroup}>
            <TouchableOpacity style={styles.button} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${kind}`} testID={`${kind}-details-edit`}><Text style={styles.buttonText}>Edit</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onDelete} accessibilityRole="button" accessibilityLabel={`Delete ${kind}`} testID={`${kind}-details-delete`}><Text style={styles.dangerButtonText}>Delete</Text></TouchableOpacity>
          </View>
        ) : null}
      </View>
    </DialogShell>
  );
};

export default memo(TripItemDetailsDialogComponent);
