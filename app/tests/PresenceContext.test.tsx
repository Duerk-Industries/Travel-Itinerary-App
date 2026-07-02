/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';

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

import { PresenceProvider, usePresenceUsers } from '../contexts/PresenceContext';

type WrapperProps = { activeTripId: string | null; userToken: string | null; children: React.ReactNode };

const Wrapper: React.FC<WrapperProps> = ({ activeTripId, userToken, children }) => (
  <PresenceProvider activeTripId={activeTripId} userToken={userToken}>
    {children}
  </PresenceProvider>
);

describe('PresenceContext', () => {
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

  it('starts with an empty presence list', () => {
    const { result } = renderHook(() => usePresenceUsers(), {
      wrapper: ({ children }) => <Wrapper activeTripId={null} userToken={null}>{children}</Wrapper>,
    });
    expect(result.current).toEqual([]);
  });

  it('does not subscribe when userToken or activeTripId are missing', () => {
    renderHook(() => usePresenceUsers(), {
      wrapper: ({ children }) => <Wrapper activeTripId={null} userToken="t">{children}</Wrapper>,
    });
    renderHook(() => usePresenceUsers(), {
      wrapper: ({ children }) => <Wrapper activeTripId="x" userToken={null}>{children}</Wrapper>,
    });
    expect(socketMock.on).not.toHaveBeenCalled();
    expect(socketMock.emit).not.toHaveBeenCalled();
  });

  it('joins the trip room immediately when the socket is already connected', () => {
    socketMock.connected = true;
    renderHook(() => usePresenceUsers(), {
      wrapper: ({ children }) => <Wrapper activeTripId="t-1" userToken="tok">{children}</Wrapper>,
    });
    expect(socketMock.emit).toHaveBeenCalledWith('join_trip', 't-1');
    expect(socketMock.once).not.toHaveBeenCalled();
  });

  it('waits for connect then joins when the socket is offline at mount', () => {
    socketMock.connected = false;
    renderHook(() => usePresenceUsers(), {
      wrapper: ({ children }) => <Wrapper activeTripId="t-2" userToken="tok">{children}</Wrapper>,
    });
    expect(socketMock.emit).not.toHaveBeenCalled();
    expect(socketMock.once).toHaveBeenCalledWith('connect', expect.any(Function));
    act(() => fireOnce('connect'));
    expect(socketMock.emit).toHaveBeenCalledWith('join_trip', 't-2');
  });

  it('reflects presence list updates from the socket', () => {
    socketMock.connected = true;
    const { result } = renderHook(() => usePresenceUsers(), {
      wrapper: ({ children }) => <Wrapper activeTripId="t-1" userToken="tok">{children}</Wrapper>,
    });
    act(() => {
      fireEvent('presence_update', [{ userId: 'u-1', name: 'Ada' }]);
    });
    expect(result.current).toEqual([{ userId: 'u-1', name: 'Ada' }]);
  });

  it('resets presence when userToken becomes null', () => {
    socketMock.connected = true;
    const seen: unknown[] = [];
    const Probe: React.FC = () => {
      const users = usePresenceUsers();
      seen.push(users);
      return null;
    };
    const { rerender } = render(
      <Wrapper activeTripId="t-1" userToken="tok"><Probe /></Wrapper>
    );
    act(() => {
      fireEvent('presence_update', [{ userId: 'u-1', name: 'Ada' }]);
    });
    expect(seen[seen.length - 1]).toEqual([{ userId: 'u-1', name: 'Ada' }]);
    rerender(<Wrapper activeTripId="t-1" userToken={null}><Probe /></Wrapper>);
    expect(seen[seen.length - 1]).toEqual([]);
  });

  it('removes the presence listener on unmount', () => {
    socketMock.connected = true;
    const { unmount } = renderHook(() => usePresenceUsers(), {
      wrapper: ({ children }) => <Wrapper activeTripId="t-1" userToken="tok">{children}</Wrapper>,
    });
    unmount();
    expect(socketMock.off).toHaveBeenCalledWith('presence_update', expect.any(Function));
  });
});
