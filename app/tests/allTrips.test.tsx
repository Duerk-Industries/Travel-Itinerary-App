import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import AllTripsTab from '../tabs/allTrips';
import type { Trip } from '../../server/src/types';

describe('All trips page', () => {
  it('groups trips, prioritizes traveler membership, and selects either relationship', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'followed', startDate: '2000-01-01', endDate: '2000-01-02' }) });
    const onNavigate = jest.fn();
    const onSelectTrip = jest.fn();
    const onSelectFollowedTrip = jest.fn();
    const trips: Trip[] = [{ id: 'traveler', groupId: 'group', name: 'Future adventure', createdAt: '', startDate: '2099-01-01', endDate: '2099-01-02' }];
    try {
      const screen = render(<AllTripsTab backendUrl="http://localhost" headers={{}} trips={trips}
        followedTrips={[{ tripId: 'followed', tripName: 'Old adventure', todayDetails: [] }, { tripId: 'traveler', tripName: 'Future adventure', todayDetails: [] }]}
        onNavigate={onNavigate} onFollowTrip={async () => null} activeTripId="traveler" styles={{}} onSelectTrip={onSelectTrip} onSelectFollowedTrip={onSelectFollowedTrip} onBack={jest.fn()} />);
      await waitFor(() => expect(within(screen.getByTestId('all-trips-past')).getByText('Old adventure')).toBeTruthy());
      expect(within(screen.getByTestId('all-trips-upcoming')).getByText('Future adventure')).toBeTruthy();
      expect(screen.getAllByText('Future adventure')).toHaveLength(1);
      expect(screen.queryByTestId('all-trips-current')).toBeNull();
      expect(screen.getAllByText('One the Trip')).toHaveLength(1);
      expect(screen.getAllByText('Following')).toHaveLength(1);
      expect(within(screen.getByTestId('all-trips-upcoming')).queryByText('Following')).toBeNull();
      expect(within(screen.getByTestId('all-trips-past')).queryByText('One the Trip')).toBeNull();
      fireEvent.press(screen.getByTestId('all-trips-create-button'));
      expect(onNavigate).toHaveBeenCalledWith('create-trip');
      expect(screen.getByTestId('all-trips-follow-button')).toBeTruthy();
      fireEvent.press(screen.getByTestId('all-trips-row-traveler'));
      fireEvent.press(screen.getByTestId('all-trips-row-followed'));
      expect(onSelectTrip).toHaveBeenCalledWith('traveler');
      expect(onSelectFollowedTrip).toHaveBeenCalledWith('followed');
    } finally { global.fetch = originalFetch; }
  });
});
