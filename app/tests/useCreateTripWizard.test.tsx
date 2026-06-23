/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook } from '@testing-library/react-native';
import { useCreateTripWizard } from '../hooks/useCreateTripWizard';

describe('useCreateTripWizard', () => {
  it('starts with empty name and null groupId when there are no groups', () => {
    const { result } = renderHook(() =>
      useCreateTripWizard({ groups: [], createTrip: jest.fn(), userToken: 't' })
    );
    expect(result.current.newTripName).toBe('');
    expect(result.current.newTripGroupId).toBeNull();
  });

  it('auto-selects the first group when groups arrive', () => {
    const initialProps = { groups: [] as Array<{ id: string }> };
    const { result, rerender } = renderHook(
      (props: { groups: Array<{ id: string }> }) =>
        useCreateTripWizard({
          groups: props.groups,
          createTrip: jest.fn(),
          userToken: 't',
        }),
      { initialProps }
    );
    expect(result.current.newTripGroupId).toBeNull();
    rerender({ groups: [{ id: 'g-1' }, { id: 'g-2' }] });
    expect(result.current.newTripGroupId).toBe('g-1');
  });

  it('resets selection to first remaining group when the chosen group disappears', () => {
    const initialProps = { groups: [{ id: 'g-1' }, { id: 'g-2' }] };
    const { result, rerender } = renderHook(
      (props: { groups: Array<{ id: string }> }) =>
        useCreateTripWizard({
          groups: props.groups,
          createTrip: jest.fn(),
          userToken: 't',
        }),
      { initialProps }
    );
    act(() => {
      result.current.setNewTripGroupId('g-2');
    });
    expect(result.current.newTripGroupId).toBe('g-2');
    rerender({ groups: [{ id: 'g-1' }] });
    expect(result.current.newTripGroupId).toBe('g-1');
  });

  it('submit rejects with error when not signed in', async () => {
    const createTrip = jest.fn();
    const { result } = renderHook(() =>
      useCreateTripWizard({ groups: [{ id: 'g-1' }], createTrip, userToken: null })
    );
    const r = await result.current.submit();
    expect(r).toEqual({ ok: false, error: 'Not signed in' });
    expect(createTrip).not.toHaveBeenCalled();
  });

  it('submit validates name is non-empty', async () => {
    const createTrip = jest.fn();
    const { result } = renderHook(() =>
      useCreateTripWizard({ groups: [{ id: 'g-1' }], createTrip, userToken: 't' })
    );
    const r = await result.current.submit();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Enter a trip name');
    expect(createTrip).not.toHaveBeenCalled();
  });

  it('submit validates a group is selected', async () => {
    const createTrip = jest.fn();
    const { result } = renderHook(() =>
      useCreateTripWizard({ groups: [], createTrip, userToken: 't' })
    );
    act(() => {
      result.current.setNewTripName('Paris');
    });
    const r = await result.current.submit();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('choose a group');
    expect(createTrip).not.toHaveBeenCalled();
  });

  it('submit calls createTrip with trimmed name + groupId and clears the name on success', async () => {
    const createTrip = jest.fn(async () => ({ ok: true, tripId: 't-1' }));
    const { result } = renderHook(() =>
      useCreateTripWizard({ groups: [{ id: 'g-1' }], createTrip, userToken: 't' })
    );
    act(() => {
      result.current.setNewTripName('   Paris   ');
    });
    let r;
    await act(async () => {
      r = await result.current.submit();
    });
    expect(r).toEqual({ ok: true, tripId: 't-1' });
    expect(createTrip).toHaveBeenCalledWith({ name: 'Paris', groupId: 'g-1' });
    expect(result.current.newTripName).toBe('');
  });

  it('submit does not clear name when createTrip returns ok:false', async () => {
    const createTrip = jest.fn(async () => ({ ok: false, error: 'conflict' }));
    const { result } = renderHook(() =>
      useCreateTripWizard({ groups: [{ id: 'g-1' }], createTrip, userToken: 't' })
    );
    act(() => {
      result.current.setNewTripName('Paris');
    });
    let r;
    await act(async () => {
      r = await result.current.submit();
    });
    expect(r).toEqual({ ok: false, error: 'conflict' });
    expect(result.current.newTripName).toBe('Paris');
  });
});
