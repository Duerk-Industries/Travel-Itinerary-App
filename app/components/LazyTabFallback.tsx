import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type LazyTabFallbackProps = {
  label?: string;
  testID?: string;
};

const LazyTabFallback: React.FC<LazyTabFallbackProps> = ({
  label = 'Loading…',
  testID = 'lazy-tab-fallback',
}) => (
  <View style={styles.container} testID={testID}>
    <ActivityIndicator size="large" color="#45B7C6" />
    <Text style={styles.label}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  label: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
});

export default LazyTabFallback;
