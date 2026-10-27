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
      <View style={{ flex: 1 }} onAccessibilityEscape={() => setOpen(false)}>
        <Pressable testID={`${testID}-dismiss`} accessibilityRole="button" accessibilityLabel="Close menu" style={{ position: 'absolute', inset: 0 }} onPress={() => setOpen(false)} />
        <View testID={`${testID}-panel`} accessibilityRole="menu" style={{ position: 'absolute', top: position.top, right: position.right, width: menuWidth, maxHeight: Math.max(120, height - position.top - 12), backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, paddingVertical: 6, elevation: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {actions.map((action) => <TouchableOpacity key={action.id} testID={action.id} accessibilityRole="menuitem" style={{ paddingHorizontal: 18, paddingVertical: 13 }} onPress={() => { setOpen(false); action.onSelect(); }}>
              <Text style={{ color: theme.colors.text, fontSize: 15 }}>{action.label}</Text>
            </TouchableOpacity>)}
          </ScrollView>
        </View>
      </View>
    </Modal> : null}
  </>;
}
