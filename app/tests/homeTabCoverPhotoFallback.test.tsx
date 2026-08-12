/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import HomeTab from '../tabs/HomeTab';

// Covers implementation-plan-ux-remediation.md Initiative B: once the hero
// image fetch fails/returns nothing, the trip hero falls back to the designed
// DestinationPlaceholderCard (flag on) or the plain empty tile it replaced
// (flag off) — never a broken-looking blank <Image>.
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
  { id: 't1', name: 'Kyoto Trip', destination: 'Kyoto', startDate: null, endDate: null },
];

describe('HomeTab cover photo fallback', () => {
  afterEach(() => {
    if ((global.fetch as jest.Mock)?.mockRestore) {
      (global.fetch as jest.Mock).mockRestore();
    }
  });

  it('renders the designed placeholder (not the plain empty tile) once no hero image is available', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, json: async () => ({}) } as any);

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
        featureCoverPhotoFallbackV2
      />,
    );

    expect(await findByTestId('home-hero-placeholder')).toBeTruthy();
    expect(queryByTestId('home-hero-fallback-legacy')).toBeNull();
  });

  it('reverts to the plain fallback tile when featureCoverPhotoFallbackV2 is disabled', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, json: async () => ({}) } as any);

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
        featureCoverPhotoFallbackV2={false}
      />,
    );

    expect(await findByTestId('home-hero-fallback-legacy')).toBeTruthy();
    await waitFor(() => {
      expect(queryByTestId('home-hero-placeholder')).toBeNull();
    });
  });
});
