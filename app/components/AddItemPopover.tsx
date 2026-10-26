import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Modal from './KeyboardAwareModal';
import type { Activity } from '../../server/src/types';


export type AddItemKind = 'activity' | 'note' | 'checklist';

export type AddItemPopoverProps = {
  visible: boolean;
  mode?: 'items' | 'activities';
  onSelect: (kind: AddItemKind) => void;
  onClose: () => void;
  optionalActivities?: Array<Pick<Activity, 'id' | 'name'>>;
  onSelectOptionalActivity?: (id: string) => void;
  busy?: boolean;
  // Notes and checklists require the itinerary item kinds feature.
  hiddenKinds?: AddItemKind[];
  theme?: AppTheme;
};

const OPTIONS: Array<{ kind: AddItemKind; icon: string; label: string; description: string }> = [
  { kind: 'note', icon: '📝', label: 'Add a note', description: 'Free-form text for the day' },
  { kind: 'checklist', icon: '✅', label: 'Add a checklist', description: 'A title with toggleable items' },
  { kind: 'activity', icon: '🗓️', label: 'Add a new activity', description: 'Time + activity + cost' },
];

const AddItemPopover: React.FC<AddItemPopoverProps> = ({ visible, mode = 'items', onSelect, onClose, hiddenKinds, optionalActivities = [], onSelectOptionalActivity, busy = false, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const visibleOptions = OPTIONS.filter((opt) => (mode === 'activities' ? opt.kind === 'activity' : opt.kind !== 'activity') && !hiddenKinds?.includes(opt.kind));
  const colors = theme?.colors;
  return (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    onRequestClose={onClose}
    accessibilityViewIsModal
  >
    <Pressable style={styles((theme ?? _styleTheme)).overlay} onPress={onClose} testID="add-item-popover-overlay">
      <Pressable
        style={[styles((theme ?? _styleTheme)).menu, colors && themeStyle('components_AddItemPopover_1', { colors: colors }, (theme ?? _styleTheme))]}
        onPress={(e: { stopPropagation: () => void }) => e.stopPropagation()}
        accessibilityRole="menu"
        testID="add-item-popover"
      >
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
        <Text style={[styles((theme ?? _styleTheme)).title, colors && themeStyle('components_AddItemPopover_2', { colors: colors }, (theme ?? _styleTheme))]}>{mode === 'activities' ? 'Add activity' : 'Add to itinerary'}</Text>
        {mode === 'activities' && optionalActivities.length > 0 && onSelectOptionalActivity ? <>
          <Text style={[styles((theme ?? _styleTheme)).title, colors && themeStyle('components_AddItemPopover_2', { colors }, (theme ?? _styleTheme))]}>Optional activities for this day</Text>
          {optionalActivities.map((activity) => <Pressable key={activity.id} testID={`add-item-optional-${activity.id}`} accessibilityRole="menuitem"
            accessibilityLabel={`Schedule ${activity.name || 'optional activity'} on this day`} disabled={busy}
            style={styles((theme ?? _styleTheme)).option} onPress={() => onSelectOptionalActivity(activity.id)}>
            <Text style={styles((theme ?? _styleTheme)).optionIcon}>💡</Text>
            <Text style={[styles((theme ?? _styleTheme)).optionLabel, colors && themeStyle('components_AddItemPopover_4', { colors }, (theme ?? _styleTheme))]}>{activity.name || 'Optional activity'}</Text>
          </Pressable>)}
        </> : null}
        {visibleOptions.map((opt) => (
          <Pressable
            key={opt.kind}
            testID={`add-item-option-${opt.kind}`}
            accessibilityRole="menuitem"
            accessibilityLabel={opt.label}
            onPress={() => onSelect(opt.kind)}
            disabled={busy}
            style={({ pressed }: { pressed: boolean }) => [styles((theme ?? _styleTheme)).option, pressed && themeStyle('components_AddItemPopover_3', { colors: colors }, (theme ?? _styleTheme))]}
          >
            <Text style={styles((theme ?? _styleTheme)).optionIcon}>{opt.icon}</Text>
            <View style={styles((theme ?? _styleTheme)).optionTextWrap}>
              <Text style={[styles((theme ?? _styleTheme)).optionLabel, colors && themeStyle('components_AddItemPopover_4', { colors: colors }, (theme ?? _styleTheme))]}>{opt.label}</Text>
              <Text style={[styles((theme ?? _styleTheme)).optionDescription, colors && themeStyle('components_AddItemPopover_5', { colors: colors }, (theme ?? _styleTheme))]}>{opt.description}</Text>
            </View>
          </Pressable>
        ))}
        <Pressable
          testID="add-item-option-cancel"
          style={({ pressed }: { pressed: boolean }) => [styles((theme ?? _styleTheme)).cancel, pressed && themeStyle('components_AddItemPopover_6', { colors: colors }, (theme ?? _styleTheme))]}
          onPress={onClose}
        >
          <Text style={[styles((theme ?? _styleTheme)).cancelText, colors && themeStyle('components_AddItemPopover_7', { colors: colors }, (theme ?? _styleTheme))]}>Cancel</Text>
        </Pressable>
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>
  );
};

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_AddItemPopover_8', { StyleSheet: StyleSheet, Platform: Platform }, _theme);

export default AddItemPopover;
