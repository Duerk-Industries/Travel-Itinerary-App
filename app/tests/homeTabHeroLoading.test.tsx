/**
 * @jest-environment node
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import HomeTab from '../tabs/HomeTab';

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
  row: {},
  button: {},
  smallButton: {},
  buttonText: {},
  input: {},
  dangerButton: {},
  dangerButtonText: {},
};

const trips = [
  { id: 't1', name: 'Rome Trip', destination: 'Rome', startDate: null, endDate: null },
];

describe('HomeTab hero loading state', () => {
  afterEach(() => {
    if ((global.fetch as jest.Mock)?.mockRestore) {
      (global.fetch as jest.Mock).mockRestore();
    }
  });

  it('shows a skeleton placeholder while the hero image is being fetched', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    jest.spyOn(global, 'fetch' as any).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { findByTestId, queryByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId="t1"
        trips={trips}
        followedTrips={[]}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={jest.fn()}
        onFollowTrip={jest.fn(async () => null)}
      />,
    );

    expect(await findByTestId('home-hero-skeleton')).toBeTruthy();

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({ url: 'https://example.com/hero.jpg' }),
      } as Response);
    });

    await waitFor(() => {
      expect(queryByTestId('home-hero-skeleton')).toBeNull();
    });
  });

  it('hides the skeleton after fetch failure', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    jest.spyOn(global, 'fetch' as any).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { findByTestId, queryByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId="t1"
        trips={trips}
        followedTrips={[]}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={jest.fn()}
        onFollowTrip={jest.fn(async () => null)}
      />,
    );

    expect(await findByTestId('home-hero-skeleton')).toBeTruthy();

    await act(async () => {
      resolveFetch({ ok: false, json: async () => ({}) } as Response);
    });

    await waitFor(() => {
      expect(queryByTestId('home-hero-skeleton')).toBeNull();
    });
  });

  it('does not render the skeleton when there is no active trip', () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://example.com/hero.jpg' }),
    } as any);

    const { queryByTestId } = render(
      <HomeTab
        backendUrl="http://localhost"
        headers={{}}
        activeTripId={null}
        trips={[]}
        followedTrips={[]}
        styles={styles}
        onSelectTrip={jest.fn()}
        onSelectFollowedTrip={jest.fn()}
        onNavigate={jest.fn()}
        onFollowTrip={jest.fn(async () => null)}
      />,
    );

    expect(queryByTestId('home-hero-skeleton')).toBeNull();
  });
});
