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
  it('renders the Close button with a dark, fixed text color regardless of the (dark-mode) themed textColor prop', () => {
    // Reproduces the reported bug: the Close button's background is a fixed light gray
    // (styles.buttonSecondary is never actually defined, so it always falls back to '#e5e7eb'),
    // but the button previously used the ambient theme's text color — near-white in dark mode —
    // making the label invisible against the light background.
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
    expect(flattenedColor).toBe('#111827');
    expect(flattenedColor).not.toBe('#f5f5f5');
  });
});
