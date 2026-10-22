import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AutomaticImportSettings from '../components/AutomaticImportSettings';

const headers = { Authorization: 'Bearer owner-a' };
const history = [{ item: { id: 'item-a', providerVendor: 'Hotel' }, tripName: 'Japan', tripId: 'trip-a', reasons: ['Dates and destination match'], undoExpiresAt: '2026-10-26T00:00:00Z' }];
afterEach(() => jest.restoreAllMocks());
it('explains default-on automation, lets the user turn it off, and reports safe Undo conflicts', async () => {
  const fetcher = jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    const path = String(url);
    if (path.endsWith('/undo')) return { ok: false, json: async () => ({ error: 'Someone edited this booking. It was kept.' }) } as Response;
    if (options?.method === 'PUT') return { ok: true, json: async () => ({}) } as Response;
    return { ok: true, json: async () => path.endsWith('/settings') ? { autoAssign: { available: true, enabled: true, choice: null } } : { items: history } } as Response;
  });
  const screen = render(<AutomaticImportSettings backendUrl="https://api.test" headers={headers} />);
  await waitFor(() => expect(screen.getByLabelText('Automatically add matching bookings')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Automatically add matching bookings'));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('https://api.test/api/ingestion/settings', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ autoAssign: false }) })));
  await waitFor(() => expect(screen.getByLabelText('Undo Hotel')).toBeTruthy());
  // Wait for the settings mutation's read-back before another operation.
  await waitFor(() => expect(fetcher.mock.calls.filter(call => String(call[0]).endsWith('/auto-added'))).toHaveLength(2));
  fireEvent.press(screen.getByLabelText('Undo Hotel'));
  await waitFor(() => expect(screen.getByText('Someone edited this booking. It was kept.')).toBeTruthy());
});
it('keeps recovery history available when automation is globally disabled', async () => {
  jest.spyOn(global, 'fetch').mockImplementation(async url => ({ ok: true, json: async () => String(url).endsWith('/settings') ? { autoAssign: { available: false, enabled: false, choice: null } } : { items: history } }) as Response);
  const screen = render(<AutomaticImportSettings backendUrl="https://api.test" headers={headers} />);
  await waitFor(() => expect(screen.getByLabelText('Undo Hotel')).toBeTruthy());
  expect(screen.queryByLabelText('Automatically add matching bookings')).toBeNull();
});
