/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react-native';

type Handler = (...args: unknown[]) => void;
const socketListeners = new Map<string, Set<Handler>>();
const socketOnceListeners = new Map<string, Set<Handler>>();
const emitted: Array<{ event: string; args: unknown[] }> = [];

const socketMock = {
  connected: false,
  on: jest.fn((event: string, handler: Handler) => {
    if (!socketListeners.has(event)) socketListeners.set(event, new Set());
    socketListeners.get(event)!.add(handler);
  }),
  once: jest.fn((event: string, handler: Handler) => {
    if (!socketOnceListeners.has(event)) socketOnceListeners.set(event, new Set());
    socketOnceListeners.get(event)!.add(handler);
  }),
  off: jest.fn((event: string, handler: Handler) => {
    socketListeners.get(event)?.delete(handler);
  }),
  emit: jest.fn((event: string, ...args: unknown[]) => {
    emitted.push({ event, args });
  }),
};

const fireEvent = (event: string, ...args: unknown[]): void => {
  for (const h of socketListeners.get(event) ?? []) h(...args);
};

const fireOnce = (event: string, ...args: unknown[]): void => {
  const set = socketOnceListeners.get(event);
  if (!set) return;
  for (const h of [...set]) {
    h(...args);
    set.delete(h);
  }
};

jest.mock('../utils/socket', () => ({
  getSocket: () => socketMock,
  connectSocket: jest.fn(),
  disconnectSocket: jest.fn(),
  CLIENT_EVENTS: { JOIN_TRIP: 'join_trip' },
  SERVER_EVENTS: { PRESENCE_UPDATE: 'presence_update', UNREAD_COUNT: 'unread_count' },
}));

jest.mock('../../packages/messaging/src/events', () => ({
  CLIENT_EVENTS: { JOIN_TRIP: 'join_trip' },
  SERVER_EVENTS: { PRESENCE_UPDATE: 'presence_update', UNREAD_COUNT: 'unread_count' },
}));

import { useChatState } from '../hooks/useChatState';

describe('useChatState', () => {
  beforeEach(() => {
    socketListeners.clear();
    socketOnceListeners.clear();
    emitted.length = 0;
    socketMock.connected = false;
    socketMock.emit.mockClear();
    socketMock.on.mockClear();
    socketMock.off.mockClear();
    socketMock.once.mockClear();
  });

  it('starts with the chat closed, no unread, and empty presence', () => {
    const { result } = renderHook(() =>
      useChatState({ activeTripId: null, userToken: null })
    );
    expect(result.current.chatOpen).toBe(false);
    expect(result.current.chatMinimized).toBe(false);
    expect(result.current.chatUnread).toBe(0);
    expect(result.current.presenceUsers).toEqual([]);
  });

  it('does not subscribe when userToken or activeTripId are missing', () => {
    renderHook(() => useChatState({ activeTripId: null, userToken: 't' }));
    renderHook(() => useChatState({ activeTripId: 'x', userToken: null }));
    expect(socketMock.on).not.toHaveBeenCalled();
    expect(socketMock.emit).not.toHaveBeenCalled();
  });

  it('joins the trip room immediately when the socket is already connected', () => {
    socketMock.connected = true;
    renderHook(() => useChatState({ activeTripId: 't-1', userToken: 'tok' }));
    expect(socketMock.emit).toHaveBeenCalledWith('join_trip', 't-1');
    expect(socketMock.once).not.toHaveBeenCalled();
  });

  it('waits for connect then joins when the socket is offline at mount', () => {
    socketMock.connected = false;
    renderHook(() => useChatState({ activeTripId: 't-2', userToken: 'tok' }));
    expect(socketMock.emit).not.toHaveBeenCalled();
    expect(socketMock.once).toHaveBeenCalledWith('connect', expect.any(Function));
    act(() => fireOnce('connect'));
    expect(socketMock.emit).toHaveBeenCalledWith('join_trip', 't-2');
  });

  it('reflects presence list updates and unread count events', () => {
    socketMock.connected = true;
    const { result } = renderHook(() =>
      useChatState({ activeTripId: 't-1', userToken: 'tok' })
    );
    act(() => {
      fireEvent('presence_update', [{ userId: 'u-1', name: 'Ada' }]);
      fireEvent('unread_count', { tripId: 't-1', count: 3 });
    });
    expect(result.current.presenceUsers).toEqual([{ userId: 'u-1', name: 'Ada' }]);
    expect(result.current.chatUnread).toBe(3);
  });

  it('ignores unread updates that target a different trip', () => {
    socketMock.connected = true;
    const { result } = renderHook(() =>
      useChatState({ activeTripId: 't-1', userToken: 'tok' })
    );
    act(() => {
      fireEvent('unread_count', { tripId: 't-other', count: 99 });
    });
    expect(result.current.chatUnread).toBe(0);
  });

  it('openChat opens and un-minimizes', () => {
    const { result } = renderHook(() =>
      useChatState({ activeTripId: null, userToken: null })
    );
    act(() => {
      result.current.setChatMinimized(true);
    });
    act(() => {
      result.current.openChat();
    });
    expect(result.current.chatOpen).toBe(true);
    expect(result.current.chatMinimized).toBe(false);
  });

  it('closeChat / minimizeChat / restoreChat toggle expected flags', () => {
    const { result } = renderHook(() =>
      useChatState({ activeTripId: null, userToken: null })
    );
    act(() => result.current.openChat());
    act(() => result.current.minimizeChat());
    expect(result.current.chatMinimized).toBe(true);
    act(() => result.current.restoreChat());
    expect(result.current.chatMinimized).toBe(false);
    act(() => result.current.closeChat());
    expect(result.current.chatOpen).toBe(false);
  });

  it('clearChatState resets everything', () => {
    socketMock.connected = true;
    const { result } = renderHook(() =>
      useChatState({ activeTripId: 't-1', userToken: 'tok' })
    );
    act(() => {
      fireEvent('presence_update', [{ userId: 'u-1', name: 'Ada' }]);
      fireEvent('unread_count', { tripId: 't-1', count: 5 });
      result.current.openChat();
      result.current.minimizeChat();
    });
    act(() => result.current.clearChatState());
    expect(result.current.presenceUsers).toEqual([]);
    expect(result.current.chatUnread).toBe(0);
    expect(result.current.chatOpen).toBe(false);
    expect(result.current.chatMinimized).toBe(false);
  });

  it('removes listeners on unmount', () => {
    socketMock.connected = true;
    const { unmount } = renderHook(() =>
      useChatState({ activeTripId: 't-1', userToken: 'tok' })
    );
    unmount();
    expect(socketMock.off).toHaveBeenCalledWith('presence_update', expect.any(Function));
    expect(socketMock.off).toHaveBeenCalledWith('unread_count', expect.any(Function));
  });
});
