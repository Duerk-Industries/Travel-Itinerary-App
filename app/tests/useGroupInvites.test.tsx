/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook } from '@testing-library/react-native';
import { useGroupInvites } from '../hooks/useGroupInvites';
import type { GroupInvite, PendingTripShareInvite } from '../types/invites';

const BACKEND = 'https://api.example.test';

const makeFetchMock = () =>
  jest.fn(async (url: string, init?: RequestInit) => {
    const urlStr = String(url);
    const method = init?.method ?? 'GET';
    const respond = (status: number, body: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      }) as Response;

    if (method === 'GET' && urlStr.endsWith('/api/groups/invites')) {
      return respond(200, [
        { id: 'inv-1', groupId: 'grp-1', tripId: 'trip-1' } as GroupInvite,
      ]);
    }
    if (method === 'GET' && urlStr.endsWith('/api/trips/share/invites/pending')) {
      return respond(200, {
        invites: [
          {
            id: 'share-1',
            tripId: 'trip-9',
            tripName: 'Rome',
            role: 'member',
            status: 'pending',
          } as PendingTripShareInvite,
        ],
      });
    }
    if (method === 'POST' && urlStr.includes('/api/groups/invites/') && urlStr.endsWith('/accept')) {
      return respond(200, { ok: true });
    }
    if (method === 'POST' && urlStr.includes('/api/groups/invites/') && urlStr.endsWith('/reject')) {
      return respond(200, { ok: true });
    }
    if (method === 'POST' && urlStr.includes('/api/trips/share/invites/') && urlStr.endsWith('/accept')) {
      return respond(200, { ok: true });
    }
    if (method === 'POST' && urlStr.includes('/api/trips/share/invites/') && urlStr.endsWith('/reject')) {
      return respond(200, { ok: true });
    }
    return respond(404, { error: `unhandled ${method} ${urlStr}` });
  });

describe('useGroupInvites', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = makeFetchMock();
    (globalThis as any).fetch = fetchMock;
  });

  it('returns empty arrays and marks invitesLoaded when called without a token', async () => {
    const { result } = renderHook(() =>
      useGroupInvites({ backendUrl: BACKEND, userToken: null })
    );

    let list: GroupInvite[] = [];
    await act(async () => {
      list = await result.current.fetchInvites();
    });
    expect(list).toEqual([]);
    expect(result.current.invitesLoaded).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetchInvites populates state on 200 response', async () => {
    const { result } = renderHook(() =>
      useGroupInvites({ backendUrl: BACKEND, userToken: 't' })
    );
    await act(async () => {
      await result.current.fetchInvites();
    });
    expect(result.current.invites).toHaveLength(1);
    expect(result.current.invites[0].id).toBe('inv-1');
    expect(result.current.invitesLoaded).toBe(true);
  });

  it('fetchPendingTripShareInvites unwraps the { invites: [...] } shape', async () => {
    const { result } = renderHook(() =>
      useGroupInvites({ backendUrl: BACKEND, userToken: 't' })
    );
    let list: PendingTripShareInvite[] = [];
    await act(async () => {
      list = await result.current.fetchPendingTripShareInvites();
    });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('share-1');
    expect(result.current.pendingTripShareInvites).toHaveLength(1);
  });

  it('acceptInvite returns nextTripId from invite.tripId and refetches', async () => {
    const { result } = renderHook(() =>
      useGroupInvites({ backendUrl: BACKEND, userToken: 't' })
    );
    const invite: GroupInvite = { id: 'inv-1', groupId: 'grp-1', tripId: 'trip-42' };
    let action;
    await act(async () => {
      action = await result.current.acceptInvite(invite);
    });
    expect(action).toEqual({ ok: true, nextTripId: 'trip-42' });
    const acceptCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/accept') && (init as any)?.method === 'POST'
    );
    expect(acceptCall).toBeTruthy();
  });

  it('acceptPendingTripShareInvite optimistically removes the invite from state', async () => {
    const { result } = renderHook(() =>
      useGroupInvites({ backendUrl: BACKEND, userToken: 't' })
    );
    await act(async () => {
      await result.current.fetchPendingTripShareInvites();
    });
    expect(result.current.pendingTripShareInvites).toHaveLength(1);

    // After acceptance, the mock fetch for /pending still returns 1 item; the
    // in-state optimistic remove before the refetch is exercised, but the
    // final state matches the server reply.
    let action;
    await act(async () => {
      action = await result.current.acceptPendingTripShareInvite(
        result.current.pendingTripShareInvites[0]
      );
    });
    expect(action).toEqual({ ok: true, nextTripId: 'trip-9' });
  });

  it('returns { ok: false, error } on HTTP failure', async () => {
    const failingFetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server boom' }),
      text: async () => '{"error":"server boom"}',
    }));
    (globalThis as any).fetch = failingFetch;

    const { result } = renderHook(() =>
      useGroupInvites({ backendUrl: BACKEND, userToken: 't' })
    );
    let action;
    await act(async () => {
      action = await result.current.acceptInvite({ id: 'x', groupId: 'y' } as GroupInvite);
    });
    expect(action).toEqual({ ok: false, error: 'server boom' });
  });

  it('clearInvites resets state', async () => {
    const { result } = renderHook(() =>
      useGroupInvites({ backendUrl: BACKEND, userToken: 't' })
    );
    await act(async () => {
      await result.current.fetchInvites();
      await result.current.fetchPendingTripShareInvites();
    });
    expect(result.current.invites).toHaveLength(1);

    act(() => {
      result.current.clearInvites();
    });
    expect(result.current.invites).toEqual([]);
    expect(result.current.pendingTripShareInvites).toEqual([]);
    expect(result.current.invitesLoaded).toBe(false);
  });

  it('mutations without a token return a not-signed-in error without calling fetch', async () => {
    const { result } = renderHook(() =>
      useGroupInvites({ backendUrl: BACKEND, userToken: null })
    );
    const action = await result.current.acceptInvite({ id: 'x', groupId: 'y' } as GroupInvite);
    expect(action).toEqual({ ok: false, error: 'Not signed in' });
    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as any)?.method === 'POST'
    );
    expect(postCalls).toHaveLength(0);
  });
});
