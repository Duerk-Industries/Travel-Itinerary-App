import IconText from './IconText';
import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Modal from './KeyboardAwareModal';


export type AddItemKind = 'activity' | 'note' | 'checklist';

/** An activity offered for the day: an optional one the trip already has, or a suggestion. */
export type AddItemActivityOption = {
  id: string;
  name: string;
  /** One sentence on what it is. */
  description?: string;
  image?: { url: string; credit: string } | null;
};

export type AddItemPopoverProps = {
  visible: boolean;
  mode?: 'items' | 'activities';
  onSelect: (kind: AddItemKind) => void;
  onClose: () => void;
  optionalActivities?: AddItemActivityOption[];
  onSelectOptionalActivity?: (id: string) => void;
  /** Template activities for the city the day's lodging is in, shown below "Add a new activity". */
  suggestedActivities?: AddItemActivityOption[];
  onSelectSuggestedActivity?: (id: string) => void;
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

const AddItemPopover: React.FC<AddItemPopoverProps> = ({ visible, mode = 'items', onSelect, onClose, hiddenKinds, optionalActivities = [], onSelectOptionalActivity, suggestedActivities = [], onSelectSuggestedActivity, busy = false, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const visibleOptions = OPTIONS.filter((opt) => (mode === 'activities' ? opt.kind === 'activity' : opt.kind !== 'activity') && !hiddenKinds?.includes(opt.kind));
  const colors = theme?.colors;
  // A picture (or the bulb when there is none) beside the name and the sentence about what it is.
  const renderActivityOption = (activity: AddItemActivityOption, kind: 'optional' | 'suggested', label: string, onSelect: (id: string) => void) => (
    <Pressable key={`${kind}-${activity.id}`} testID={`add-item-${kind}-${activity.id}`} accessibilityRole="menuitem"
      accessibilityLabel={label} disabled={busy}
      style={styles((theme ?? _styleTheme)).option} onPress={() => onSelect(activity.id)}>
      {activity.image
        ? <Image source={{ uri: activity.image.url }} accessibilityIgnoresInvertColors accessibilityLabel={activity.name} style={styles((theme ?? _styleTheme)).optionImage} />
        : <IconText style={styles((theme ?? _styleTheme)).optionIcon}>{kind === 'optional' ? '💡' : '✨'}</IconText>}
      <View style={styles((theme ?? _styleTheme)).optionTextWrap}>
        <Text style={[styles((theme ?? _styleTheme)).optionLabel, colors && themeStyle('components_AddItemPopover_4', { colors }, (theme ?? _styleTheme))]}>{activity.name || 'Optional activity'}</Text>
        {activity.description ? <Text numberOfLines={3} style={[styles((theme ?? _styleTheme)).optionDescription, colors && themeStyle('components_AddItemPopover_5', { colors }, (theme ?? _styleTheme))]}>{activity.description}</Text> : null}
        {activity.image ? <Text style={styles((theme ?? _styleTheme)).optionCredit}>Photo: {activity.image.credit}</Text> : null}
      </View>
    </Pressable>
  );
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
          {optionalActivities.map((activity) => renderActivityOption(activity, 'optional', `Schedule ${activity.name || 'optional activity'} on this day`, onSelectOptionalActivity))}
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
            <IconText style={styles((theme ?? _styleTheme)).optionIcon}>{opt.icon}</IconText>
            <View style={styles((theme ?? _styleTheme)).optionTextWrap}>
              <Text style={[styles((theme ?? _styleTheme)).optionLabel, colors && themeStyle('components_AddItemPopover_4', { colors: colors }, (theme ?? _styleTheme))]}>{opt.label}</Text>
              <Text style={[styles((theme ?? _styleTheme)).optionDescription, colors && themeStyle('components_AddItemPopover_5', { colors: colors }, (theme ?? _styleTheme))]}>{opt.description}</Text>
            </View>
          </Pressable>
        ))}
        {mode === 'activities' && suggestedActivities.length > 0 && onSelectSuggestedActivity ? <>
          <Text style={[styles((theme ?? _styleTheme)).title, colors && themeStyle('components_AddItemPopover_2', { colors }, (theme ?? _styleTheme))]}>Suggested for this day</Text>
          {suggestedActivities.map((activity) => renderActivityOption(activity, 'suggested', `Add ${activity.name} on this day`, onSelectSuggestedActivity))}
        </> : null}
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
