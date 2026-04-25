/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react-native';

const fetchFamilyRelationshipsMock = jest.fn();
const fetchFellowTravelersMock = jest.fn();

jest.mock('../tabs/account', () => ({
  fetchFamilyRelationships: (...args: unknown[]) =>
    (fetchFamilyRelationshipsMock as any)(...args),
  fetchFellowTravelers: (...args: unknown[]) =>
    (fetchFellowTravelersMock as any)(...args),
}));

import { useAccountSidecars } from '../hooks/useAccountSidecars';

const BACKEND = 'https://api.example.test';
const PARAMS = { backendUrl: BACKEND, userToken: 'tok' } as const;

describe('useAccountSidecars', () => {
  beforeEach(() => {
    fetchFamilyRelationshipsMock.mockReset().mockResolvedValue(undefined);
    fetchFellowTravelersMock.mockReset().mockResolvedValue(undefined);
  });

  it('starts with empty lists', () => {
    const { result } = renderHook(() => useAccountSidecars(PARAMS));
    expect(result.current.familyRelationships).toEqual([]);
    expect(result.current.fellowTravelers).toEqual([]);
  });

  it('loadFamilyRelationships forwards backendUrl + userToken + setFamilyRelationships', async () => {
    const { result } = renderHook(() => useAccountSidecars(PARAMS));
    await act(async () => {
      await result.current.loadFamilyRelationships();
    });
    expect(fetchFamilyRelationshipsMock).toHaveBeenCalledTimes(1);
    const call = fetchFamilyRelationshipsMock.mock.calls[0][0] as {
      backendUrl: string;
      token: string | null;
      setFamilyRelationships: unknown;
    };
    expect(call.backendUrl).toBe(BACKEND);
    expect(call.token).toBe('tok');
    expect(typeof call.setFamilyRelationships).toBe('function');
  });

  it('loadFamilyRelationships accepts a token override', async () => {
    const { result } = renderHook(() => useAccountSidecars(PARAMS));
    await act(async () => {
      await result.current.loadFamilyRelationships('override-token');
    });
    expect(fetchFamilyRelationshipsMock.mock.calls[0][0].token).toBe('override-token');
  });

  it('loadFellowTravelers forwards params and supports token override', async () => {
    const { result } = renderHook(() => useAccountSidecars(PARAMS));
    await act(async () => {
      await result.current.loadFellowTravelers();
    });
    expect(fetchFellowTravelersMock.mock.calls[0][0].token).toBe('tok');

    await act(async () => {
      await result.current.loadFellowTravelers('x');
    });
    expect(fetchFellowTravelersMock.mock.calls[1][0].token).toBe('x');
  });

  it('setters update the lists directly', () => {
    const { result } = renderHook(() => useAccountSidecars(PARAMS));
    act(() => {
      result.current.setFamilyRelationships([{ id: 'r-1', relationship: 'sibling' }]);
      result.current.setFellowTravelers([{ id: 'ft-1', name: 'Tom' } as any]);
    });
    expect(result.current.familyRelationships).toHaveLength(1);
    expect(result.current.fellowTravelers).toHaveLength(1);
  });

  it('clearAccountSidecars resets both lists', () => {
    const { result } = renderHook(() => useAccountSidecars(PARAMS));
    act(() => {
      result.current.setFamilyRelationships([{ id: 'x' }]);
      result.current.setFellowTravelers([{ id: 'y' } as any]);
    });
    act(() => {
      result.current.clearAccountSidecars();
    });
    expect(result.current.familyRelationships).toEqual([]);
    expect(result.current.fellowTravelers).toEqual([]);
  });

  it('null userToken propagates through to the helpers', async () => {
    const { result } = renderHook(() =>
      useAccountSidecars({ backendUrl: BACKEND, userToken: null })
    );
    await act(async () => {
      await result.current.loadFamilyRelationships();
    });
    expect(fetchFamilyRelationshipsMock.mock.calls[0][0].token).toBeNull();
  });
});
