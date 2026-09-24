/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import * as Network from 'expo-network';

type Handler = (...args: unknown[]) => void;
const socketListeners = new Map<string, Set<Handler>>();
const managerListeners = new Map<string, Set<Handler>>();

const socketMock = {
  connected: false,
  on: jest.fn((event: string, handler: Handler) => {
    if (!socketListeners.has(event)) socketListeners.set(event, new Set());
    socketListeners.get(event)!.add(handler);
  }),
  off: jest.fn((event: string, handler: Handler) => {
    socketListeners.get(event)?.delete(handler);
  }),
  io: {
    on: jest.fn((event: string, handler: Handler) => {
      if (!managerListeners.has(event)) managerListeners.set(event, new Set());
      managerListeners.get(event)!.add(handler);
    }),
    off: jest.fn((event: string, handler: Handler) => {
      managerListeners.get(event)?.delete(handler);
    }),
  },
};

const fireSocketEvent = (event: string): void => {
  for (const h of socketListeners.get(event) ?? []) h();
};

const fireManagerEvent = (event: string): void => {
  for (const h of managerListeners.get(event) ?? []) h();
};

jest.mock('../utils/socket', () => ({
  getSocket: () => socketMock,
}));

import { useConnectionState } from '../hooks/useConnectionState';

describe('useConnectionState', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    socketListeners.clear();
    managerListeners.clear();
    socketMock.connected = false;
    (Platform as { OS: string }).OS = 'web';
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({ isConnected: true, isInternetReachable: true });
  });

  afterEach(() => {
    (Platform as { OS: string }).OS = originalPlatform;
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

  it('does not report reconnecting forever after a socket disconnects without retrying', () => {
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
    expect(result.current.status).toBe('online');
    expect(result.current.isDegraded).toBe(false);
  });

  it('reports reconnecting only while the Socket.IO manager is retrying', () => {
    const { result } = renderHook(() => useConnectionState());
    act(() => {
      socketMock.connected = true;
      fireSocketEvent('connect');
    });
    act(() => {
      socketMock.connected = false;
      fireSocketEvent('disconnect');
      fireManagerEvent('reconnect_attempt');
    });
    expect(result.current.status).toBe('reconnecting');

    act(() => {
      socketMock.connected = true;
      fireManagerEvent('reconnect');
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
      fireManagerEvent('reconnect_attempt');
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.status).toBe('offline');
  });

  it('uses expo-network on native instead of browser-like globals', async () => {
    (Platform as { OS: string }).OS = 'ios';
    (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({ isConnected: false, isInternetReachable: false });

    const { result } = renderHook(() => useConnectionState());

    await act(async () => {
      await Promise.resolve();
    });
    expect(Network.getNetworkStateAsync).toHaveBeenCalled();
    expect(result.current.status).toBe('offline');
  });
});
