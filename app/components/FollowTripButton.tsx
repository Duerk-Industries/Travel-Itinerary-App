import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Modal from './KeyboardAwareModal';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
type Props = { styles: Record<string, any>; onFollowTrip: (code: string) => Promise<string | null> };
export default function FollowTripButton({ styles, onFollowTrip }: Props) {
  const _styleTheme = useStyleTheme();
  const safeAreaInsets = useSafeAreaInsets();
  const [showFollowDialog, setShowFollowDialog] = useState(false);
  const [followCodeInput, setFollowCodeInput] = useState('');
  const [followCodeError, setFollowCodeError] = useState('');
  const [followSubmitting, setFollowSubmitting] = useState(false);
  const submitFollowCode = async () => {
    if (followSubmitting) return;
    const code = followCodeInput.trim();
    if (!code) {
      setFollowCodeError('Enter a follow code');
      return;
    }
    setFollowSubmitting(true);
    setFollowCodeError('');
    let error: string | null;
    try { error = await onFollowTrip(code); } catch { error = 'Unable to follow trip. Please try again.'; }
    setFollowSubmitting(false);
    if (error) {
      setFollowCodeError(error);
      return;
    }
    setFollowCodeInput('');
    setShowFollowDialog(false);
  };

  return <>
    <Pressable accessibilityRole="button" testID="all-trips-follow-button" style={[styles.button, styles.smallButton]}
      onPress={() => { setFollowCodeError(''); setShowFollowDialog(true); }}>
      <Text style={styles.buttonText}>Follow Trip</Text>
    </Pressable>
      {showFollowDialog ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setShowFollowDialog(false)}>
          <View style={[styles.homeModalOverlay, themeStyle('tabs_HomeTab_20', { safeAreaInsets: safeAreaInsets }, _styleTheme)]} testID="all-trips-follow-dialog">
            <View style={styles.homeModalCard}>
              <View style={styles.homeModalHeader}>
                <Text style={styles.homeModalTitle}>Follow Trip</Text>
                <Pressable
                  onPress={() => setShowFollowDialog(false)}
                  style={({ pressed }: { pressed: boolean }) => [styles.homeModalClose, pressed && styles.homeModalClosePressed]}
                >
                  <Text style={styles.homeModalCloseText}>✕</Text>
                </Pressable>
              </View>
              <Text style={styles.homeModalRowMeta}>Enter a follow code to add a shared trip.</Text>
              <TextInput
                testID="all-trips-follow-code-input"
                style={[styles.input, themeStyle('tabs_HomeTab_15', {  }, _styleTheme)]}
                placeholder="Follow code"
                autoCapitalize="characters"
                autoCorrect={false}
                value={followCodeInput}
                onChangeText={(text: string) => {
                  setFollowCodeInput(text);
                  if (followCodeError) setFollowCodeError('');
                }}
              />
              {followCodeError ? <Text style={[styles.homeModalRowMeta, themeStyle('tabs_HomeTab_16', {  }, _styleTheme)]}>{followCodeError}</Text> : null}
              <View style={[styles.row, themeStyle('tabs_HomeTab_17', {  }, _styleTheme)]}>
                <Pressable
                  testID="all-trips-follow-cancel"
                  style={({ pressed }: { pressed: boolean }) => [
                    styles.button,
                    styles.smallButton,
                    styles.dangerButton,
                    pressed && styles.homeNavButtonPressed,
                  ]}
                  onPress={() => setShowFollowDialog(false)}
                >
                  <Text style={styles.dangerButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  testID="all-trips-follow-submit"
                  disabled={followSubmitting}
                  style={({ pressed }: { pressed: boolean }) => [
                    styles.button,
                    styles.smallButton,
                    themeStyle('tabs_HomeTab_18', {  }, _styleTheme),
                    pressed && styles.homeNavButtonPressed,
                  ]}
                  onPress={() => void submitFollowCode()}
                >
                  <Text style={styles.buttonText}>{followSubmitting ? 'Following...' : 'Follow Trip'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
  </>;
}
