import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon, { type IconName } from './Icon';
import { gradientFill, type AppTheme } from '../theme/theme';

export type BottomTab = { page: string; label: string; icon: IconName };
export type AddOption = { page: string; label: string; icon: IconName };

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
  bottomInset?: number;
};

/**
 * Phone navigation: four tabs with a raised Add button in the middle that opens a sheet of
 * things to add to the current trip. Account pages all count as the Profile tab.
 */
const BottomTabBar: React.FC<Props> = ({ theme, activePage, leftTabs, rightTabs, addOptions, addTitle, onNavigate, bottomInset = 0 }) => {
  const [addOpen, setAddOpen] = useState(false);
  const { colors } = theme;
  const dark = theme.mode === 'dark';
  const activePill = dark ? '#262626' : '#EFEFEF';
  const isActive = (page: string) => activePage === page || (page === 'account' && activePage.startsWith('account'));

  const renderTab = (tab: BottomTab) => {
    const active = isActive(tab.page);
    const tint = active ? colors.text : colors.textMuted;
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
        <View style={[styles.iconPill, active && { backgroundColor: activePill }]}>
          <Icon name={tab.icon} color={tint} />
        </View>
        <Text style={[styles.label, { color: tint, fontWeight: active ? '700' : '500' }]} numberOfLines={1}>{tab.label}</Text>
      </TouchableOpacity>
    );
  };

  const choose = (page: string) => {
    setAddOpen(false);
    onNavigate(page);
  };

  return (
    <>
      <View
        accessibilityRole="tablist"
        testID="bottom-tab-bar"
        style={[styles.bar, { paddingBottom: 6 + bottomInset, backgroundColor: dark ? '#0A0A0A' : colors.surface, borderTopColor: colors.border }]}
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
          <View style={[styles.addButton, { backgroundColor: colors.cta, borderColor: dark ? '#0A0A0A' : colors.surface }, gradientFill(theme.gradients.cta)]}>
            <Icon name={addOpen ? 'close' : 'plus'} color={colors.onCta} size={24} strokeWidth={2.2} />
          </View>
          <Text style={[styles.label, { color: colors.text, fontWeight: '600' }]}>{addOpen ? 'Close' : 'Add'}</Text>
        </TouchableOpacity>
        {rightTabs.map(renderTab)}
      </View>

      {addOpen ? (
      <Modal visible transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setAddOpen(false)} accessibilityLabel="Close add menu" testID="add-sheet-scrim" />
        <View
          style={[styles.sheet, { bottom: bottomInset + 12, backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityViewIsModal
          testID="add-sheet"
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={2}>{addTitle}</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.textMuted }]}>Pick what you want to add.</Text>
          <View style={styles.grid}>
            {addOptions.map((option) => (
              <TouchableOpacity
                key={option.page}
                style={[styles.option, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
                onPress={() => choose(option.page)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${option.label.toLowerCase()}`}
                testID={`add-option-${option.page}`}
              >
                <Icon name={option.icon} color={colors.text} size={26} />
                <Text style={[styles.optionLabel, { color: colors.text }]} numberOfLines={1}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.cancel, { borderColor: colors.border }]}
            onPress={() => setAddOpen(false)}
            accessibilityRole="button"
            testID="add-sheet-cancel"
          >
            <Text style={[styles.cancelText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
    minHeight: BOTTOM_TAB_BAR_HEIGHT,
    paddingTop: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
  },
  iconPill: {
    width: 52,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
  },
  addButton: {
    width: 56,
    height: 56,
    marginTop: -26,
    borderRadius: 28,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    left: 8,
    right: 8,
    borderRadius: 26,
    borderWidth: 1,
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 20,
    gap: 4,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  sheetSubtitle: {
    fontSize: 14,
    marginBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  option: {
    flexBasis: '30%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  optionLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  cancel: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default BottomTabBar;
