import { themeStyle } from '../theme/theme';
import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useAppTheme } from '../theme/ThemeContext';

export type DropdownAction = { id: string; label: string; onSelect: () => void };

export default function ActionDropdown({ actions, styles, testID }: {
  actions: DropdownAction[];
  styles: Record<string, any>;
  testID: string;
}) {
  const theme = useAppTheme();
  const { width, height } = useWindowDimensions();
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 56, right: 16 });
  const menuWidth = Math.min(260, width - 24);
  const showMenu = () => {
    anchor.current?.measureInWindow((x, y, w, h) => {
      setPosition({ top: Math.max(12, Math.min(y + h + 6, height - 240)), right: Math.max(12, width - x - w) });
    });
    setOpen(true);
  };
  return <>
    <View ref={anchor} collapsable={false}>
      <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityLabel="Menu" accessibilityState={{ expanded: open }} style={[styles.button, styles.smallButton]} onPress={showMenu}>
        <Text style={styles.buttonText}>Menu ▾</Text>
      </TouchableOpacity>
    </View>
    {open ? <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={themeStyle('components_ActionDropdown_layout1', {  }, theme)} onAccessibilityEscape={() => setOpen(false)}>
        <Pressable testID={`${testID}-dismiss`} accessibilityRole="button" accessibilityLabel="Close menu" style={themeStyle('components_ActionDropdown_layout2', {  }, theme)} onPress={() => setOpen(false)} />
        <View testID={`${testID}-panel`} accessibilityRole="menu" style={themeStyle('components_ActionDropdown_layout3', { theme, position, menuWidth, height }, theme)}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {actions.map((action) => <TouchableOpacity key={action.id} testID={action.id} accessibilityRole="menuitem" style={themeStyle('components_ActionDropdown_layout4', {  }, theme)} onPress={() => { setOpen(false); action.onSelect(); }}>
              <Text style={themeStyle('components_ActionDropdown_layout5', { theme }, theme)}>{action.label}</Text>
            </TouchableOpacity>)}
          </ScrollView>
        </View>
      </View>
    </Modal> : null}
  </>;
}
