/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { render } from '@testing-library/react-native';
import TripRecapCards from '../components/TripRecapCards';

describe('TripRecapCards', () => {
  it('renders a screenshot-ready, accessible recap without persisting spend into the recap payload', () => {
    const recap = {
      title: 'Italy', dayCount: 12, placeCount: 4, distanceKm: 612, photoCount: 384, videoCount: 6,
      generatedAt: '2027-08-01T12:00:00.000Z',
      topPhoto: { assetId: 'asset-1', altText: 'The group overlooking Florence' },
      topContributors: [{ userId: 'u1', displayName: 'Maya', contributionCount: 218 }],
      topPhotoContributor: { userId: 'u1', displayName: 'Maya', photoCount: 210 },
      mostCommentedDay: { dayDate: '2027-07-07', commentCount: 41 },
    };
    const view = render(<TripRecapCards recap={recap} topPhotoUrl="https://cdn.test/photo.jpg" spendTotal={1234.5} currency="USD" />);
    expect(view.getByText('12 days · 4 places · 612 km · 384 photos · 6 videos')).toBeTruthy();
    expect(view.getByLabelText('The group overlooking Florence')).toBeTruthy();
    expect(view.getByText('Traveler spotlight: Maya')).toBeTruthy();
    expect(view.getByText('Most-commented day: 2027-07-07 · 41 comments')).toBeTruthy();
    expect(view.getByTestId('trip-recap-spend')).toBeTruthy();
    expect(recap).not.toHaveProperty('spendTotal');
  });

  it('shows Phase 7 awards only behind the presentation flag', () => {
    const recap = { title: 'Italy', topPhoto: { assetId: 'a1', reactionTotal: 12 }, topPhotoContributor: { displayName: 'Maya', photoCount: 44 }, mostCommentedDay: { dayDate: '2027-07-07', commentCount: 8 } };
    const hidden = render(<TripRecapCards recap={recap} />);
    expect(hidden.queryByTestId('trip-awards')).toBeNull();
    const shown = render(<TripRecapCards recap={recap} showAwards />);
    expect(shown.getByText('📸 Shutterbug · Maya · 44 photos')).toBeTruthy();
  });
});
