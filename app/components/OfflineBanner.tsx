import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Text, View } from 'react-native';
import type { ConnectionStatus } from '../hooks/useConnectionState';

type OfflineBannerProps = {
  /** Optional style overrides. Banner is hidden when connection is healthy. */
  containerStyle?: Record<string, unknown>;
  textStyle?: Record<string, unknown>;
  /** Supplied by the app's single connection-state subscription. */
  status: ConnectionStatus;
  /** Cached trip data is visible, but editing must remain unavailable offline. */
  offlineReadOnly?: boolean;
  /** False when nobody is signed in: the message then says what to do (connect), not what is read-only. */
  signedIn?: boolean;
  /** New expenses can still be added offline (they sync when the connection returns). */
  canAddExpenses?: boolean;
};

const defaultContainer = (_theme: import('../theme/theme').AppTheme): Record<string, unknown> => themeStyle('components_OfflineBanner_1', {  }, _theme);

const defaultText = (_theme: import('../theme/theme').AppTheme): Record<string, unknown> => themeStyle('components_OfflineBanner_2', {  }, _theme);

const messageFor = (status: string): string => {
  if (status === 'offline') return 'Offline — changes will not be saved until you reconnect.';
  if (status === 'reconnecting') return 'Reconnecting…';
  return '';
};

const OfflineBanner: React.FC<OfflineBannerProps> = ({
  containerStyle, textStyle, status, offlineReadOnly = false, signedIn = true, canAddExpenses = false,
}) => {
  const _styleTheme = useStyleTheme();
  const isDegraded = status !== 'online';
  if (!isDegraded && !offlineReadOnly) return null;
  const message = !signedIn && status === 'offline'
    ? "You're offline. Connect to the internet to sign in."
    : offlineReadOnly && canAddExpenses
      ? 'Offline — you can still add expenses. Everything else is read-only until you reconnect.'
      : offlineReadOnly
        ? 'Offline — cached trip data is read-only.'
        : messageFor(status);
  return (
    <View
      style={[defaultContainer(_styleTheme), containerStyle] as any}
      testID="offline-banner"
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={message}
    >
      <Text style={[defaultText(_styleTheme), textStyle] as any}>{message}</Text>
    </View>
  );
};

export default OfflineBanner;
