import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ScreenCacheProvider } from '../cache/ScreenCacheProvider';
import { useScreenQuery, ScreenRequestError } from '../cache/useScreenQuery';
import * as storage from '../cache/screenCacheStorage';

jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('../cache/screenCacheStorage', () => {
  const values = new Map<string, string>();
  return { read: jest.fn(async (key: string) => values.get(key) ?? null),
    write: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    remove: jest.fn(async (key: string) => { values.delete(key); }),
  };
});
const valid = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => <ScreenCacheProvider userId="alex" environment="test" token="session">{children}</ScreenCacheProvider>;
let id = 0;
const key = () => ['packing', `test-${++id}`];

test('renders saved data before a network refresh completes and keeps it on a transient error', async () => {
  const queryKey = key();
  const first = renderHook(() => useScreenQuery({ queryKey, policy: 'trip', validate: valid, fetcher: async () => ['passport'] }), { wrapper });
  await waitFor(() => expect(first.result.current.data).toEqual(['passport']));
  await waitFor(() => expect(storage.write).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 0));
  first.unmount();
  let reject!: (error: Error) => void;
  const second = renderHook(() => useScreenQuery({ queryKey, policy: 'trip', validate: valid,
    fetcher: () => new Promise<string[]>((_resolve, fail) => { reject = fail; }),
  }), { wrapper });
  await waitFor(() => expect(second.result.current.data).toEqual(['passport']));
  await waitFor(() => expect(second.result.current.isFetching).toBe(true));
  await act(async () => { reject(new Error('Network unavailable')); });
  await waitFor(() => expect(second.result.current.error?.message).toBe('Network unavailable'));
  expect(second.result.current.data).toEqual(['passport']);
  second.unmount();
});

test('removes denied cached data from both memory and the persisted snapshot', async () => {
  const queryKey = key();
  const fetcher = jest.fn<Promise<string[]>, [AbortSignal]>().mockResolvedValueOnce(['private']).mockRejectedValueOnce(new ScreenRequestError('Forbidden', 403));
  const view = renderHook(() => useScreenQuery({ queryKey, policy: 'trip', validate: valid, fetcher }), { wrapper });
  await waitFor(() => expect(view.result.current.data).toEqual(['private']));
  await act(async () => { await view.result.current.refresh(); });
  await waitFor(() => expect(view.result.current.data).toBeUndefined());
  expect(view.result.current.error?.message).toBe('Forbidden');
  await new Promise(resolve => setTimeout(resolve, 0));
  const last = (storage.write as jest.Mock).mock.calls.slice(-1)[0]?.[1];
  expect(last).not.toContain('private');
  expect(storage.remove).toHaveBeenCalled();
  view.unmount();
});

test('cancels a stale read before an online write and publishes only confirmed results', async () => {
  const queryKey = key();
  let finish!: (value: string[]) => void;
  const view = renderHook(() => useScreenQuery({ queryKey, policy: 'trip', validate: valid,
    fetcher: () => new Promise<string[]>(resolve => { finish = resolve; }),
  }), { wrapper });
  await waitFor(() => expect(view.result.current.isFetching).toBe(true));
  await act(async () => {
    await view.result.current.runWrite(async () => { view.result.current.publish(['saved']); });
    finish(['stale']);
  });
  expect(view.result.current.data).toEqual(['saved']);
  view.unmount();
});
