import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useScreenCache } from './ScreenCacheProvider';
import { themeStyle } from '../theme/theme';
import { useAppTheme } from '../theme/ThemeContext';

export default function ScreenCacheStatus() {
  const cache = useScreenCache();
  const theme = useAppTheme();
  if (!cache?.stale) return null;
  return <View accessibilityLiveRegion="polite" testID="screen-cache-status" style={themeStyle('cache_ScreenCacheStatus_container', {}, theme)}>
    <Text style={themeStyle('cache_ScreenCacheStatus_text', {}, theme)}>Showing saved information. Some details could not be refreshed.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Retry refreshing saved information" onPress={cache.refresh}>
      <Text style={themeStyle('cache_ScreenCacheStatus_link', {}, theme)}>Retry</Text>
    </Pressable>
  </View>;
}
