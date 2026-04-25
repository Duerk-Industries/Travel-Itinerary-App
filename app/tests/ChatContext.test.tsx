/**
 * @jest-environment jsdom
 */

import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';

type Handler = (...args: unknown[]) => void;
const socketListeners = new Map<string, Set<Handler>>();

const socketMock = {
  connected: false,
  on: jest.fn((event: string, handler: Handler) => {
    if (!socketListeners.has(event)) socketListeners.set(event, new Set());
    socketListeners.get(event)!.add(handler);
  }),
  once: jest.fn(),
  off: jest.fn((event: string, handler: Handler) => {
    socketListeners.get(event)?.delete(handler);
  }),
  emit: jest.fn(),
};

const fireEvent = (event: string, ...args: unknown[]): void => {
  for (const h of socketListeners.get(event) ?? []) h(...args);
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

import { ChatProvider, useChat } from '../contexts/ChatContext';

type WrapperProps = { activeTripId: string | null; userToken: string | null; children: React.ReactNode };

const Wrapper: React.FC<WrapperProps> = ({ activeTripId, userToken, children }) => (
  <ChatProvider activeTripId={activeTripId} userToken={userToken}>
    {children}
  </ChatProvider>
);

describe('ChatContext', () => {
  beforeEach(() => {
    socketListeners.clear();
    socketMock.connected = false;
    socketMock.emit.mockClear();
    socketMock.on.mockClear();
    socketMock.off.mockClear();
    socketMock.once.mockClear();
  });

  it('starts with the chat closed and no unread', () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: ({ children }) => <Wrapper activeTripId={null} userToken={null}>{children}</Wrapper>,
    });
    expect(result.current.chatOpen).toBe(false);
    expect(result.current.chatMinimized).toBe(false);
    expect(result.current.chatUnread).toBe(0);
  });

  it('does not subscribe when userToken or activeTripId are missing', () => {
    renderHook(() => useChat(), {
      wrapper: ({ children }) => <Wrapper activeTripId={null} userToken="t">{children}</Wrapper>,
    });
    renderHook(() => useChat(), {
      wrapper: ({ children }) => <Wrapper activeTripId="x" userToken={null}>{children}</Wrapper>,
    });
    expect(socketMock.on).not.toHaveBeenCalled();
  });

  it('updates the unread count when a matching UNREAD_COUNT event arrives', () => {
    socketMock.connected = true;
    const { result } = renderHook(() => useChat(), {
      wrapper: ({ children }) => <Wrapper activeTripId="t-1" userToken="tok">{children}</Wrapper>,
    });
    act(() => {
      fireEvent('unread_count', { tripId: 't-1', count: 3 });
    });
    expect(result.current.chatUnread).toBe(3);
  });

  it('ignores unread updates that target a different trip', () => {
    socketMock.connected = true;
    const { result } = renderHook(() => useChat(), {
      wrapper: ({ children }) => <Wrapper activeTripId="t-1" userToken="tok">{children}</Wrapper>,
    });
    act(() => {
      fireEvent('unread_count', { tripId: 't-other', count: 99 });
    });
    expect(result.current.chatUnread).toBe(0);
  });

  it('openChat opens and un-minimizes', () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: ({ children }) => <Wrapper activeTripId={null} userToken={null}>{children}</Wrapper>,
    });
    act(() => result.current.minimizeChat());
    act(() => result.current.openChat());
    expect(result.current.chatOpen).toBe(true);
    expect(result.current.chatMinimized).toBe(false);
  });

  it('closeChat / minimizeChat / restoreChat toggle expected flags', () => {
    const { result } = renderHook(() => useChat(), {
      wrapper: ({ children }) => <Wrapper activeTripId={null} userToken={null}>{children}</Wrapper>,
    });
    act(() => result.current.openChat());
    act(() => result.current.minimizeChat());
    expect(result.current.chatMinimized).toBe(true);
    act(() => result.current.restoreChat());
    expect(result.current.chatMinimized).toBe(false);
    act(() => result.current.closeChat());
    expect(result.current.chatOpen).toBe(false);
  });

  it('resets state when userToken becomes null', () => {
    socketMock.connected = true;
    const seen: Array<{ chatOpen: boolean; chatMinimized: boolean; chatUnread: number }> = [];
    let capturedActions: { openChat: () => void; minimizeChat: () => void } | null = null;
    const Probe: React.FC = () => {
      const ctx = useChat();
      capturedActions = { openChat: ctx.openChat, minimizeChat: ctx.minimizeChat };
      seen.push({
        chatOpen: ctx.chatOpen,
        chatMinimized: ctx.chatMinimized,
        chatUnread: ctx.chatUnread,
      });
      return null;
    };
    const { rerender } = render(
      <Wrapper activeTripId="t-1" userToken="tok"><Probe /></Wrapper>
    );
    act(() => {
      fireEvent('unread_count', { tripId: 't-1', count: 5 });
      capturedActions!.openChat();
      capturedActions!.minimizeChat();
    });
    rerender(<Wrapper activeTripId="t-1" userToken={null}><Probe /></Wrapper>);
    const last = seen[seen.length - 1];
    expect(last.chatOpen).toBe(false);
    expect(last.chatMinimized).toBe(false);
    expect(last.chatUnread).toBe(0);
  });

  it('removes the unread listener on unmount', () => {
    socketMock.connected = true;
    const { unmount } = renderHook(() => useChat(), {
      wrapper: ({ children }) => <Wrapper activeTripId="t-1" userToken="tok">{children}</Wrapper>,
    });
    unmount();
    expect(socketMock.off).toHaveBeenCalledWith('unread_count', expect.any(Function));
  });
});
