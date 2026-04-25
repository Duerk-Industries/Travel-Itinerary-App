/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react-native';

// Mock useWindowDimensions so we can drive the hook's output deterministically.
const mockDimensions = { width: 1280 };
jest.mock('react-native', () => ({
  useWindowDimensions: () => ({ width: mockDimensions.width, height: 720 }),
}));

import {
  LAYOUT_BREAKPOINT_NARROW,
  LAYOUT_BREAKPOINT_PHONE,
  useLayoutBreakpoints,
} from '../hooks/useLayoutBreakpoints';

describe('useLayoutBreakpoints', () => {
  it('returns desktop layout (neither narrow nor phone) above the narrow breakpoint', () => {
    mockDimensions.width = 1280;
    const { result } = renderHook(() => useLayoutBreakpoints());
    expect(result.current.viewportWidth).toBe(1280);
    expect(result.current.isNarrowLayout).toBe(false);
    expect(result.current.isPhoneLayout).toBe(false);
  });

  it('reports isNarrowLayout when viewport is just under the narrow breakpoint', () => {
    mockDimensions.width = LAYOUT_BREAKPOINT_NARROW - 1;
    const { result } = renderHook(() => useLayoutBreakpoints());
    expect(result.current.isNarrowLayout).toBe(true);
    expect(result.current.isPhoneLayout).toBe(false);
  });

  it('treats the narrow breakpoint itself as the desktop side of the boundary', () => {
    mockDimensions.width = LAYOUT_BREAKPOINT_NARROW;
    const { result } = renderHook(() => useLayoutBreakpoints());
    expect(result.current.isNarrowLayout).toBe(false);
  });

  it('reports both isNarrowLayout + isPhoneLayout below the phone breakpoint', () => {
    mockDimensions.width = LAYOUT_BREAKPOINT_PHONE - 1;
    const { result } = renderHook(() => useLayoutBreakpoints());
    expect(result.current.isNarrowLayout).toBe(true);
    expect(result.current.isPhoneLayout).toBe(true);
  });
});
