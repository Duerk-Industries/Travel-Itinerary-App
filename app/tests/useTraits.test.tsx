/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook } from '@testing-library/react-native';
import { useTraits } from '../hooks/useTraits';
import type { Trait } from '../tabs/traits';

const BACKEND = 'https://api.example.test';
const DEFAULT_PARAMS = { backendUrl: BACKEND, userToken: 't' } as const;

const mockResponse = (ok: boolean, status: number, body: unknown) =>
  ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

describe('useTraits', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  it('starts empty with default gender=prefer-not', () => {
    const { result } = renderHook(() => useTraits(DEFAULT_PARAMS));
    expect(result.current.traits).toEqual([]);
    expect(result.current.newTraitName).toBe('');
    expect(result.current.selectedTraitNames.size).toBe(0);
    expect(result.current.traitAge).toBe('');
    expect(result.current.traitGender).toBe('prefer-not');
    expect(result.current.showGenderDropdown).toBe(false);
  });

  it('fetchTraits no-ops without a user token', async () => {
    const { result } = renderHook(() =>
      useTraits({ backendUrl: BACKEND, userToken: null })
    );
    await act(async () => {
      await result.current.fetchTraits();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetchTraits populates traits and seeds selectedTraitNames from the API result', async () => {
    const list: Trait[] = [
      { id: 't-1', name: 'beach' } as Trait,
      { id: 't-2', name: 'hiking' } as Trait,
    ];
    fetchMock.mockResolvedValue(mockResponse(true, 200, list));
    const { result } = renderHook(() => useTraits(DEFAULT_PARAMS));
    await act(async () => {
      await result.current.fetchTraits();
    });
    expect(result.current.traits).toEqual(list);
    expect([...result.current.selectedTraitNames].sort()).toEqual(['beach', 'hiking']);
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe(`${BACKEND}/api/traits`);
    expect((init as any)?.headers?.Authorization).toBe('Bearer t');
  });

  it('fetchTraits leaves state untouched on server error', async () => {
    fetchMock.mockResolvedValue(mockResponse(false, 500, { error: 'boom' }));
    const { result } = renderHook(() => useTraits(DEFAULT_PARAMS));
    act(() => {
      result.current.setTraits([{ id: 'x', name: 'keep' } as Trait]);
    });
    await act(async () => {
      await result.current.fetchTraits();
    });
    expect(result.current.traits).toEqual([{ id: 'x', name: 'keep' }]);
  });

  it('fetchTraitProfile no-ops without a user token', async () => {
    const { result } = renderHook(() =>
      useTraits({ backendUrl: BACKEND, userToken: null })
    );
    await act(async () => {
      await result.current.fetchTraitProfile();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetchTraitProfile sets traitAge + traitGender from /demographics', async () => {
    fetchMock.mockResolvedValue(mockResponse(true, 200, { age: 35, gender: 'female' }));
    const { result } = renderHook(() => useTraits(DEFAULT_PARAMS));
    await act(async () => {
      await result.current.fetchTraitProfile();
    });
    expect(result.current.traitAge).toBe('35');
    expect(result.current.traitGender).toBe('female');
  });

  it('fetchTraitProfile ignores unknown gender values', async () => {
    fetchMock.mockResolvedValue(mockResponse(true, 200, { age: 40, gender: 'alien' }));
    const { result } = renderHook(() => useTraits(DEFAULT_PARAMS));
    await act(async () => {
      await result.current.fetchTraitProfile();
    });
    expect(result.current.traitAge).toBe('40');
    expect(result.current.traitGender).toBe('prefer-not');
  });

  it('fetchTraitProfile leaves traitAge unchanged when server returns null', async () => {
    fetchMock.mockResolvedValue(mockResponse(true, 200, { age: null }));
    const { result } = renderHook(() => useTraits(DEFAULT_PARAMS));
    act(() => result.current.setTraitAge('42'));
    await act(async () => {
      await result.current.fetchTraitProfile();
    });
    expect(result.current.traitAge).toBe('42');
  });

  it('clearTraitsState resets everything to initial values', () => {
    const { result } = renderHook(() => useTraits(DEFAULT_PARAMS));
    act(() => {
      result.current.setTraits([{ id: 'a', name: 'beach' } as Trait]);
      result.current.setNewTraitName('city');
      result.current.setSelectedTraitNames(new Set(['beach']));
      result.current.setTraitAge('30');
      result.current.setTraitGender('nonbinary');
      result.current.setShowGenderDropdown(true);
    });
    act(() => {
      result.current.clearTraitsState();
    });
    expect(result.current.traits).toEqual([]);
    expect(result.current.newTraitName).toBe('');
    expect(result.current.selectedTraitNames.size).toBe(0);
    expect(result.current.traitAge).toBe('');
    expect(result.current.traitGender).toBe('prefer-not');
    expect(result.current.showGenderDropdown).toBe(false);
  });
});
