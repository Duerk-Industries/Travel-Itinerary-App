import { Platform } from 'react-native';
import { useLayoutBreakpoints } from './useLayoutBreakpoints';

/** CSV tools belong to the desktop web layout, outside the mobile icon-bar flow. */
export function useCsvControlsVisible(): boolean {
  const { isPhoneLayout } = useLayoutBreakpoints();
  return Platform.OS === 'web' && !isPhoneLayout;
}
