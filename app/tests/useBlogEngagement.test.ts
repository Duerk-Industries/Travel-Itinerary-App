/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook } from '@testing-library/react-native';
import { useBlogEngagement } from '../utils/useBlogEngagement';

const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer test-token' };

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

describe('useBlogEngagement', () => {
  it('seedFromBlog populates day/item/asset engagement from a blog document', () => {
    const { result } = renderHook(() => useBlogEngagement(backendUrl, headers, 'trip-1'));
    act(() => {
      result.current.seedFromBlog({
        days: [{
          id: 'day-1',
          engagement: { reactionCounts: { heart: 2 }, reactionTotal: 2, commentCount: 0, userReaction: 'heart' },
          items: [
            { id: 'item-1', kindKey: 'core.text', engagement: { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null } },
            { id: 'gallery-1', kindKey: 'core.gallery', assets: [{ assetId: 'asset-1', engagement: { reactionCounts: { laugh: 1 }, reactionTotal: 1, commentCount: 0, userReaction: null } }] },
          ],
        }],
      });
    });
    expect(result.current.getSummary('day', 'day-1').reactionTotal).toBe(2);
    expect(result.current.getSummary('item', 'item-1').reactionTotal).toBe(0);
    expect(result.current.getSummary('asset', 'asset-1').reactionCounts).toEqual({ laugh: 1 });
  });

  it('getSummary returns a zeroed summary for an unknown target, never undefined', () => {
    const { result } = renderHook(() => useBlogEngagement(backendUrl, headers, 'trip-1'));
    expect(result.current.getSummary('item', 'never-seeded')).toEqual({ reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null });
  });

  it('react() applies an optimistic update immediately, then reconciles with the server response', async () => {
    let resolveFetch: (value: any) => void = () => {};
    (global as any).fetch = jest.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const { result } = renderHook(() => useBlogEngagement(backendUrl, headers, 'trip-1'));
    let reactPromise: Promise<void>;
    act(() => {
      reactPromise = result.current.react('item', 'item-1', 'heart');
    });
    // Optimistic: reflected before the network call resolves.
    expect(result.current.getSummary('item', 'item-1').userReaction).toBe('heart');
    expect(result.current.getSummary('item', 'item-1').reactionTotal).toBe(1);

    await act(async () => {
      resolveFetch(await jsonResponse({ reactionCounts: { heart: 5 }, reactionTotal: 5, commentCount: 0, userReaction: 'heart' }));
      await reactPromise!;
    });
    // Reconciled to the server's authoritative count, not the optimistic +1.
    expect(result.current.getSummary('item', 'item-1').reactionTotal).toBe(5);
  });

  it('react() rolls back to the pre-mutation value when the server rejects the write', async () => {
    (global as any).fetch = jest.fn(async () => jsonResponse({ error: 'not found' }, 404));
    const { result } = renderHook(() => useBlogEngagement(backendUrl, headers, 'trip-1'));
    act(() => {
      result.current.seedFromBlog({ days: [{ id: 'day-1', items: [{ id: 'item-1', kindKey: 'core.text', engagement: { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null } }] }] });
    });

    await act(async () => {
      await expect(result.current.react('item', 'item-1', 'heart')).rejects.toThrow('not found');
    });
    // Back to zero — the optimistic +1 was rolled back.
    expect(result.current.getSummary('item', 'item-1').reactionTotal).toBe(0);
    expect(result.current.getSummary('item', 'item-1').userReaction).toBeNull();
  });

  it('clear() removes the caller\'s reaction optimistically and on the server', async () => {
    (global as any).fetch = jest.fn(async () => jsonResponse({ reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null }));
    const { result } = renderHook(() => useBlogEngagement(backendUrl, headers, 'trip-1'));
    act(() => {
      result.current.seedFromBlog({ days: [{ id: 'day-1', items: [{ id: 'item-1', kindKey: 'core.text', engagement: { reactionCounts: { heart: 1 }, reactionTotal: 1, commentCount: 0, userReaction: 'heart' } }] }] });
    });
    await act(async () => { await result.current.clear('item', 'item-1'); });
    expect(result.current.getSummary('item', 'item-1').userReaction).toBeNull();
    expect(result.current.getSummary('item', 'item-1').reactionTotal).toBe(0);
  });

  it('toggle() calls react() for a different emoji and clear() for a repeat of the current one', async () => {
    const calls: string[] = [];
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      calls.push(init.method);
      return jsonResponse(init.method === 'DELETE'
        ? { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null }
        : { reactionCounts: { heart: 1 }, reactionTotal: 1, commentCount: 0, userReaction: 'heart' });
    });
    const { result } = renderHook(() => useBlogEngagement(backendUrl, headers, 'trip-1'));

    await act(async () => { await result.current.toggle('item', 'item-1', 'heart'); });
    expect(calls).toEqual(['PUT']);
    expect(result.current.getSummary('item', 'item-1').userReaction).toBe('heart');

    await act(async () => { await result.current.toggle('item', 'item-1', 'heart'); });
    expect(calls).toEqual(['PUT', 'DELETE']);
  });

  it('clears all state on trip switch', () => {
    const { result, rerender } = renderHook(({ tripId }) => useBlogEngagement(backendUrl, headers, tripId), { initialProps: { tripId: 'trip-1' } });
    act(() => {
      result.current.seedFromBlog({ days: [{ id: 'day-1', engagement: { reactionCounts: { heart: 1 }, reactionTotal: 1, commentCount: 0, userReaction: 'heart' } }] });
    });
    expect(result.current.getSummary('day', 'day-1').reactionTotal).toBe(1);
    rerender({ tripId: 'trip-2' });
    expect(result.current.getSummary('day', 'day-1').reactionTotal).toBe(0);
  });
});
