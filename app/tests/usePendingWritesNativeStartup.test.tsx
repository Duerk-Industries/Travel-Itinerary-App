/** @jest-environment node */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { usePendingWrites } from '../hooks/usePendingWrites';
import { transactionalPendingWriteStore } from '../utils/pendingWriteStore';

jest.mock('../utils/pendingWriteStore', () => ({
  transactionalPendingWriteStore: {
    read: jest.fn(async () => []),
    subscribe: jest.fn(() => jest.fn()),
  },
}));

describe('native pending-expense startup', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousPlatform = Platform.OS;
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    // Hermes exposes window === globalThis, without DOM event methods.
    Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  });
  afterEach(() => {
    Platform.OS = previousPlatform;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  it('keeps web focus refresh and cleans up the browser listener', async () => {
    Platform.OS = 'web';
    const target = new EventTarget();
    const remove = jest.spyOn(target, 'removeEventListener');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
    const { unmount } = renderHook(() => usePendingWrites({ storageKey: 'stp.pending-expenses.anonymous' }));
    await waitFor(() => expect(transactionalPendingWriteStore!.read).toHaveBeenCalledTimes(1));
    await act(async () => { target.dispatchEvent(new Event('focus')); });
    expect(transactionalPendingWriteStore!.read).toHaveBeenCalledTimes(2);
    unmount();
    expect(remove).toHaveBeenCalledWith('focus', expect.any(Function));
  });

  it('mounts with native storage before login without calling browser event APIs', async () => {
    const { result, unmount } = renderHook(() => usePendingWrites({
      storageKey: 'stp.pending-expenses.anonymous',
    }));
    await waitFor(() => expect(transactionalPendingWriteStore!.read).toHaveBeenCalled());
    expect(result.current.storageError).toBeNull();
    unmount();
  });

  it('refreshes on native foreground and removes its subscription on unmount', async () => {
    const remove = jest.fn();
    let foreground: ((state: AppStateStatus) => void) | undefined;
    const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      foreground = callback;
      return { remove };
    });
    try {
      const { unmount } = renderHook(() => usePendingWrites({ storageKey: 'stp.pending-expenses.anonymous' }));
      await waitFor(() => expect(transactionalPendingWriteStore!.read).toHaveBeenCalledTimes(1));
      act(() => foreground?.('background'));
      expect(transactionalPendingWriteStore!.read).toHaveBeenCalledTimes(1);
      await act(async () => { foreground?.('active'); });
      expect(transactionalPendingWriteStore!.read).toHaveBeenCalledTimes(2);
      unmount();
      expect(remove).toHaveBeenCalledTimes(1);
    } finally { listener.mockRestore(); }
  });
});
