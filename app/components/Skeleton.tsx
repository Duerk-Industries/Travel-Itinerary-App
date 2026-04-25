import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';

type SkeletonProps = {
  style?: any;
  testID?: string;
};

const SkeletonComponent: React.FC<SkeletonProps> = ({ style, testID }) => (
  <View
    accessibilityRole="progressbar"
    accessibilityLabel="Loading"
    testID={testID ?? 'skeleton'}
    style={[styles.base, style]}
  />
);

const Skeleton = memo(SkeletonComponent);

const styles = StyleSheet.create({
  base: {
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
    opacity: 0.8,
  },
});

export default Skeleton;
