import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon, { type IconName } from './Icon';
import { themeStyle, type AppTheme } from '../theme/theme';

export type BottomTab = { page: string; label: string; icon: IconName };
export type AddOptionKey = 'expense' | 'blog' | 'activity' | 'flight' | 'lodging' | 'import';
export type AddOption = { key: AddOptionKey; label: string; icon: IconName };

/** Height of the bar above the bottom safe-area inset; floating buttons sit above it. */
export const BOTTOM_TAB_BAR_HEIGHT = 64;

type Props = {
  theme: AppTheme;
  activePage: string;
  /** Left pair and right pair; the Add button sits between them. */
  leftTabs: [BottomTab, BottomTab];
  rightTabs: [BottomTab, BottomTab];
  addOptions: AddOption[];
  addTitle: string;
  onNavigate: (page: string) => void;
  /** An Add menu option was chosen; open that item's add form. */
  onChooseAdd: (key: AddOptionKey) => void;
  bottomInset?: number;
};

/**
 * Phone navigation: four tabs with a raised Add button in the middle that opens a sheet of
 * things to add to the current trip. Account pages all count as the Profile tab.
 */
const BottomTabBar: React.FC<Props> = ({ theme, activePage, leftTabs, rightTabs, addOptions, addTitle, onNavigate, onChooseAdd, bottomInset = 0 }) => {
  const [addOpen, setAddOpen] = useState(false);
  const styles = themeStyle('components_BottomTabBar_1', { StyleSheet: StyleSheet, BOTTOM_TAB_BAR_HEIGHT: BOTTOM_TAB_BAR_HEIGHT }, theme);
  const isActive = (page: string) => activePage === page || (page === 'account' && activePage.startsWith('account'));

  const renderTab = (tab: BottomTab) => {
    const active = isActive(tab.page);
    const tint = themeStyle('components_BottomTabBar_5', { active: active }, theme);
    return (
      <TouchableOpacity
        key={tab.page}
        style={styles.tab}
        onPress={() => onNavigate(tab.page)}
        accessibilityRole="tab"
        accessibilityLabel={tab.label}
        accessibilityState={{ selected: active }}
        testID={`bottom-tab-${tab.page}`}
      >
        <View style={[styles.iconPill, active && themeStyle('components_BottomTabBar_3', {  }, theme)]}>
          <Icon name={tab.icon} color={tint} />
        </View>
        <Text style={[styles.label, themeStyle('components_BottomTabBar_4', { active: active }, theme)]} numberOfLines={1}>{tab.label}</Text>
      </TouchableOpacity>
    );
  };

  const choose = (key: AddOptionKey) => {
    setAddOpen(false);
    onChooseAdd(key);
  };

  return (
    <>
      <View
        accessibilityRole="tablist"
        testID="bottom-tab-bar"
        style={[styles.bar, themeStyle('components_BottomTabBar_2', { bottomInset: bottomInset }, theme)]}
      >
        {leftTabs.map(renderTab)}
        <TouchableOpacity
          style={styles.tab}
          onPress={() => setAddOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={addOpen ? 'Close add menu' : 'Add to trip'}
          accessibilityState={{ expanded: addOpen }}
          testID="bottom-tab-add"
        >
          <View style={styles.addButton}>
            <Icon name={addOpen ? 'close' : 'plus'} color={themeStyle('components_BottomTabBar_7', {  }, theme)} size={24} strokeWidth={2.2} />
          </View>
          <Text style={styles.addLabel}>{addOpen ? 'Close' : 'Add'}</Text>
        </TouchableOpacity>
        {rightTabs.map(renderTab)}
      </View>

      {addOpen ? (
      <Modal visible transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setAddOpen(false)} accessibilityLabel="Close add menu" testID="add-sheet-scrim" />
        <View
          style={[styles.sheet, themeStyle('components_BottomTabBar_6', { bottomInset: bottomInset }, theme)]}
          accessibilityViewIsModal
          testID="add-sheet"
        >
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle} numberOfLines={2}>{addTitle}</Text>
          <Text style={styles.sheetSubtitle}>Pick what you want to add.</Text>
          <View style={styles.grid}>
            {addOptions.map((option) => (
              <TouchableOpacity
                key={option.key}
                style={styles.option}
                onPress={() => choose(option.key)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${option.label.toLowerCase()}`}
                testID={`add-option-${option.key}`}
              >
                <Icon name={option.icon} color={themeStyle('components_BottomTabBar_8', {  }, theme)} size={26} />
                <Text style={styles.optionLabel} numberOfLines={1}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={styles.cancel}
            onPress={() => setAddOpen(false)}
            accessibilityRole="button"
            testID="add-sheet-cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
      ) : null}
    </>
  );
};

export default BottomTabBar;
