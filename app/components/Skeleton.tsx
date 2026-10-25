import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';

type SkeletonProps = {
  style?: any;
  testID?: string;
};

const SkeletonComponent: React.FC<SkeletonProps> = ({ style, testID }) => { const _styleTheme = useStyleTheme(); return ((
  <View
    accessibilityRole="progressbar"
    accessibilityLabel="Loading"
    testID={testID ?? 'skeleton'}
    style={[styles(_styleTheme).base, style]}
  />
)); };

const Skeleton = memo(SkeletonComponent);

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_Skeleton_1', { StyleSheet: StyleSheet }, _theme);

export default Skeleton;
