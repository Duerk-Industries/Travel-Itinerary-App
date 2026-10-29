import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type LazyTabFallbackProps = {
  label?: string;
  testID?: string;
};

const LazyTabFallback: React.FC<LazyTabFallbackProps> = ({
  label = 'Loading…',
  testID = 'lazy-tab-fallback',
}) => { const _styleTheme = useStyleTheme(); return ((
  <View style={styles(_styleTheme).container} testID={testID}>
    <ActivityIndicator size="large" color={themeStyle('components_LazyTabFallback_2', {  }, _styleTheme)} />
    <Text style={styles(_styleTheme).label}>{label}</Text>
  </View>
)); };

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_LazyTabFallback_1', { StyleSheet: StyleSheet }, _theme);

export default LazyTabFallback;
