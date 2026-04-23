/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react-native';
import { useSelectedFollowedTripDetails } from '../hooks/useSelectedFollowedTripDetails';
import type { FollowedTrip } from '../tabs/follow';

const BACKEND = 'https://api.example.test';

const flushMicrotasks = async () => {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
  }
};

const mockOkResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

const mockFailResponse = (status: number) =>
  ({
    ok: false,
    status,
    json: async () => ({ error: 'nope' }),
    text: async () => '{"error":"nope"}',
  }) as Response;

describe('useSelectedFollowedTripDetails', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  it('stays null and does not fetch when no trip is selected', async () => {
    const { result } = renderHook(() =>
      useSelectedFollowedTripDetails({
        backendUrl: BACKEND,
        selectedFollowedTrip: null,
        selectedFollowedTripId: null,
        userToken: 't',
      })
    );
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.selectedFollowedTripDetails).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays null and does not fetch when there is no user token', async () => {
    const { result } = renderHook(() =>
      useSelectedFollowedTripDetails({
        backendUrl: BACKEND,
        selectedFollowedTrip: { tripId: 't-1', tripName: 'X' } as FollowedTrip,
        selectedFollowedTripId: 't-1',
        userToken: null,
      })
    );
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.selectedFollowedTripDetails).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the full Trip from /api/trips/:id', async () => {
    fetchMock.mockResolvedValue(
      mockOkResponse({
        id: 't-1',
        groupId: 'g-1',
        groupName: 'Friends',
        name: 'Canonical Name',
        destination: 'Rome',
        locationIds: ['loc-1'],
        startDate: '2026-05-01',
        endDate: '2026-05-07',
        durationDays: 6,
        currency: 'EUR',
        createdAt: '2026-04-01',
      })
    );
    const { result } = renderHook(() =>
      useSelectedFollowedTripDetails({
        backendUrl: BACKEND,
        selectedFollowedTrip: { tripId: 't-1', tripName: 'Fallback' } as FollowedTrip,
        selectedFollowedTripId: 't-1',
        userToken: 'tok',
      })
    );
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.selectedFollowedTripDetails).toMatchObject({
      id: 't-1',
      groupId: 'g-1',
      groupName: 'Friends',
      name: 'Canonical Name',
      destination: 'Rome',
      locationIds: ['loc-1'],
      startDate: '2026-05-01',
      endDate: '2026-05-07',
      durationDays: 6,
      currency: 'EUR',
      createdAt: '2026-04-01',
    });
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe(`${BACKEND}/api/trips/t-1`);
    const headers = (init as any)?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('falls back to FollowedTrip fields when the server omits name/destination', async () => {
    fetchMock.mockResolvedValue(
      mockOkResponse({
        id: 't-2',
        groupId: 'g-2',
      })
    );
    const { result } = renderHook(() =>
      useSelectedFollowedTripDetails({
        backendUrl: BACKEND,
        selectedFollowedTrip: {
          tripId: 't-2',
          tripName: 'Fallback Name',
          destination: 'Fallback Dest',
        } as FollowedTrip,
        selectedFollowedTripId: 't-2',
        userToken: 'tok',
      })
    );
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.selectedFollowedTripDetails?.name).toBe('Fallback Name');
    expect(result.current.selectedFollowedTripDetails?.destination).toBe('Fallback Dest');
  });

  it('sets details to null when the response is a 404', async () => {
    fetchMock.mockResolvedValue(mockFailResponse(404));
    const { result } = renderHook(() =>
      useSelectedFollowedTripDetails({
        backendUrl: BACKEND,
        selectedFollowedTrip: { tripId: 'x', tripName: 'X' } as FollowedTrip,
        selectedFollowedTripId: 'x',
        userToken: 't',
      })
    );
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.selectedFollowedTripDetails).toBeNull();
  });

  it('sets details to null when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() =>
      useSelectedFollowedTripDetails({
        backendUrl: BACKEND,
        selectedFollowedTrip: { tripId: 'x', tripName: 'X' } as FollowedTrip,
        selectedFollowedTripId: 'x',
        userToken: 't',
      })
    );
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.selectedFollowedTripDetails).toBeNull();
  });

  it('clears details when selectedFollowedTripId goes back to null', async () => {
    fetchMock.mockResolvedValue(
      mockOkResponse({ id: 't-1', groupId: 'g', name: 'N', destination: 'D' })
    );
    type Props = {
      selectedFollowedTrip: FollowedTrip | null;
      selectedFollowedTripId: string | null;
    };
    const initialProps: Props = {
      selectedFollowedTrip: { tripId: 't-1', tripName: 'N' } as FollowedTrip,
      selectedFollowedTripId: 't-1',
    };
    const { result, rerender } = renderHook(
      (props: Props) =>
        useSelectedFollowedTripDetails({
          backendUrl: BACKEND,
          userToken: 't',
          selectedFollowedTrip: props.selectedFollowedTrip,
          selectedFollowedTripId: props.selectedFollowedTripId,
        }),
      { initialProps }
    );
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.selectedFollowedTripDetails?.id).toBe('t-1');

    rerender({ selectedFollowedTrip: null, selectedFollowedTripId: null });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.selectedFollowedTripDetails).toBeNull();
  });
});
