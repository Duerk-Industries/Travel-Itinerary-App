import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

type OfflineUnlockScreenProps = {
  name: string | null;
  isUnlocking: boolean;
  message: string | null;
  onUnlock: () => void;
  styles: Record<string, any>;
};

const OfflineUnlockScreen: React.FC<OfflineUnlockScreenProps> = ({ name, isUnlocking, message, onUnlock, styles }) => (
  <View style={[styles.signedOutScroll, { justifyContent: 'center', padding: 24 }]} testID="offline-unlock-screen">
    <View style={[styles.card, { maxWidth: 460, width: '100%', alignSelf: 'center', gap: 12 }]}>
      <Text style={styles.sectionTitle}>Unlock cached trips</Text>
      <Text style={styles.helperText}>
        {name ? `${name}'s` : 'Your'} trip information is available on this phone for up to 30 days after an online sign-in.
      </Text>
      <Text style={styles.helperText}>Use this device’s biometrics or PIN to view it while offline.</Text>
      {message ? <Text style={styles.warningText}>{message}</Text> : null}
      <TouchableOpacity
        style={[styles.button, isUnlocking && styles.buttonDisabled]}
        onPress={onUnlock}
        disabled={isUnlocking}
        accessibilityRole="button"
        accessibilityLabel="Unlock cached trips"
        testID="offline-unlock-button"
      >
        <Text style={styles.buttonText}>{isUnlocking ? 'Unlocking…' : 'Unlock cached trips'}</Text>
      </TouchableOpacity>
    </View>
  </View>
);

export default OfflineUnlockScreen;
