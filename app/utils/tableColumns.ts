import type { ViewStyle } from 'react-native';

/**
 * A table cell must have an identical measured width in its header and in
 * every body row. `flex: 1` with only a minimum width allows content in one
 * row to redistribute the remaining space, which makes column borders drift.
 *
 * Keep the width fixed and let `HorizontalTableScroll` provide access to
 * overflow on compact native and web screens.
 */
export const fixedTableColumn = (width: number): ViewStyle => ({
  width,
  minWidth: width,
  maxWidth: width,
  flexGrow: 0,
  flexShrink: 0,
});
