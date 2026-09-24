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
};

const defaultContainer: Record<string, unknown> = {
  paddingVertical: 6,
  paddingHorizontal: 12,
  backgroundColor: '#d97706',
  alignItems: 'center',
};

const defaultText: Record<string, unknown> = {
  color: '#ffffff',
  fontSize: 13,
  fontWeight: '600',
};

const messageFor = (status: string): string => {
  if (status === 'offline') return 'Offline — changes will not be saved until you reconnect.';
  if (status === 'reconnecting') return 'Reconnecting…';
  return '';
};

const OfflineBanner: React.FC<OfflineBannerProps> = ({ containerStyle, textStyle, status, offlineReadOnly = false }) => {
  const isDegraded = status !== 'online';
  if (!isDegraded && !offlineReadOnly) return null;
  const message = offlineReadOnly ? 'Offline — cached trip data is read-only.' : messageFor(status);
  return (
    <View
      style={[defaultContainer, containerStyle] as any}
      testID="offline-banner"
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={message}
    >
      <Text style={[defaultText, textStyle] as any}>{message}</Text>
    </View>
  );
};

export default OfflineBanner;
