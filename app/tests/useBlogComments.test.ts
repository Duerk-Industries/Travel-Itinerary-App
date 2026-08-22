/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useBlogComments } from '../utils/useBlogComments';

const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer test-token' };

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

describe('useBlogComments', () => {
  it('loadDay fetches the day-level thread and getDayState reflects it', async () => {
    (global as any).fetch = jest.fn(() => jsonResponse({
      comments: [{ id: 'c1', targetKind: 'day', targetId: 'day-1', body: 'Hello', replyCount: 0, replies: [] }],
    }));
    const { result } = renderHook(() => useBlogComments(backendUrl, headers, 'trip-1'));
    await act(async () => { await result.current.loadDay('2026-05-01'); });
    expect(result.current.getDayState('2026-05-01').comments).toHaveLength(1);
    expect(result.current.getDayState('2026-05-01').comments[0].body).toBe('Hello');
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/blog/comments?dayDate=2026-05-01');
  });

  it('getCommentsForTarget filters the shared day cache down to one target', async () => {
    (global as any).fetch = jest.fn(() => jsonResponse({
      comments: [
        { id: 'c1', targetKind: 'day', targetId: 'day-1', body: 'Day comment', replyCount: 0, replies: [] },
        { id: 'c2', targetKind: 'asset', targetId: 'asset-1', body: 'Photo comment', replyCount: 0, replies: [] },
      ],
    }));
    const { result } = renderHook(() => useBlogComments(backendUrl, headers, 'trip-1'));
    await act(async () => { await result.current.loadDay('2026-05-01'); });
    expect(result.current.getCommentsForTarget('2026-05-01', 'asset', 'asset-1')).toHaveLength(1);
    expect(result.current.getCommentsForTarget('2026-05-01', 'asset', 'asset-1')[0].id).toBe('c2');
    expect(result.current.getCommentsForTarget('2026-05-01', 'day', 'day-1')).toHaveLength(1);
  });

  it('postComment sends an Idempotency-Key header and required body, then reloads the day', async () => {
    const calls: any[] = [];
    (global as any).fetch = jest.fn((url: string, init: any) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return jsonResponse({ id: 'new-comment' }, 201);
      return jsonResponse({ comments: [] });
    });
    const { result } = renderHook(() => useBlogComments(backendUrl, headers, 'trip-1'));
    await act(async () => { await result.current.postComment('2026-05-01', 'item', 'item-1', 'Nice!'); });
    const postCall = calls.find((c) => c.init?.method === 'POST');
    expect(postCall.url).toContain('/blog/item/item-1/comments');
    expect(postCall.init.headers['Idempotency-Key']).toBeTruthy();
    expect(JSON.parse(postCall.init.body)).toEqual({ body: 'Nice!', parentCommentId: null });
    // Reloads the day afterward.
    expect(calls.some((c) => !c.init?.method && c.url.includes('dayDate=2026-05-01'))).toBe(true);
  });

  it('postComment with a parentCommentId posts a reply', async () => {
    const calls: any[] = [];
    (global as any).fetch = jest.fn((url: string, init: any) => {
      calls.push({ url, init });
      if (init?.method === 'POST') return jsonResponse({ id: 'reply-1' }, 201);
      return jsonResponse({ comments: [] });
    });
    const { result } = renderHook(() => useBlogComments(backendUrl, headers, 'trip-1'));
    await act(async () => { await result.current.postComment('2026-05-01', 'day', 'day-1', 'A reply', 'parent-1'); });
    const postCall = calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(postCall.init.body)).toEqual({ body: 'A reply', parentCommentId: 'parent-1' });
  });

  it('propagates a server error message on a failed post', async () => {
    (global as any).fetch = jest.fn(() => jsonResponse({ error: 'Follower comments are disabled on this trip' }, 403));
    const { result } = renderHook(() => useBlogComments(backendUrl, headers, 'trip-1'));
    await expect(result.current.postComment('2026-05-01', 'day', 'day-1', 'Nope')).rejects.toThrow('Follower comments are disabled on this trip');
  });

  it('editComment PATCHes and reloads; deleteComment DELETEs and reloads', async () => {
    const calls: any[] = [];
    (global as any).fetch = jest.fn((url: string, init: any) => {
      calls.push({ url, init });
      if (init?.method === 'PATCH') return jsonResponse({ id: 'c1', body: 'Edited' });
      if (init?.method === 'DELETE') return jsonResponse({}, 204);
      return jsonResponse({ comments: [] });
    });
    const { result } = renderHook(() => useBlogComments(backendUrl, headers, 'trip-1'));
    await act(async () => { await result.current.editComment('2026-05-01', 'c1', 'Edited'); });
    await act(async () => { await result.current.deleteComment('2026-05-01', 'c1'); });
    expect(calls.some((c) => c.init?.method === 'PATCH' && c.url.includes('/blog/comments/c1'))).toBe(true);
    expect(calls.some((c) => c.init?.method === 'DELETE' && c.url.includes('/blog/comments/c1'))).toBe(true);
  });

  it('hideComment/unhideComment call the moderation routes and reload the day', async () => {
    const calls: any[] = [];
    (global as any).fetch = jest.fn((url: string, init: any) => {
      calls.push({ url, init });
      if (init?.method === 'POST' && url.includes('/hide')) return jsonResponse({ id: 'c1', hiddenAt: '2026-05-01T00:00:00.000Z' });
      if (init?.method === 'DELETE' && url.includes('/hide')) return jsonResponse({ id: 'c1', hiddenAt: null });
      return jsonResponse({ comments: [] });
    });
    const { result } = renderHook(() => useBlogComments(backendUrl, headers, 'trip-1'));
    await act(async () => { await result.current.hideComment('2026-05-01', 'c1'); });
    await act(async () => { await result.current.unhideComment('2026-05-01', 'c1'); });
    expect(calls.some((c) => c.init?.method === 'POST' && c.url.endsWith('/blog/comments/c1/hide'))).toBe(true);
    expect(calls.some((c) => c.init?.method === 'DELETE' && c.url.endsWith('/blog/comments/c1/hide'))).toBe(true);
  });

  it('reportComment posts the reason and does not reload any day thread', async () => {
    const calls: any[] = [];
    (global as any).fetch = jest.fn((url: string, init: any) => {
      calls.push({ url, init });
      return jsonResponse({}, 204);
    });
    const { result } = renderHook(() => useBlogComments(backendUrl, headers, 'trip-1'));
    await act(async () => { await result.current.reportComment('c1', 'spam'); });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body)).toEqual({ reason: 'spam', detail: null });
  });

  it('loadMoreReplies patches only the affected comment\'s replies, not the whole day', async () => {
    (global as any).fetch = jest.fn((url: string) => {
      if (url.includes('/comments?dayDate=')) {
        return jsonResponse({ comments: [{ id: 'c1', targetKind: 'day', targetId: 'day-1', replyCount: 5, replies: [{ id: 'r1' }] }] });
      }
      return jsonResponse({ replies: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }, { id: 'r5' }] });
    });
    const { result } = renderHook(() => useBlogComments(backendUrl, headers, 'trip-1'));
    await act(async () => { await result.current.loadDay('2026-05-01'); });
    await act(async () => { await result.current.loadMoreReplies('2026-05-01', 'c1'); });
    expect(result.current.getDayState('2026-05-01').comments[0].replies).toHaveLength(5);
  });

  it('resets its cache when the trip changes', async () => {
    (global as any).fetch = jest.fn(() => jsonResponse({ comments: [{ id: 'c1', targetKind: 'day', targetId: 'day-1', replies: [] }] }));
    const { result, rerender } = renderHook(({ tripId }) => useBlogComments(backendUrl, headers, tripId), { initialProps: { tripId: 'trip-1' } });
    await act(async () => { await result.current.loadDay('2026-05-01'); });
    expect(result.current.getDayState('2026-05-01').comments).toHaveLength(1);
    rerender({ tripId: 'trip-2' });
    expect(result.current.getDayState('2026-05-01').comments).toHaveLength(0);
  });
});
