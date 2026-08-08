/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import DayMediaGallery from '../components/DayMediaGallery';
import DayMediaLightbox from '../components/DayMediaLightbox';

const styles = { button: {}, buttonText: {} };

const makeItems = () => [
  { id: 'item-1', assetId: 'asset-1', kindKey: 'media.photo', primaryUrl: 'https://example.com/1.jpg', thumbnailUrl: 'https://example.com/1-thumb.jpg', caption: 'First caption' },
  { id: 'item-2', assetId: 'asset-2', kindKey: 'media.photo', primaryUrl: 'https://example.com/2.jpg', thumbnailUrl: 'https://example.com/2-thumb.jpg', caption: null },
  { id: 'item-3', assetId: 'asset-3', kindKey: 'media.video', primaryUrl: 'https://example.com/3.mp4', thumbnailUrl: null, caption: 'Third caption' },
];

describe('DayMediaGallery', () => {
  it('shows only the active item\'s caption, never another item\'s', () => {
    const items = makeItems();
    const { getByTestId, queryByTestId } = render(
      <DayMediaGallery
        items={items}
        dayDate="2026-09-10"
        coverItemId="item-1"
        canSetCover={false}
        onSetCover={() => {}}
        onOpenLightbox={() => {}}
        styles={styles}
      />
    );
    expect(getByTestId('day-media-caption').props.children).toBe('First caption');
    fireEvent.press(getByTestId('day-media-next'));
    // item-2 has no caption — nothing should render.
    expect(queryByTestId('day-media-caption')).toBeNull();
    fireEvent.press(getByTestId('day-media-next'));
    expect(getByTestId('day-media-caption').props.children).toBe('Third caption');
  });

  it('cycles prev/next with wraparound', () => {
    const items = makeItems();
    const { getByTestId } = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" canSetCover={false} onSetCover={() => {}} onOpenLightbox={() => {}} styles={styles} />
    );
    // Wrap backward from the first item to the last.
    fireEvent.press(getByTestId('day-media-prev'));
    expect(getByTestId('day-media-caption').props.children).toBe('Third caption');
    // Wrap forward from the last item back to the first.
    fireEvent.press(getByTestId('day-media-next'));
    expect(getByTestId('day-media-caption').props.children).toBe('First caption');
  });

  it('only offers "Set as day default" when canSetCover is true, and hides it for the current cover', () => {
    const items = makeItems();
    const readOnlyRender = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" canSetCover={false} onSetCover={() => {}} onOpenLightbox={() => {}} styles={styles} />
    );
    expect(readOnlyRender.queryByTestId('day-media-set-cover')).toBeNull();

    const travelerRender = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-2" canSetCover onSetCover={() => {}} onOpenLightbox={() => {}} styles={styles} />
    );
    // The view opens on the cover (item-2), where the button is correctly hidden...
    expect(travelerRender.queryByTestId('day-media-set-cover')).toBeNull();
    // ...but navigating to a different (non-cover) item reveals it.
    fireEvent.press(travelerRender.getByTestId('day-media-next'));
    expect(travelerRender.getByTestId('day-media-set-cover')).toBeTruthy();
  });

  it('calls onSetCover with the active item when pressed', () => {
    const items = makeItems();
    const onSetCover = jest.fn();
    const { getByTestId } = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-2" canSetCover onSetCover={onSetCover} onOpenLightbox={() => {}} styles={styles} />
    );
    fireEvent.press(getByTestId('day-media-next')); // move off the cover (item-2) onto item-3
    fireEvent.press(getByTestId('day-media-set-cover'));
    expect(onSetCover).toHaveBeenCalledWith(items[2]);
  });

  it('opens the lightbox when the default view is tapped', () => {
    const items = makeItems();
    const onOpenLightbox = jest.fn();
    const { getByTestId } = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" canSetCover={false} onSetCover={() => {}} onOpenLightbox={onOpenLightbox} styles={styles} />
    );
    fireEvent.press(getByTestId('day-media-open-lightbox'));
    expect(onOpenLightbox).toHaveBeenCalled();
  });
});

describe('DayMediaLightbox', () => {
  it('renders every item as a tile, and tapping a video tile switches to inline playback', () => {
    const items = makeItems();
    const { getByTestId, queryByTestId } = render(
      <DayMediaLightbox visible items={items} dayDate="2026-09-10" onClose={() => {}} styles={styles} />
    );
    items.forEach((item) => expect(getByTestId(`day-media-tile-${item.id}`)).toBeTruthy());
    fireEvent.press(getByTestId('day-media-tile-item-3'));
    // The grid is replaced by the enlarged/playing view — tiles should no longer be present.
    expect(queryByTestId('day-media-tile-item-3')).toBeNull();
  });
});
