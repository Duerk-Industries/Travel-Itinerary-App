import React from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';

export default function PendingExpenseLogoutDialog({ visible, count, onCancel, onSync, onKeep, onDiscard }: {
  visible: boolean; count: number; onCancel: () => void; onSync: () => void;
  onKeep: () => void; onDiscard: () => void;
}) {
  const button = (label: string, action: () => void) => <TouchableOpacity accessibilityRole="button"
    accessibilityLabel={label} onPress={action} style={{ minHeight: 44, padding: 12 }}><Text>{label}</Text></TouchableOpacity>;
  return <Modal visible={visible} transparent onRequestClose={onCancel}>
    <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 20 }}>
      <View accessibilityViewIsModal style={{ padding: 20, backgroundColor: '#fff', borderRadius: 12 }}>
        <Text accessibilityRole="header">{count} unsynced expense{count === 1 ? '' : 's'}</Text>
        <Text>These expenses are saved only on this device. Retained work becomes available when you sign in to the same account. Device storage is not encrypted by the app; avoid retaining it on a shared device.</Text>
        {button('Sync now and stay signed in', onSync)}
        {button('Keep on this device and sign out', onKeep)}
        {button('Discard expenses and sign out', onDiscard)}
        {button('Cancel', onCancel)}
      </View>
    </View>
  </Modal>;
}
