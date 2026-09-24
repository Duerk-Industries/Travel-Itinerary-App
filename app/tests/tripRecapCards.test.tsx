/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TripRecapCards from '../components/TripRecapCards';

jest.mock('../utils/clipboard', () => ({ copyToClipboard: jest.fn(async () => 'copied') }));
import { copyToClipboard } from '../utils/clipboard';

describe('TripRecapCards', () => {
  const baseRecap = {
    title: 'Italy', dayCount: 12, startDate: '2027-07-01', endDate: '2027-07-12',
    placeCount: 4, distanceKm: 612, photoCount: 384, videoCount: 6,
    generatedAt: '2027-08-01T12:00:00.000Z',
    topPhoto: { assetId: 'asset-1', altText: 'The group overlooking Florence' },
    topContributors: [{ userId: 'u1', displayName: 'Maya', contributionCount: 218 }],
    topPhotoContributor: { userId: 'u1', displayName: 'Maya', photoCount: 210 },
    mostCommentedDay: { dayDate: '2027-07-07', commentCount: 41 },
  };

  it('renders the date range, stats and spend without persisting spend into the payload', () => {
    const view = render(<TripRecapCards recap={baseRecap} topPhotoUrl="https://cdn.test/photo.jpg" spendTotal={1234.5} currency="USD" />);
    expect(view.getByText('12 days · 4 places · 612 km · 384 photos · 6 videos')).toBeTruthy();
    expect(view.getByText(/Jul 1.*Jul 12/)).toBeTruthy(); // formatted date range
    expect(view.getByLabelText('The group overlooking Florence')).toBeTruthy();
    expect(view.getByText('Traveler spotlight: Maya')).toBeTruthy();
    expect(view.getByTestId('trip-recap-spend')).toBeTruthy();
    expect(baseRecap).not.toHaveProperty('spendTotal');
  });

  it('uses fallbackPhotoUrl for the hero when no photo has reactions, without the "most-loved" label', () => {
    const view = render(<TripRecapCards recap={{ ...baseRecap, topPhoto: null }} topPhotoUrl={null} fallbackPhotoUrl="https://cdn.test/first.jpg" />);
    expect(view.queryByText('♥ Most-loved photo')).toBeNull();
    // hero still rendered (ImageBackground with the fallback)
    expect(view.getByLabelText('Trip photo')).toBeTruthy();
  });

  it('Share copies a summary to the clipboard on web and confirms', async () => {
    const view = render(<TripRecapCards recap={baseRecap} shareUrl="https://wander-bunnies.com/bryan/italy" />);
    await act(async () => { fireEvent.press(view.getByTestId('trip-recap-share')); });
    await waitFor(() => expect(view.getByTestId('trip-recap-share-feedback')).toBeTruthy());
    expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('https://wander-bunnies.com/bryan/italy'));
  });

  it('shows a "Read the full story" link only when a public URL is available', () => {
    expect(render(<TripRecapCards recap={baseRecap} />).queryByTestId('trip-recap-open-public')).toBeNull();
    expect(render(<TripRecapCards recap={baseRecap} shareUrl="https://x.test/a/b" />).getByTestId('trip-recap-open-public')).toBeTruthy();
  });

  it('shows Phase 7 awards only behind the presentation flag', () => {
    const recap = { title: 'Italy', topPhoto: { assetId: 'a1', reactionTotal: 12 }, topPhotoContributor: { displayName: 'Maya', photoCount: 44 }, mostCommentedDay: { dayDate: '2027-07-07', commentCount: 8 } };
    expect(render(<TripRecapCards recap={recap} />).queryByTestId('trip-awards')).toBeNull();
    expect(render(<TripRecapCards recap={recap} showAwards />).getByText('📸 Shutterbug · Maya · 44 photos')).toBeTruthy();
  });
});
