import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import AllTripsTab from '../tabs/allTrips';
import type { Trip } from '../../server/src/types';

describe('All trips page', () => {
  it('places unscheduled trips after Upcoming with traveler and following subsections', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'follow', durationDays: 5 }) });
    try {
      const screen = render(<AllTripsTab backendUrl="http://localhost" headers={{}} trips={[
        { id: 'future', groupId: 'g', name: 'Future', createdAt: '', startDate: '2099-01-01', endDate: '2099-01-02' },
        { id: 'unscheduled', groupId: 'g', name: 'Someday', createdAt: '', durationDays: 7 },
        { id: 'past', groupId: 'g', name: 'Past', createdAt: '', startDate: '2000-01-01', endDate: '2000-01-02' },
      ]} followedTrips={[{ tripId: 'follow', tripName: 'Following someday', todayDetails: [] }]} activeTripId={null}
        styles={{}} onSelectTrip={jest.fn()} onSelectFollowedTrip={jest.fn()} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Dates not set · 5 day(s)')).toBeTruthy());
      const unscheduled = within(screen.getByTestId('all-trips-unscheduled'));
      expect(unscheduled.getByText('On the Trip')).toBeTruthy();
      expect(unscheduled.getByText('Following')).toBeTruthy();
      expect(unscheduled.getByText('Someday')).toBeTruthy();
      expect(unscheduled.getByText('Dates not set · 7 day(s)')).toBeTruthy();
      expect(screen.getAllByTestId(/^all-trips-(upcoming|unscheduled|past)$/).map((section) => section.props.testID))
        .toEqual(['all-trips-upcoming', 'all-trips-unscheduled', 'all-trips-past']);
    } finally { global.fetch = originalFetch; }
  });
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
      expect(screen.getAllByText('On the Trip')).toHaveLength(1);
      expect(screen.getAllByText('Following')).toHaveLength(1);
      expect(within(screen.getByTestId('all-trips-upcoming')).queryByText('Following')).toBeNull();
      expect(within(screen.getByTestId('all-trips-past')).queryByText('On the Trip')).toBeNull();
      fireEvent.press(screen.getByTestId('all-trips-create-button'));
      expect(onNavigate).toHaveBeenCalledWith('create-trip');
      expect(screen.getByTestId('all-trips-follow-button')).toBeTruthy();
      fireEvent.press(screen.getByTestId('all-trips-row-traveler'));
      fireEvent.press(screen.getByTestId('all-trips-row-followed'));
      expect(onSelectTrip).toHaveBeenCalledWith('traveler');
      expect(onSelectFollowedTrip).toHaveBeenCalledWith('followed');
    } finally { global.fetch = originalFetch; }
  });
  it('offers Delete on trips the traveler is on, not on followed trips, without selecting the trip', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'followed', startDate: '2000-01-01', endDate: '2000-01-02' }) });
    const onDeleteTrip = jest.fn();
    const onSelectTrip = jest.fn();
    try {
      const screen = render(<AllTripsTab backendUrl="http://localhost" headers={{}} trips={[{ id: 'mine', groupId: 'g', name: 'Mine', createdAt: '', startDate: '2099-01-01', endDate: '2099-01-02' }]}
        followedTrips={[{ tripId: 'followed', tripName: 'Theirs', todayDetails: [] }]} activeTripId={null} styles={{}} onSelectTrip={onSelectTrip}
        onSelectFollowedTrip={jest.fn()} onDeleteTrip={onDeleteTrip} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Theirs')).toBeTruthy());
      expect(screen.queryByTestId('all-trips-row-delete-followed')).toBeNull();
      fireEvent.press(screen.getByTestId('all-trips-row-delete-mine'));
      expect(onDeleteTrip).toHaveBeenCalledWith({ id: 'mine', name: 'Mine' });
      expect(onSelectTrip).not.toHaveBeenCalled();
    } finally { global.fetch = originalFetch; }
  });
  describe('Unfollow', () => {
    const renderFollowed = async (onUnfollowTrip: jest.Mock) => {
      const onSelectFollowedTrip = jest.fn();
      const screen = render(<AllTripsTab backendUrl="http://localhost" headers={{}} trips={[{ id: 'mine', groupId: 'g', name: 'Mine', createdAt: '', startDate: '2099-01-01', endDate: '2099-01-02' }]}
        followedTrips={[{ tripId: 'followed', tripName: 'Theirs', todayDetails: [] }]} activeTripId={null} styles={{}} onSelectTrip={jest.fn()}
        onSelectFollowedTrip={onSelectFollowedTrip} onUnfollowTrip={onUnfollowTrip} onBack={jest.fn()} />);
      await waitFor(() => expect(screen.getByText('Theirs')).toBeTruthy());
      return { screen, onSelectFollowedTrip };
    };
    const originalFetch = global.fetch;
    beforeEach(() => { global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'followed', startDate: '2000-01-01', endDate: '2000-01-02' }) }); });
    afterEach(() => { global.fetch = originalFetch; });

    it('offers Unfollow only on followed trips and asks first, without selecting the trip', async () => {
      const onUnfollowTrip = jest.fn().mockResolvedValue(null);
      const { screen, onSelectFollowedTrip } = await renderFollowed(onUnfollowTrip);
      expect(screen.queryByTestId('all-trips-row-unfollow-mine')).toBeNull();
      fireEvent.press(screen.getByTestId('all-trips-row-unfollow-followed'));
      expect(onUnfollowTrip).not.toHaveBeenCalled();
      expect(onSelectFollowedTrip).not.toHaveBeenCalled();
      fireEvent.press(within(screen.getByTestId('all-trips-unfollow-dialog')).getByText('Unfollow'));
      await waitFor(() => expect(onUnfollowTrip).toHaveBeenCalledWith('followed'));
      await waitFor(() => expect(screen.queryByTestId('all-trips-unfollow-dialog')).toBeNull(), { timeout: 5000 });
    });

    it('keeps the dialog open with the reason when unfollowing fails', async () => {
      const { screen } = await renderFollowed(jest.fn().mockResolvedValue('Unable to unfollow trip'));
      fireEvent.press(screen.getByTestId('all-trips-row-unfollow-followed'));
      fireEvent.press(within(screen.getByTestId('all-trips-unfollow-dialog')).getByText('Unfollow'));
      await waitFor(() => expect(screen.getByText('Unable to unfollow trip')).toBeTruthy());
      expect(screen.getByTestId('all-trips-unfollow-dialog')).toBeTruthy();
    });
  });
});
