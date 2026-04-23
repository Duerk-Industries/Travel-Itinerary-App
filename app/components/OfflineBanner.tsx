import React from 'react';
import { Text, View } from 'react-native';
import { useConnectionState } from '../hooks/useConnectionState';

type OfflineBannerProps = {
  /** Optional style overrides. Banner is hidden when connection is healthy. */
  containerStyle?: Record<string, unknown>;
  textStyle?: Record<string, unknown>;
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

const OfflineBanner: React.FC<OfflineBannerProps> = ({ containerStyle, textStyle }) => {
  const { status, isDegraded } = useConnectionState();
  if (!isDegraded) return null;
  const message = messageFor(status);
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
