import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAutomaticMapLocations } from '../hooks/useAutomaticMapLocations';
import { usePlanningMapPoints } from '../hooks/usePlanningMapPoints';
import type { PlanningMapPoint } from '../../server/src/types';

jest.mock('../hooks/usePlanningMapPoints', () => ({ usePlanningMapPoints: jest.fn() }));
const planningPoints = jest.mocked(usePlanningMapPoints);
const missing: PlanningMapPoint = { id: 'hotel', kind: 'lodging', title: 'Hotel', address: '2 Asakusa, Tokyo, Japan' };
const cached: PlanningMapPoint = { id: 'museum', kind: 'activity', title: 'Museum', lat: 35.7, lng: 139.8, coordinateSource: 'manual' };
const params = { backendUrl: 'https://backend.example', tripId: 'trip', dayDate: '2027-03-02', requestHeaders: { Authorization: 'Bearer test' }, enabled: true, canLocate: true, points: [] };

describe('automatic map coordinate lookup', () => {
  let send: jest.SpyInstance;
  beforeEach(() => {
    planningPoints.mockReturnValue([missing, cached]);
    send = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'located', lat: 35.71, lng: 139.79, attribution: 'Provider credit', creditLinks: [{ label: 'Provider', url: 'https://provider.example' }] }) } as Response);
  });
  afterEach(() => jest.restoreAllMocks());

  it('waits for Show map, looks up only missing stops, then uses cached coordinates on reopen', async () => {
    const { result, rerender } = renderHook(({ open }: { open: boolean }) => useAutomaticMapLocations({ ...params, open }), { initialProps: { open: false } });
    expect(send).not.toHaveBeenCalled();
    rerender({ open: true });
    await waitFor(() => expect(result.current.points[0].lat).toBe(35.71));
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ kind: 'lodging', itemId: 'hotel' });
    expect(result.current.points[0]).toMatchObject({ coordinateSource: 'geocoder', coordinateAttribution: 'Provider credit', coordinateCreditLinks: [{ label: 'Provider', url: 'https://provider.example' }] });
    expect(result.current.points[1]).toEqual(cached);
    rerender({ open: false });
    rerender({ open: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.points[0].lng).toBe(139.79);
  });

  it('does not geocode already persisted coordinates after remount', () => {
    planningPoints.mockReturnValue([cached]);
    renderHook(() => useAutomaticMapLocations({ ...params, open: true }));
    expect(send).not.toHaveBeenCalled();
  });

  it('starts when the server stop list arrives after Show map was pressed', async () => {
    planningPoints.mockReturnValue(null);
    const { result, rerender } = renderHook(() => useAutomaticMapLocations({ ...params, open: true }));
    expect(send).not.toHaveBeenCalled();
    planningPoints.mockReturnValue([missing]);
    rerender({});
    await waitFor(() => expect(result.current.points[0].lat).toBe(35.71));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('also caches single-item dialog coordinates when there is no day-date query', async () => {
    planningPoints.mockReturnValue(null);
    const { result } = renderHook(() => useAutomaticMapLocations({ ...params, dayDate: undefined, points: [missing], open: true }));
    await waitFor(() => expect(result.current.points[0].lat).toBe(35.71));
  });

  it('does not fetch without lookup permission', () => {
    renderHook(() => useAutomaticMapLocations({ ...params, canLocate: false, open: true }));
    expect(send).not.toHaveBeenCalled();
  });

  it('reads cached server coordinates without needing a day-date query', async () => {
    planningPoints.mockReturnValue(null);
    send.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'already_located', lat: 35.72, lng: 139.78, coordinateSource: 'manual' }) } as Response);
    const { result } = renderHook(() => useAutomaticMapLocations({ ...params, dayDate: undefined, points: [missing], open: true }));
    await waitFor(() => expect(result.current.points[0].lat).toBe(35.72));
    expect(result.current.points[0].coordinateSource).toBe('manual');
  });

  it('stops on quota without request loops, and can retry on a later Show map', async () => {
    send.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) } as Response);
    const { result, rerender } = renderHook(({ open }: { open: boolean }) => useAutomaticMapLocations({ ...params, open }), { initialProps: { open: true } });
    await waitFor(() => expect(result.current.notice).toContain('limit'));
    await act(async () => { rerender({ open: true }); });
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => { rerender({ open: false }); });
    await act(async () => { rerender({ open: true }); });
    await waitFor(() => expect(result.current.locating).toBe(false));
    expect(send).toHaveBeenCalledTimes(2);
  });
});
