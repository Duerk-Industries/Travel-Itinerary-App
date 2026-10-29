import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import AddToCalendarButton from './AddToCalendarButton';
import { type CalendarEvent } from '../utils/calendarEvents';
import React, { memo, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
  calendarEvent?: CalendarEvent | null;
  secondaryAction?: { label: string; onPress: () => void; testID?: string } | null;
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
  theme: _providedTheme,
  readOnly = false,
  onClose,
  onEdit,
  onDelete,
  supplementalContent,
  calendarEvent,
  secondaryAction = null,
  testID,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const detailStyles = useMemo(() => StyleSheet.create(themeStyle('components_TripItemDetailsDialog_1', { theme: theme }, (theme ?? _styleTheme))), [theme, _styleTheme]);

  if (!visible) return null;
  return (
    <DialogShell scrollable={false}
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
      <ScrollView style={themeStyle('components_TripItemDetailsDialog_2', {  }, (theme ?? _styleTheme))} contentContainerStyle={detailStyles.body} keyboardShouldPersistTaps="handled">
        {rows.map((row) => (
          <View key={row.label} style={detailStyles.row}>
            <Text style={detailStyles.label}>{row.label}</Text>
            {row.onPress ? (
              <TouchableOpacity style={themeStyle('components_TripItemDetailsDialog_3', {  }, (theme ?? _styleTheme))} onPress={row.onPress}><Text style={[detailStyles.value, styles.linkText]}>{row.value}</Text></TouchableOpacity>
            ) : <Text style={detailStyles.value}>{row.value || '-'}</Text>}
          </View>
        ))}
        {supplementalContent}
        <AddToCalendarButton event={calendarEvent ?? null} styles={styles} />
        {calendarEvent && !calendarEvent.allDay ? <Text style={styles.helperText}>Check the event time zone before saving. Times use the booking's local time; no time zone is recorded.</Text> : null}
      </ScrollView>
      <View style={detailStyles.footer}>
        <View style={detailStyles.actionGroup}>
          <TouchableOpacity style={styles.button} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"><Text style={styles.buttonText}>Close</Text></TouchableOpacity>
        </View>
        {!readOnly ? (
          <View style={detailStyles.actionGroup}>
            {secondaryAction ? <TouchableOpacity style={styles.button} onPress={secondaryAction.onPress} accessibilityRole="button" testID={secondaryAction.testID}><Text style={styles.buttonText}>{secondaryAction.label}</Text></TouchableOpacity> : null}
            <TouchableOpacity style={styles.button} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${kind}`} testID={`${kind}-details-edit`}><Text style={styles.buttonText}>Edit</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onDelete} accessibilityRole="button" accessibilityLabel={`Delete ${kind}`} testID={`${kind}-details-delete`}><Text style={styles.dangerButtonText}>Delete</Text></TouchableOpacity>
          </View>
        ) : null}
      </View>
    </DialogShell>
  );
};

export default memo(TripItemDetailsDialogComponent);
