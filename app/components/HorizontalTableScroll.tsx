import React from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';

type HorizontalTableScrollProps = Omit<ScrollViewProps, 'horizontal'>;

const HorizontalTableScroll = ({ children, ...props }: HorizontalTableScrollProps) => (
  <ScrollView
    {...props}
    horizontal
    nestedScrollEnabled
    showsHorizontalScrollIndicator
    alwaysBounceHorizontal
    keyboardShouldPersistTaps="handled"
    directionalLockEnabled
  >
    {children}
  </ScrollView>
);

export default HorizontalTableScroll;
