/**
 * AssistantActionConfirmDialog — the mandatory confirmation step before any
 * assistant-proposed action mode tool call actually dispatches (see
 * app/utils/assistantTools.ts and useAssistantChat.ts's `pendingAction`).
 *
 * Built directly on DialogShell rather than reusing ConfirmDialog.tsx:
 * ConfirmDialog's API is a fixed title/message/two-button shape and can't
 * fit the updateItineraryStatus picker below. For addActivity there is
 * nothing to resolve, so no picker is shown -- Confirm is enabled as soon
 * as the proposal is parsed.
 *
 * The picker's ranking is a convenience only, never authoritative -- see
 * rankActivitiesByNameSimilarity's own doc comment. Confirm stays disabled
 * for a status update until the user has explicitly picked a real row; that
 * pick, not the model's itemName text, is what actually resolves the item.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import type { AppTheme } from '../theme/theme';
import DialogShell from './DialogShell';
import type { Tour } from '../tabs/activities';
import { rankActivitiesByNameSimilarity } from '../utils/assistantTools';
import type { PendingAction } from '../hooks/useAssistantChat';

type Props = {
  visible: boolean;
  pendingAction: PendingAction | null;
  activities: Tour[];
  // True while confirmPendingAction's dispatch is in flight. Both buttons
  // disable during this window -- a real bug found via manual testing was
  // the dialog giving no feedback on tap, so a user (reasonably) tapped
  // Confirm repeatedly, firing one dispatch per tap and creating several
  // duplicate activities. The hook's own ref-based guard (see
  // useAssistantChat.ts's isDispatchingRef) is what actually prevents the
  // duplicate dispatch; this prop is what gives the user visible feedback
  // so they stop tapping in the first place.
  confirming?: boolean;
  onConfirm: (resolvedActivityId?: string) => void;
  onCancel: () => void;
  theme?: AppTheme;
};

const describeAddActivity = (args: Record<string, unknown>): string => {
  const name = typeof args.name === 'string' && args.name ? args.name : 'this activity';
  const date = typeof args.date === 'string' && args.date ? ` on ${args.date}` : '';
  const startLocation = typeof args.startLocation === 'string' && args.startLocation ? ` at ${args.startLocation}` : '';
  const startTime = typeof args.startTime === 'string' && args.startTime ? ` (${args.startTime})` : '';
  return `Add "${name}"${date}${startLocation}${startTime} to this trip?`;
};

const AssistantActionConfirmDialog: React.FC<Props> = ({
  visible,
  pendingAction,
  activities,
  confirming = false,
  onConfirm,
  onCancel,
  theme,
}) => {
  const themedStyles = useMemo(() => buildStyles(theme), [theme]);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);

  // A stale pick from a previous proposal must never carry over silently
  // into a new one.
  useEffect(() => {
    setSelectedActivityId(null);
  }, [pendingAction]);

  if (!pendingAction) return null;

  const isStatusUpdate = pendingAction.kind === 'updateItineraryStatus';
  const rankedActivities = isStatusUpdate
    ? rankActivitiesByNameSimilarity(String(pendingAction.args.itemName ?? ''), activities)
    : [];
  const canConfirm = (isStatusUpdate ? Boolean(selectedActivityId) : true) && !confirming;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(isStatusUpdate ? selectedActivityId ?? undefined : undefined);
  };

  const handleCancel = () => {
    if (confirming) return;
    onCancel();
  };

  return (
    <DialogShell
      visible={visible}
      title={isStatusUpdate ? 'Update item status?' : 'Add activity?'}
      styles={themedStyles}
      onClose={handleCancel}
      testID="assistant-action-confirm-dialog"
      accessibilityRole="alert"
      useNativeModal
    >
      {isStatusUpdate ? (
        <>
          <Text style={themedStyles.helperText}>
            Update status to {String(pendingAction.args.status ?? '')} for an activity matching "
            {String(pendingAction.args.itemName ?? '')}". Select which one:
          </Text>
          {rankedActivities.length ? (
            // A ScrollView + .map() rather than FlatList -- this list is
            // always small (one trip's activities), so virtualization buys
            // nothing here, and a plain mapped list of real elements is
            // simpler to reason about (and to test) than a renderItem prop.
            <ScrollView style={themedStyles.pickerList} testID="assistant-action-picker-list">
              {rankedActivities.map((item: Tour) => (
                <TouchableOpacity
                  key={item.id}
                  style={[themedStyles.pickerRow, selectedActivityId === item.id && themedStyles.pickerRowSelected]}
                  onPress={() => setSelectedActivityId(item.id)}
                  testID={`assistant-action-picker-row-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                >
                  <Text style={themedStyles.pickerRowTitle}>{item.name}</Text>
                  <Text style={themedStyles.pickerRowSubtitle}>
                    {item.date} · {item.status}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <Text style={themedStyles.helperText}>No activities found on this trip yet.</Text>
          )}
        </>
      ) : (
        <Text style={themedStyles.helperText}>{describeAddActivity(pendingAction.args)}</Text>
      )}
      <View style={themedStyles.row}>
        <TouchableOpacity
          style={[themedStyles.button, themedStyles.confirmButton, !canConfirm && themedStyles.buttonDisabled]}
          onPress={handleConfirm}
          disabled={!canConfirm}
          accessibilityRole="button"
          accessibilityLabel="Confirm"
          testID="assistant-action-confirm"
        >
          <Text style={themedStyles.confirmButtonText}>{confirming ? 'Confirming…' : 'Confirm'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[themedStyles.button, confirming && themedStyles.buttonDisabled]}
          onPress={handleCancel}
          disabled={confirming}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          testID="assistant-action-cancel"
        >
          <Text style={themedStyles.buttonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </DialogShell>
  );
};

const buildStyles = (theme?: AppTheme) =>
  StyleSheet.create({
    modalOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 2000,
    },
    confirmModal: {
      backgroundColor: theme?.colors.surface ?? '#fff',
      padding: 16,
      borderRadius: 10,
      width: '100%',
      maxWidth: 380,
      ...(Platform.OS === 'web' ? { boxShadow: '0 4px 10px rgba(0,0,0,0.25)' } : null),
      borderWidth: 1,
      borderColor: theme?.colors.border ?? '#e0e0e0',
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme?.colors.text ?? '#1a1a1a',
      marginBottom: 8,
    },
    helperText: {
      color: theme?.colors.textMuted ?? '#555',
      marginBottom: 8,
      fontSize: 13,
      lineHeight: 18,
    },
    pickerList: {
      maxHeight: 220,
      marginBottom: 8,
    },
    pickerRow: {
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
      marginBottom: 4,
      backgroundColor: theme?.colors.surfaceMuted ?? '#f0f0f0',
      borderWidth: 1,
      borderColor: 'transparent',
    },
    pickerRowSelected: {
      borderColor: '#7C3AED',
      backgroundColor: theme?.mode === 'dark' ? '#3a2a5c' : '#ede4fb',
    },
    pickerRowTitle: {
      color: theme?.colors.text ?? '#1a1a1a',
      fontSize: 14,
      fontWeight: '600',
    },
    pickerRowSubtitle: {
      color: theme?.colors.textMuted ?? '#666',
      fontSize: 12,
      marginTop: 2,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 4,
    },
    button: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: theme?.colors.surfaceMuted ?? '#eee',
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: theme?.colors.text ?? '#1a1a1a',
      fontWeight: '600',
      fontSize: 14,
    },
    confirmButton: {
      backgroundColor: '#7C3AED',
    },
    confirmButtonText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 14,
    },
  });

export default AssistantActionConfirmDialog;
