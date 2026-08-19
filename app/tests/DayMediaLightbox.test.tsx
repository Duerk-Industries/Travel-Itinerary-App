/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render } from '@testing-library/react-native';
import DayMediaLightbox from '../components/DayMediaLightbox';

const ITEMS = [
  { id: 'photo-1', kindKey: 'media.photo', thumbnailUrl: 'https://example.com/1.jpg', primaryUrl: 'https://example.com/1.jpg' },
];

describe('DayMediaLightbox', () => {
  it('uses the active theme text color for the Close button', () => {
    const { getByText } = render(
      <DayMediaLightbox
        visible
        items={ITEMS}
        onClose={() => {}}
        dayDate="2026-08-03"
        styles={{}}
        textColor="#f5f5f5" // simulates a dark-mode theme's light text color
        mutedColor="#ccc"
        backgroundColor="#0b1420"
      />
    );

    const closeLabel = getByText('Close');
    const flattenedColor = [closeLabel.props.style].flat().find((s: any) => s?.color)?.color;
    expect(flattenedColor).toBe('#f5f5f5');
  });
});
