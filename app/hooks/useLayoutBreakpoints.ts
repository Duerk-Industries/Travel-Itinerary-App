import { useWindowDimensions } from 'react-native';

/**
 * Viewport breakpoints currently used throughout App.tsx and extracted tabs.
 * Two breakpoints land most of the conditional rendering:
 *   - `narrow` (< 980px) — stacks the top bar, narrows the trip selector
 *   - `phone`  (< 680px) — drops the inline account button from the header
 */
export const LAYOUT_BREAKPOINT_NARROW = 980;
export const LAYOUT_BREAKPOINT_PHONE = 680;

export interface LayoutBreakpoints {
  viewportWidth: number;
  isNarrowLayout: boolean;
  isPhoneLayout: boolean;
}

/**
 * Wraps `useWindowDimensions()` with the two breakpoints App.tsx has been
 * using since the responsive layout pass. Keeps the thresholds in one place
 * so future tabs can share them without hard-coding magic numbers.
 */
export function useLayoutBreakpoints(): LayoutBreakpoints {
  const { width: viewportWidth } = useWindowDimensions();
  return {
    viewportWidth,
    isNarrowLayout: viewportWidth < LAYOUT_BREAKPOINT_NARROW,
    isPhoneLayout: viewportWidth < LAYOUT_BREAKPOINT_PHONE,
  };
}
