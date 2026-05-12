/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react-native';

const fetchFollowedTripsApiMock = jest.fn();
const loadFollowCodesMock = jest.fn(() => ({}));
const saveFollowCodesMock = jest.fn();
const loadFollowPayloadsMock = jest.fn(() => ({}));
const saveFollowPayloadsMock = jest.fn();

jest.mock('../tabs/follow', () => ({
  fetchFollowedTripsApi: (backendUrl: string, headers: Record<string, string>) =>
    fetchFollowedTripsApiMock(backendUrl, headers),
  loadFollowCodes: () => loadFollowCodesMock(),
  saveFollowCodes: (codes: Record<string, string>) => saveFollowCodesMock(codes),
  loadFollowPayloads: () => loadFollowPayloadsMock(),
  saveFollowPayloads: (payloads: Record<string, unknown>) => saveFollowPayloadsMock(payloads),
}));

import { useFollowedTrips, pendingFollowCodeStorageKey } from '../hooks/useFollowedTrips';

const BACKEND = 'https://api.example.test';

describe('useFollowedTrips', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    window.localStorage.clear();
    fetchFollowedTripsApiMock.mockReset().mockResolvedValue([]);
    loadFollowCodesMock.mockReset().mockReturnValue({});
    loadFollowPayloadsMock.mockReset().mockReturnValue({});
    saveFollowCodesMock.mockReset();
    saveFollowPayloadsMock.mockReset();
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  it('initializes followCodes/followCodePayloads from the tabs/follow loaders', () => {
    loadFollowCodesMock.mockReturnValue({ 'trip-1': 'CODE1' });
    loadFollowPayloadsMock.mockReturnValue({ 'trip-1': { tripId: 'trip-1' } as any });
    const { result } = renderHook(() => useFollowedTrips({ backendUrl: BACKEND, userToken: 't' }));
    expect(result.current.followCodes).toEqual({ 'trip-1': 'CODE1' });
    expect(result.current.followCodePayloads).toEqual({ 'trip-1': { tripId: 'trip-1' } });
  });

  it('reads a persisted pendingFollowCode from localStorage on mount', () => {
    window.localStorage.setItem(pendingFollowCodeStorageKey, 'ABC123');
    const { result } = renderHook(() => useFollowedTrips({ backendUrl: BACKEND, userToken: 't' }));
    expect(result.current.pendingFollowCode).toBe('ABC123');
  });

  it('persists followCodes changes via saveFollowCodes', async () => {
    const { result } = renderHook(() => useFollowedTrips({ backendUrl: BACKEND, userToken: 't' }));
    await act(async () => {
      result.current.setFollowCodes({ 'trip-42': 'NEW' });
    });
    expect(saveFollowCodesMock).toHaveBeenCalledWith({ 'trip-42': 'NEW' });
  });

  it('persists pendingFollowCode to localStorage on change', async () => {
    const { result } = renderHook(() => useFollowedTrips({ backendUrl: BACKEND, userToken: 't' }));
    await act(async () => {
      result.current.setPendingFollowCode('NEWCODE');
    });
    expect(window.localStorage.getItem(pendingFollowCodeStorageKey)).toBe('NEWCODE');

    await act(async () => {
      result.current.setPendingFollowCode(null);
    });
    expect(window.localStorage.getItem(pendingFollowCodeStorageKey)).toBeNull();
  });

  it('fetchFollowedTrips returns [] when there is no token', async () => {
    const { result } = renderHook(() => useFollowedTrips({ backendUrl: BACKEND, userToken: null }));
    let list: unknown = null;
    await act(async () => {
      list = await result.current.fetchFollowedTrips();
    });
    expect(list).toEqual([]);
    expect(fetchFollowedTripsApiMock).not.toHaveBeenCalled();
  });

  it('fetchFollowedTrips populates state from the API result', async () => {
    fetchFollowedTripsApiMock.mockResolvedValue([{ tripId: 't-1', tripName: 'Rome' }]);
    const { result } = renderHook(() => useFollowedTrips({ backendUrl: BACKEND, userToken: 't' }));
    await act(async () => {
      await result.current.fetchFollowedTrips();
    });
    expect(result.current.followedTrips).toEqual([{ tripId: 't-1', tripName: 'Rome' }]);
  });

  it('fetchFollowedTrips calls onUnauthorized when the API throws UNAUTHORIZED', async () => {
    const err = Object.assign(new Error('nope'), { code: 'UNAUTHORIZED' });
    fetchFollowedTripsApiMock.mockRejectedValue(err);
    const onUnauthorized = jest.fn();
    const { result } = renderHook(() =>
      useFollowedTrips({ backendUrl: BACKEND, userToken: 't', onUnauthorized })
    );
    await act(async () => {
      await result.current.fetchFollowedTrips();
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('handleFollowTripByCode returns error message for empty input', async () => {
    const { result } = renderHook(() => useFollowedTrips({ backendUrl: BACKEND, userToken: 't' }));
    const msg = await result.current.handleFollowTripByCode('   ');
    expect(msg).toBe('Enter a follow code');
  });

  it('handleFollowTripByCode returns error when not signed in', async () => {
    const { result } = renderHook(() =>
      useFollowedTrips({ backendUrl: BACKEND, userToken: null })
    );
    const msg = await result.current.handleFollowTripByCode('CODE1');
    expect(msg).toBe('You need to be logged in');
  });

  it('handleFollowTripByCode POSTs to /api/trips/follow and refreshes the list on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}',
    });
    fetchFollowedTripsApiMock.mockResolvedValue([{ tripId: 'x', tripName: 'X' }]);

    const { result } = renderHook(() => useFollowedTrips({ backendUrl: BACKEND, userToken: 't' }));
    let msg: string | null = 'unset';
    await act(async () => {
      msg = await result.current.handleFollowTripByCode('CODE123');
    });
    expect(msg).toBeNull();
    expect(result.current.followedTrips).toEqual([{ tripId: 'x', tripName: 'X' }]);
    expect(result.current.followInviteCode).toBe('');
    expect(result.current.followError).toBe('');
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe(`${BACKEND}/api/trips/follow`);
    expect((init as any)?.method).toBe('POST');
  });

  it('handleFollowTripByCode calls onUnauthorized on 401', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'bad' }),
      text: async () => '{"error":"bad"}',
    });
    const onUnauthorized = jest.fn();
    const { result } = renderHook(() =>
      useFollowedTrips({ backendUrl: BACKEND, userToken: 't', onUnauthorized })
    );
    const msg = await result.current.handleFollowTripByCode('X');
    expect(msg).toBe('Unauthorized');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('handleFollowTripByCode does not log out on 403 follow errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Not allowed to follow this trip' }),
      text: async () => '{"error":"Not allowed to follow this trip"}',
    });
    const onUnauthorized = jest.fn();
    const { result } = renderHook(() =>
      useFollowedTrips({ backendUrl: BACKEND, userToken: 't', onUnauthorized })
    );
    let msg: string | null = null;
    await act(async () => {
      msg = await result.current.handleFollowTripByCode('X');
    });
    expect(msg).toBe('Not allowed to follow this trip');
    expect(result.current.followError).toBe('Not allowed to follow this trip');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('handleFollowTripByCode surfaces server error message and stores it in followError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'already following' }),
      text: async () => '{"error":"already following"}',
    });
    const { result } = renderHook(() => useFollowedTrips({ backendUrl: BACKEND, userToken: 't' }));
    let msg: string | null = null;
    await act(async () => {
      msg = await result.current.handleFollowTripByCode('CODE');
    });
    expect(msg).toBe('already following');
    expect(result.current.followError).toBe('already following');
  });

  it('clearFollowedTripsData resets all follow-related state', async () => {
    const { result } = renderHook(() => useFollowedTrips({ backendUrl: BACKEND, userToken: 't' }));
    await act(async () => {
      result.current.setFollowedTrips([{ tripId: 't1', tripName: 'X' } as any]);
      result.current.setFollowInviteCode('code');
      result.current.setFollowError('boom');
      result.current.setFollowCodes({ a: 'b' });
      result.current.setFollowCodePayloads({ a: {} as any });
      result.current.setPendingFollowCode('p');
    });
    expect(result.current.followedTrips).toHaveLength(1);

    await act(async () => {
      result.current.clearFollowedTripsData();
    });
    expect(result.current.followedTrips).toEqual([]);
    expect(result.current.followInviteCode).toBe('');
    expect(result.current.followError).toBe('');
    expect(result.current.followCodes).toEqual({});
    expect(result.current.followCodePayloads).toEqual({});
    expect(result.current.pendingFollowCode).toBeNull();
  });
});
