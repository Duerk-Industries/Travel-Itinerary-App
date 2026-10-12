/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { useBlogMediaUrlRefresh } from '../hooks/useBlogMediaUrlRefresh';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mockAppStateChanged: ((state: string) => void) | null = null;
jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  AppState: { addEventListener: jest.fn((_event: string, callback: (state: string) => void) => {
    mockAppStateChanged = callback;
    return { remove: jest.fn() };
  }) },
}));

const blog = { days: [{ items: [{ primaryUrl: 'https://storage.example.test/primary.jpg' }] }] };
const Probe = ({ data, refresh }: { data: typeof blog | null; refresh: () => void }) => {
  useBlogMediaUrlRefresh(data, refresh);
  return null;
};

describe('useBlogMediaUrlRefresh', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-10T12:00:00Z'));
    require('react-native').Platform.OS = 'web';
    mockAppStateChanged = null;
  });
  afterEach(() => { jest.useRealTimers(); });

  it('refreshes a mounted web blog before the one-hour media URL expires', async () => {
    const refresh = jest.fn();
    let tree: any;
    await act(async () => { tree = renderer.create(<Probe data={blog} refresh={refresh} />); });
    await act(async () => { jest.advanceTimersByTime(44 * 60_000); });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { tree!.unmount(); });
  });

  it.each(['ios', 'android'])('refreshes on %s resume when background timers were suspended', async (platform) => {
    require('react-native').Platform.OS = platform;
    const refresh = jest.fn();
    let tree: any;
    await act(async () => { tree = renderer.create(<Probe data={blog} refresh={refresh} />); });
    jest.setSystemTime(new Date('2026-10-10T12:46:00Z'));
    await act(async () => { mockAppStateChanged?.('active'); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { tree!.unmount(); });
  });

  it('does not poll a blog without media URLs', async () => {
    const refresh = jest.fn();
    let tree: any;
    await act(async () => { tree = renderer.create(<Probe data={{ days: [{ items: [] }] }} refresh={refresh} />); });
    await act(async () => { jest.advanceTimersByTime(60 * 60_000); });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { tree!.unmount(); });
  });
});
