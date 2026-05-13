/**
 * @jest-environment node
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import TripDetailsTab from '../tabs/tripDetails';

const styles = {
  card: {},
  sectionTitle: {},
  helperText: {},
  row: {},
  flightTitle: {},
  headerText: {},
  bodyText: {},
  linkText: {},
  buttonText: {},
  divider: {},
  input: {},
  dropdown: {},
  selectButtonRow: {},
  selectCaret: {},
  dropdownList: {},
  dropdownOption: {},
  cellText: {},
  button: {},
  modalOverlay: {},
  modalCard: {},
  detailModal: {},
  modalLabel: {},
  smallButton: {},
};

describe('TripDetailsTab currency dropdown', () => {
  it('calls onUpdateCurrency when selecting a new currency', () => {
    const onUpdateCurrency = jest.fn();
    const trip = {
      id: 't1',
      groupId: 'g1',
      name: 'Currency Trip',
      createdAt: '2025-01-01',
      currency: 'USD',
    };
    const { getByText } = render(
      <TripDetailsTab
        trip={trip as any}
        group={{ id: 'g1', name: 'Group', members: [], invites: [] }}
        styles={styles}
        onUpdateCurrency={onUpdateCurrency}
      />
    );

    fireEvent.press(getByText('USD'));
    fireEvent.press(getByText('EUR'));

    expect(onUpdateCurrency).toHaveBeenCalledWith('t1', 'EUR');
  });

  it('renders trip settings without discussion, description, or set-active controls', () => {
    const trip = {
      id: 't1',
      groupId: 'g1',
      name: 'Settings Trip',
      description: 'Hiking trip to Yosemite National Park',
      createdAt: '2025-01-01',
      currency: 'USD',
    };
    const { getByText, queryByText } = render(
      <TripDetailsTab
        trip={trip as any}
        group={{ id: 'g1', name: 'Group', members: [], invites: [] }}
        styles={styles}
        onUpdateCurrency={jest.fn()}
      />
    );

    expect(getByText('Trip Settings')).toBeTruthy();
    expect(queryByText('Trip Details')).toBeNull();
    expect(queryByText(/Discussion/)).toBeNull();
    expect(queryByText('Set Active Trip')).toBeNull();
    expect(queryByText('Hiking trip to Yosemite National Park')).toBeNull();
  });

  it('opens the share modal for the requested trip signal', async () => {
    const originalFetch = global.fetch;
    if (!global.fetch) {
      (global as any).fetch = jest.fn();
    }
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ followCode: 'ABC123', invites: [] }),
    } as any);
    const onOpenShareHandled = jest.fn();
    const trip = {
      id: 't1',
      groupId: 'g1',
      name: 'Share Trip',
      createdAt: '2025-01-01',
      currency: 'USD',
    };

    const { getByText } = render(
      <TripDetailsTab
        backendUrl="http://localhost"
        headers={{ Authorization: 'Bearer test' }}
        trip={trip as any}
        group={{ id: 'g1', name: 'Group', members: [], invites: [] }}
        styles={styles}
        openShareSignal={1}
        openShareTripId="t1"
        onOpenShareHandled={onOpenShareHandled}
        onUpdateCurrency={jest.fn()}
      />
    );

    await waitFor(() => expect(getByText('Share link (Follower access)')).toBeTruthy());
    expect(onOpenShareHandled).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/api/trips/t1/share/meta', {
      headers: { Authorization: 'Bearer test' },
    });

    fetchMock.mockRestore();
    if (!originalFetch) {
      delete (global as any).fetch;
    }
  });
});
