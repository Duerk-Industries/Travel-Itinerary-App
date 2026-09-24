/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import DayMediaLightbox from '../components/DayMediaLightbox';

const ITEMS = [
  { id: 'photo-1', assetId: 'a1', kindKey: 'media.photo', thumbnailUrl: 'https://example.com/1.jpg', primaryUrl: 'https://example.com/1.jpg' },
  { id: 'photo-2', assetId: 'a2', kindKey: 'media.photo', thumbnailUrl: 'https://example.com/2.jpg', primaryUrl: 'https://example.com/2.jpg' },
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

  it('shows a remove control on every grid tile when canRemove, and calls onRemove with the item', () => {
    const onRemove = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <DayMediaLightbox visible items={ITEMS} onClose={() => {}} dayDate="2026-08-03" styles={{}} canRemove onRemove={onRemove} />
    );
    // Both tiles — including the second one that the 4-tile gallery never shows — get an ✕.
    expect(getByTestId('day-media-lightbox-remove-photo-1')).toBeTruthy();
    fireEvent.press(getByTestId('day-media-lightbox-remove-photo-2'));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'photo-2' }));

    const { queryByTestId: q2 } = render(
      <DayMediaLightbox visible items={ITEMS} onClose={() => {}} dayDate="2026-08-03" styles={{}} />
    );
    expect(q2('day-media-lightbox-remove-photo-1')).toBeNull(); // no canRemove -> no control
  });
});
