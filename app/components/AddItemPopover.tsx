import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Modal from './KeyboardAwareModal';


export type AddItemKind = 'activity' | 'place' | 'note' | 'checklist';

export type AddItemPopoverProps = {
  visible: boolean;
  onSelect: (kind: AddItemKind) => void;
  onClose: () => void;
  // 'place' | 'note' | 'checklist' all send a `kind` to POST /api/itineraries/details, which
  // 403s when itinerary_item_kinds is disabled server-side ('activity' never sends a kind, so
  // it's unaffected). Rather than let picking one of those three reach that 403 — surfaced as a
  // "Permission Denied" popup by the global interceptor — the caller hides them from this menu
  // entirely when the flag is off, leaving only "Add a custom activity" selectable.
  hiddenKinds?: AddItemKind[];
  theme?: AppTheme;
};

const OPTIONS: Array<{ kind: AddItemKind; icon: string; label: string; description: string }> = [
  { kind: 'place', icon: '📍', label: 'Add a place', description: 'A location, sight, or address' },
  { kind: 'note', icon: '📝', label: 'Add a note', description: 'Free-form text for the day' },
  { kind: 'checklist', icon: '✅', label: 'Add a checklist', description: 'A title with toggleable items' },
  { kind: 'activity', icon: '🗓️', label: 'Add a custom activity', description: 'Time + activity + cost' },
];

const AddItemPopover: React.FC<AddItemPopoverProps> = ({ visible, onSelect, onClose, hiddenKinds, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const visibleOptions = hiddenKinds?.length ? OPTIONS.filter((opt) => !hiddenKinds.includes(opt.kind)) : OPTIONS;
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
        <Text style={[styles((theme ?? _styleTheme)).title, colors && themeStyle('components_AddItemPopover_2', { colors: colors }, (theme ?? _styleTheme))]}>Add to itinerary</Text>
        {visibleOptions.map((opt) => (
          <Pressable
            key={opt.kind}
            testID={`add-item-option-${opt.kind}`}
            accessibilityRole="menuitem"
            accessibilityLabel={opt.label}
            onPress={() => onSelect(opt.kind)}
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
