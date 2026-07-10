/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook } from '@testing-library/react-native';

type Handler = (...args: unknown[]) => void;
const socketListeners = new Map<string, Set<Handler>>();

const socketMock = {
  connected: false,
  on: jest.fn((event: string, handler: Handler) => {
    if (!socketListeners.has(event)) socketListeners.set(event, new Set());
    socketListeners.get(event)!.add(handler);
  }),
  off: jest.fn((event: string, handler: Handler) => {
    socketListeners.get(event)?.delete(handler);
  }),
};

const fireSocketEvent = (event: string): void => {
  for (const h of socketListeners.get(event) ?? []) h();
};

jest.mock('../utils/socket', () => ({
  getSocket: () => socketMock,
}));

import { useConnectionState } from '../hooks/useConnectionState';

describe('useConnectionState', () => {
  beforeEach(() => {
    socketListeners.clear();
    socketMock.connected = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('reports online when browser is online and socket is idle', () => {
    const { result } = renderHook(() => useConnectionState());
    expect(result.current.status).toBe('online');
    expect(result.current.isDegraded).toBe(false);
  });

  it('reports offline when browser fires an offline event', () => {
    const { result } = renderHook(() => useConnectionState());
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.status).toBe('offline');
    expect(result.current.isDegraded).toBe(true);
  });

  it('reports reconnecting after a socket has connected then dropped', () => {
    const { result } = renderHook(() => useConnectionState());

    act(() => {
      socketMock.connected = true;
      fireSocketEvent('connect');
    });
    expect(result.current.status).toBe('online');

    act(() => {
      socketMock.connected = false;
      fireSocketEvent('disconnect');
    });
    expect(result.current.status).toBe('reconnecting');
    expect(result.current.isDegraded).toBe(true);
  });

  it('clears reconnecting after a reconnect', () => {
    const { result } = renderHook(() => useConnectionState());
    act(() => {
      socketMock.connected = true;
      fireSocketEvent('connect');
    });
    act(() => {
      socketMock.connected = false;
      fireSocketEvent('disconnect');
      fireSocketEvent('reconnect_attempt');
    });
    expect(result.current.status).toBe('reconnecting');

    act(() => {
      socketMock.connected = true;
      fireSocketEvent('connect');
    });
    expect(result.current.status).toBe('online');
  });

  it('offline takes precedence over reconnecting', () => {
    const { result } = renderHook(() => useConnectionState());
    act(() => {
      socketMock.connected = true;
      fireSocketEvent('connect');
    });
    act(() => {
      socketMock.connected = false;
      fireSocketEvent('disconnect');
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.status).toBe('offline');
  });
});
