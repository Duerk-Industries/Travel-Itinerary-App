import { ThemedText as Text } from './ThemedText';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Platform, ScrollView, TouchableOpacity, View } from 'react-native';
import Modal from './KeyboardAwareModal';

export default function PendingExpenseLogoutDialog({ visible, count, onCancel, onSync, onKeep, onDiscard, busy = false, error }: {
  visible: boolean; count: number; onCancel: () => void; onSync: () => void;
  onKeep: () => void; onDiscard: () => void; busy?: boolean; error?: string | null;
}) {
  const _styleTheme = useStyleTheme();
  const button = (label: string, action: () => void) => <TouchableOpacity accessibilityRole="button"
    accessibilityLabel={label} disabled={busy} accessibilityState={{ disabled: busy, busy }} onPress={action} style={themeStyle('components_PendingExpenseLogoutDialog_1', {  }, _styleTheme)}><Text>{label}</Text></TouchableOpacity>;
  return <Modal visible={visible} transparent onRequestClose={busy ? () => undefined : onCancel}>
    <View style={themeStyle('components_PendingExpenseLogoutDialog_2', {  }, _styleTheme)}>
      <View accessibilityViewIsModal style={themeStyle('components_PendingExpenseLogoutDialog_3', {  }, _styleTheme)}>
        <ScrollView style={themeStyle('dialogScroll', {}, _styleTheme)} keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator>
        <Text accessibilityRole="header">{error && count === 0 ? 'Saved expenses need recovery' : `${count} unsynced expense${count === 1 ? '' : 's'}`}</Text>
        <Text>These expenses are saved only on this device. Retained work becomes available when you sign in to the same account. {Platform.OS === 'web' ? 'Browser storage is not encrypted by the app; avoid retaining it on a shared device.' : 'Saved expenses use device encryption. Sync or export a recovery copy before reinstalling the app or changing devices; a lost device key cannot decrypt unsynced work.'}</Text>
        {error && <Text accessibilityRole="alert">{error}</Text>}
        {button('Sync now and stay signed in', onSync)}
        {button('Keep on this device and sign out', onKeep)}
        {button('Discard expenses and sign out', onDiscard)}
        {button('Cancel', onCancel)}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
