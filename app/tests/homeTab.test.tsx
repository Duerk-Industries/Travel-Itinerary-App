/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import HomeTab from '../tabs/HomeTab';

describe('HomeTab', () => {
  const styles = {
    card: {},
    homeScrollContent: {},
    homeTitle: {},
    homeHeroCard: {},
    homeHeroImage: {},
    homeHeroFallback: {},
    homeHeroOverlay: {},
    homeHeroTextWrap: {},
    homeHeroSubtitle: {},
    homeHeroTitle: {},
    homeHeroChangeTripBadge: {},
    homeHeroChangeTripText: {},
    homeNavList: {},
    homeNavButton: {},
    homeNavButtonDisabled: {},
    homeNavIcon: {},
    homeNavLabel: {},
    homeNavArrow: {},
    homeModalOverlay: {},
    homeModalCard: {},
    homeModalHeader: {},
    homeModalTitle: {},
    homeModalClose: {},
    homeModalCloseText: {},
    homeModalList: {},
    homeModalRow: {},
    homeModalRowActive: {},
    homeModalRowText: {},
    homeModalRowTitle: {},
    homeModalRowMeta: {},
    homeModalActiveBadge: {},
    row: {},
    button: {},
    smallButton: {},
    buttonText: {},
    input: {},
    dangerButton: {},
    dangerButtonText: {},
  };

  const trips = [
    { id: 't1', name: 'Alpha Trip', destination: 'Rome', startDate: null, endDate: null },
    { id: 't2', name: 'Bravo Trip', destination: 'Cairo', startDate: '2026-02-01', endDate: '2026-02-05' },
    { id: 't3', name: 'Charlie Trip', destination: 'Oslo', startDate: '2026-03-01', endDate: '2026-03-05' },
  ];
  const followedTrips = [{ tripId: 'f1', tripName: 'Followed Trip', destination: 'Bucharest', todayDetails: [] }];

  beforeEach(() => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://example.com/hero.jpg' }),
    } as any);
  });

  afterEach(() => {
    (global.fetch as jest.Mock).mockRestore();
  });

  test('renders hero and opens trip picker modal', async () => {
    const { findByText, getByTestId, queryByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId="t2"
        trips={trips}
        followedTrips={followedTrips}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={jest.fn()}
        onFollowTrip={jest.fn(async () => null)}
      />
    );

    expect(await findByText('Your trip')).toBeTruthy();
    expect(await findByText('Cairo')).toBeTruthy();

    fireEvent.press(getByTestId('home-hero-card'));
    expect(getByTestId('home-trip-modal')).toBeTruthy();

    fireEvent.press(getByTestId('home-trip-row-t1'));
    await waitFor(() => expect(queryByTestId('home-trip-modal')).toBeNull());
  });

  test('orders trips with active first, then no start date, then by start date', async () => {
    const { getByTestId, getAllByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId="t2"
        trips={trips}
        followedTrips={followedTrips}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={jest.fn()}
        onFollowTrip={jest.fn(async () => null)}
      />
    );

    fireEvent.press(getByTestId('home-hero-card'));
    const rows = getAllByTestId(/home-trip-row-/);
    const order = rows.map((row) => row.props.testID.replace('home-trip-row-', ''));
    expect(order).toEqual(['t2', 't1', 't3']);
  });

  test('navigates when a home button is pressed', () => {
    const onNavigate = jest.fn();
    const { getByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId="t2"
        trips={trips}
        followedTrips={followedTrips}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={onNavigate}
        onFollowTrip={jest.fn(async () => null)}
      />
    );

    fireEvent.press(getByTestId('home-nav-flights'));
    expect(onNavigate).toHaveBeenCalledWith('flights');

    fireEvent.press(getByTestId('home-nav-packing'));
    expect(onNavigate).toHaveBeenCalledWith('packing');
  });

  test('hides restricted pages for followed trips', () => {
    const { queryByTestId, getByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId="f1"
        trips={trips}
        followedTrips={followedTrips}
        activeTripOverride={{ id: 'f1', name: 'Followed Trip', destination: 'Bucharest' }}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={jest.fn()}
        onFollowTrip={jest.fn(async () => null)}
        hiddenPages={new Set(['expenses', 'ingest', 'ledger', 'trips', 'create-trip', 'follow', 'following'])}
      />
    );

    expect(getByTestId('home-nav-overview')).toBeTruthy();
    expect(getByTestId('home-nav-flights')).toBeTruthy();
    expect(getByTestId('home-nav-lodging')).toBeTruthy();
    expect(getByTestId('home-nav-packing')).toBeTruthy();
    expect(getByTestId('home-nav-tours')).toBeTruthy();
    expect(getByTestId('home-nav-car')).toBeTruthy();
    expect(getByTestId('home-nav-cost')).toBeTruthy();
    expect(queryByTestId('home-nav-expenses')).toBeNull();
    expect(queryByTestId('home-nav-ingest')).toBeNull();
    expect(queryByTestId('home-nav-ledger')).toBeNull();
    expect(queryByTestId('home-nav-trips')).toBeNull();
    expect(queryByTestId('home-nav-create-trip')).toBeNull();
    expect(queryByTestId('home-nav-follow')).toBeNull();
    expect(queryByTestId('home-nav-following')).toBeNull();
    expect(queryByTestId('home-follow-trip-button')).toBeNull();
    expect(queryByTestId('home-create-trip-button')).toBeNull();
  });

  test('shows create trip and follow trip header actions for regular users', () => {
    const { queryByTestId, getByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId="t2"
        trips={trips}
        followedTrips={followedTrips}
        userRole="user"
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={jest.fn()}
        onFollowTrip={jest.fn(async () => null)}
      />
    );

    expect(getByTestId('home-nav-overview')).toBeTruthy();
    expect(getByTestId('home-nav-flights')).toBeTruthy();
    expect(getByTestId('home-nav-packing')).toBeTruthy();
    expect(getByTestId('home-create-trip-button')).toBeTruthy();
    expect(getByTestId('home-follow-trip-button')).toBeTruthy();
    expect(getByTestId('home-share-trip-button')).toBeTruthy();
    expect(queryByTestId('home-nav-ledger')).toBeNull();
    expect(queryByTestId('home-nav-trips')).toBeNull();
    expect(queryByTestId('home-nav-account')).toBeNull();
    expect(queryByTestId('home-nav-following')).toBeNull();
    expect(queryByTestId('home-nav-follow')).toBeNull();
    expect(queryByTestId('home-nav-create-trip')).toBeNull();
  });

  test('shows the change-trip cue on the hero and opens share from the home action', () => {
    const onOpenShareTrip = jest.fn();
    const onNavigate = jest.fn();
    const { getByText, getByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId="t2"
        trips={trips}
        followedTrips={followedTrips}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={onNavigate}
        onFollowTrip={jest.fn(async () => null)}
        onOpenShareTrip={onOpenShareTrip}
      />
    );

    expect(getByText('Click to Change Trip')).toBeTruthy();
    fireEvent.press(getByTestId('home-share-trip-button'));
    expect(onOpenShareTrip).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('shows a create-trip dialog when no trips are available', () => {
    const onNavigate = jest.fn();
    const { getByTestId, getByText, queryByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId={null}
        trips={[]}
        followedTrips={[]}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={onNavigate}
        onFollowTrip={jest.fn(async () => null)}
      />
    );

    fireEvent.press(getByTestId('home-hero-card'));
    expect(getByTestId('home-no-trips-dialog')).toBeTruthy();
    expect(getByText('A trip needs to be created before you can select one.')).toBeTruthy();

    fireEvent.press(getByTestId('home-no-trips-ok'));
    expect(queryByTestId('home-no-trips-dialog')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('opens create trip wizard from the no-trips dialog', () => {
    const onNavigate = jest.fn();
    const { getByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId={null}
        trips={[]}
        followedTrips={[]}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={onNavigate}
        onFollowTrip={jest.fn(async () => null)}
      />
    );

    fireEvent.press(getByTestId('home-hero-card'));
    fireEvent.press(getByTestId('home-no-trips-create'));
    expect(onNavigate).toHaveBeenCalledWith('create-trip');
  });

  test('opens follow dialog and submits a follow code', async () => {
    const onFollowTrip = jest.fn(async () => null);
    const { getByTestId, queryByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId="t2"
        trips={trips}
        followedTrips={followedTrips}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={jest.fn()}
        onFollowTrip={onFollowTrip}
      />
    );

    fireEvent.press(getByTestId('home-follow-trip-button'));
    fireEvent.changeText(getByTestId('home-follow-code-input'), 'ABC123');
    fireEvent.press(getByTestId('home-follow-submit'));

    await waitFor(() => expect(onFollowTrip).toHaveBeenCalledWith('ABC123'));
    await waitFor(() => expect(queryByTestId('home-follow-dialog')).toBeNull());
  });
});
