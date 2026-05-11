/**
 * @jest-environment node
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import PackingListTable from '../components/PackingListTable';

describe('PackingListTable', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders trip items with traveler columns and toggles packed state', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        travelers: [{ id: 'traveler-1', name: 'Alex' }],
        items: [{ id: 'item-1', category: 'Documents', label: 'Passport', position: 0, packedBy: [] }],
      }),
    } as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as any);

    const { findByText, getByTestId } = render(
      <PackingListTable
        backendUrl="http://localhost"
        headers={{ Authorization: 'Bearer token' }}
        tripId="trip-1"
        variant="trip"
      />
    );

    expect(await findByText('Documents')).toBeTruthy();
    expect(await findByText('Alex')).toBeTruthy();

    fireEvent.press(getByTestId('packing-check-item-1-traveler-1'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost/api/trips/trip-1/packing-list/checks',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ itemId: 'item-1', travelerId: 'traveler-1', packed: true }),
        })
      );
    });
  });

  test('edits a user default list and saves ordered items', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ id: 'item-1', category: 'Documents', label: 'Passport', position: 0 }],
      }),
    } as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { id: 'item-1', category: 'Documents', label: 'Passport', position: 0 },
          { id: 'item-2', category: 'Electronics', label: 'Phone charger', position: 1 },
        ],
      }),
    } as any);

    const { findByText, getByText, getByTestId } = render(
      <PackingListTable
        backendUrl="http://localhost"
        headers={{ Authorization: 'Bearer token' }}
        variant="user"
      />
    );

    expect(await findByText('Passport')).toBeTruthy();
    fireEvent.press(getByText('Edit'));
    fireEvent.press(getByTestId('user-packing-add-item'));
    fireEvent.changeText(getByTestId(/^user-packing-item-draft-/), 'Phone charger');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost/api/account/packing-list',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('Phone charger'),
        })
      );
    });
  });
});
