/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import HomeTab from '../tabs/HomeTab';
import FollowTripButton from '../components/FollowTripButton';

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
    homeModalRowDelete: {},
    homeModalRowDeletePressed: {},
    homeModalRowDeleteText: {},
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

  test('uses the requested Home link order and navigates to Ground Transfers', () => {
    const onNavigate = jest.fn();
    const { getAllByTestId, getByTestId, getByText } = render(
      <HomeTab backendUrl="http://localhost" headers={{}} activeTripId="t2" trips={trips}
        followedTrips={followedTrips} styles={styles} userTier="pro" onSelectTrip={jest.fn()} onSelectFollowedTrip={jest.fn()}
        onNavigate={onNavigate} />
    );
    const order = getAllByTestId(/^home-nav-/).map(node => node.props.testID);
    expect(order).toEqual([
      'home-nav-overview', 'home-nav-blog', 'home-nav-flights', 'home-nav-lodging',
      'home-nav-tours', 'home-nav-ground-transfers', 'home-nav-car', 'home-nav-expenses',
      'home-nav-cost', 'home-nav-packing', 'home-nav-ingest',
    ]);
    expect(getByText('Flights')).toBeTruthy();
    fireEvent.press(getByTestId('home-nav-ground-transfers'));
    expect(onNavigate).toHaveBeenCalledWith('ground-transfers');
    fireEvent.press(getByTestId('home-all-trips'));
    expect(onNavigate).toHaveBeenCalledWith('all-trips');
  });

  test('opens the picture chooser from the hero and keeps trip changes in the menu', async () => {
    const onNavigate = jest.fn();
    const { getByTestId, findByText, queryByTestId } = render(
      <HomeTab backendUrl="http://localhost" headers={{}} activeTripId="t2" trips={trips} followedTrips={followedTrips}
        styles={styles} onSelectTrip={jest.fn()} onSelectFollowedTrip={jest.fn()} onNavigate={onNavigate} />
    );
    expect(await findByText('Click to Change Picture')).toBeTruthy();
    fireEvent.press(getByTestId('home-hero-card'));
    expect(await findByText('Upload picture')).toBeTruthy();
    expect(queryByTestId('home-trip-modal')).toBeNull();
    fireEvent.press(await findByText('Cancel'));
    fireEvent.press(getByTestId('home-all-trips'));
    expect(onNavigate).toHaveBeenCalledWith('all-trips');
  });

  test('keeps full-screen trip dialogs clear of the status bar and home indicator', () => {
    const insets = jest.spyOn(require('react-native-safe-area-context'), 'useSafeAreaInsets')
      .mockReturnValue({ top: 59, right: 0, bottom: 34, left: 0 });
    const { getByTestId } = render(<FollowTripButton styles={styles} onFollowTrip={jest.fn()} />);
    fireEvent.press(getByTestId('all-trips-follow-button'));
    const style = Object.assign({}, ...getByTestId('all-trips-follow-dialog').props.style);
    expect(style.paddingTop).toBe(75);
    expect(style.paddingBottom).toBe(50);
    insets.mockRestore();
  });

  test('does not allow followers to change the banner', () => {
    const { queryByText, getByTestId } = render(
      <HomeTab readOnly backendUrl="http://localhost" headers={{}} activeTripId="t2" trips={trips} followedTrips={followedTrips}
        styles={styles} onSelectTrip={jest.fn()} onSelectFollowedTrip={jest.fn()} onNavigate={jest.fn()} />
    );
    fireEvent.press(getByTestId('home-hero-card'));
    expect(queryByText('Click to Change Picture')).toBeNull();
    expect(queryByText('Upload picture')).toBeNull();
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

  test('shows the Ingest nav tile to admins and Premium/Pro users, hides it from Free users', () => {
    const baseProps = {
      backendUrl: 'http://localhost',
      headers: {},
      activeTripId: 't2',
      trips,
      followedTrips,
      styles,
      onSelectTrip: jest.fn(),
      onSelectFollowedTrip: jest.fn(),
      onNavigate: jest.fn(),
    };

    const freeUser = render(<HomeTab {...baseProps} userRole="user" userTier="free" />);
    expect(freeUser.queryByTestId('home-nav-ingest')).toBeNull();
    freeUser.unmount();

    const premiumUser = render(<HomeTab {...baseProps} userRole="user" userTier="premium" />);
    expect(premiumUser.getByTestId('home-nav-ingest')).toBeTruthy();
    premiumUser.unmount();

    const proUser = render(<HomeTab {...baseProps} userRole="user" userTier="pro" />);
    expect(proUser.getByTestId('home-nav-ingest')).toBeTruthy();
    proUser.unmount();

    const admin = render(<HomeTab {...baseProps} userRole="admin" userTier="free" />);
    expect(admin.getByTestId('home-nav-ingest')).toBeTruthy();
  });

  test('keeps trip management actions off Home', () => {
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
      />
    );

    expect(getByTestId('home-nav-overview')).toBeTruthy();
    expect(getByTestId('home-nav-flights')).toBeTruthy();
    expect(getByTestId('home-nav-packing')).toBeTruthy();
    expect(queryByTestId('home-create-trip-button')).toBeNull();
    expect(queryByTestId('home-follow-trip-button')).toBeNull();
    expect(queryByTestId('home-share-trip-button')).toBeNull();
    expect(queryByTestId('home-nav-ledger')).toBeNull();
    expect(queryByTestId('home-nav-trips')).toBeNull();
    expect(queryByTestId('home-nav-account')).toBeNull();
    expect(queryByTestId('home-nav-following')).toBeNull();
    expect(queryByTestId('home-nav-follow')).toBeNull();
    expect(queryByTestId('home-nav-create-trip')).toBeNull();
  });

  test('shows the change-picture cue without a Share action', () => {
    const onOpenShareTrip = jest.fn();
    const onNavigate = jest.fn();
    const { getByText, queryByTestId } = render(
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
      />
    );

    expect(getByText('Click to Change Picture')).toBeTruthy();
    expect(queryByTestId('home-share-trip-button')).toBeNull();
    expect(onOpenShareTrip).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('keeps trip creation available in the menu when no trip is selected', () => {
    const onNavigate = jest.fn();
    const { getByTestId, queryByText } = render(
      <HomeTab backendUrl="http://localhost" headers={{}} activeTripId={null} trips={[]} followedTrips={[]}
        styles={styles} onSelectTrip={jest.fn()} onSelectFollowedTrip={jest.fn()} onNavigate={onNavigate} />
    );
    fireEvent.press(getByTestId('home-all-trips'));
    expect(onNavigate).toHaveBeenCalledWith('all-trips');
    expect(queryByText('Click to Change Picture')).toBeNull();
  });

  test('opens the relocated follow dialog and submits a follow code', async () => {
    const onFollowTrip = jest.fn(async () => null);
    const { getByTestId, queryByTestId } = render(<FollowTripButton styles={styles} onFollowTrip={onFollowTrip} />);
    fireEvent.press(getByTestId('all-trips-follow-button'));
    fireEvent.changeText(getByTestId('all-trips-follow-code-input'), 'ABC123');
    fireEvent.press(getByTestId('all-trips-follow-submit'));

    await waitFor(() => expect(onFollowTrip).toHaveBeenCalledWith('ABC123'));
    await waitFor(() => expect(queryByTestId('all-trips-follow-dialog')).toBeNull());
  });
});
