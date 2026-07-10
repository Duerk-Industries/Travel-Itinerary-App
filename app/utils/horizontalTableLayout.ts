import type { ViewStyle } from 'react-native';

export const horizontalTableLayout = {
  table: {
    minWidth: '100%',
    alignSelf: 'flex-start',
  } satisfies ViewStyle,
  scroll: {
    width: '100%',
    maxWidth: '100%',
  } satisfies ViewStyle,
  content: {
    minWidth: '100%',
  } satisfies ViewStyle,
};
