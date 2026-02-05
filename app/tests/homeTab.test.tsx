/**
 * @jest-environment node
 */

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
  };

  const trips = [
    { id: 't1', name: 'Alpha Trip', destination: 'Rome', startDate: null, endDate: null },
    { id: 't2', name: 'Bravo Trip', destination: 'Cairo', startDate: '2026-02-01', endDate: '2026-02-05' },
    { id: 't3', name: 'Charlie Trip', destination: 'Oslo', startDate: '2026-03-01', endDate: '2026-03-05' },
  ];

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
        styles={styles}
        onSelectTrip={jest.fn()}
        onNavigate={jest.fn()}
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
        styles={styles}
        onSelectTrip={jest.fn()}
        onNavigate={jest.fn()}
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
        styles={styles}
        onSelectTrip={jest.fn()}
        onNavigate={onNavigate}
      />
    );

    fireEvent.press(getByTestId('home-nav-flights'));
    expect(onNavigate).toHaveBeenCalledWith('flights');
  });
});
