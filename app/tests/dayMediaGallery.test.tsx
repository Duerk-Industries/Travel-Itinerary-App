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

describe('DayMediaGallery — photo mosaic', () => {
  it('renders every item (up to 4) as its own tile, each opening the lightbox', () => {
    const items = makeItems();
    const onOpenLightbox = jest.fn();
    const { getByTestId } = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" canSetCover={false} onSetCover={() => {}} onOpenLightbox={onOpenLightbox} styles={styles} />
    );
    items.forEach((item) => expect(getByTestId(`day-media-grid-tile-${item.id}`)).toBeTruthy());
    fireEvent.press(getByTestId('day-media-grid-tile-item-2'));
    expect(onOpenLightbox).toHaveBeenCalled();
  });

  it('shows only captions that exist, each attributed to its own tile', () => {
    const items = makeItems();
    const { getByTestId, queryByTestId } = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" canSetCover={false} onSetCover={() => {}} onOpenLightbox={() => {}} styles={styles} />
    );
    expect(getByTestId('day-media-caption-item-1').props.children).toBe('First caption');
    expect(queryByTestId('day-media-caption-item-2')).toBeNull();
    expect(getByTestId('day-media-caption-item-3').props.children).toBe('Third caption');
  });

  it('shows a "+N" overflow badge on the fourth tile once there are more than four items', () => {
    const items = [...makeItems(), { id: 'item-4', assetId: 'asset-4', kindKey: 'media.photo', primaryUrl: 'https://example.com/4.jpg' }, { id: 'item-5', assetId: 'asset-5', kindKey: 'media.photo', primaryUrl: 'https://example.com/5.jpg' }];
    const { getByTestId, queryByTestId } = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" canSetCover={false} onSetCover={() => {}} onOpenLightbox={() => {}} styles={styles} />
    );
    // Only the first four render as tiles — the rest are reachable through the lightbox, not a fifth tile.
    expect(queryByTestId('day-media-grid-tile-item-5')).toBeNull();
    expect(getByTestId('day-media-overflow-count').props.children.join('')).toBe('+1');
  });

  it('only offers "Set as day default" in edit mode, and hides it on the tile that is already the cover', () => {
    const items = makeItems();
    const readOnlyRender = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" canSetCover={false} onSetCover={() => {}} onOpenLightbox={() => {}} styles={styles} />
    );
    expect(readOnlyRender.queryByTestId('day-media-set-cover-item-2')).toBeNull();

    const editRender = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" canSetCover onSetCover={() => {}} onOpenLightbox={() => {}} styles={styles} />
    );
    // item-1 is the cover — its own set-cover control is hidden; item-2's is not.
    expect(editRender.queryByTestId('day-media-set-cover-item-1')).toBeNull();
    expect(editRender.getByTestId('day-media-set-cover-item-2')).toBeTruthy();
  });

  it('calls onSetCover with the pressed tile\'s own item', () => {
    const items = makeItems();
    const onSetCover = jest.fn();
    const { getByTestId } = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" canSetCover onSetCover={onSetCover} onOpenLightbox={() => {}} styles={styles} />
    );
    fireEvent.press(getByTestId('day-media-set-cover-item-3'));
    expect(onSetCover).toHaveBeenCalledWith(items[2]);
  });

  it('marks the proposed most-loved photo on its own tile, leaving confirmation to the traveler', () => {
    const items = makeItems();
    const onSetCover = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" proposedCoverAssetId="asset-3" canSetCover onSetCover={onSetCover} onOpenLightbox={() => {}} styles={styles} />
    );
    expect(getByTestId('day-media-cover-proposal-item-3')).toBeTruthy();
    expect(queryByTestId('day-media-cover-proposal-item-1')).toBeNull();
    expect(onSetCover).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('day-media-set-cover-item-3'));
    expect(onSetCover).toHaveBeenCalledWith(items[2]);
  });

  it('removes a specific tile\'s item without disturbing the others', () => {
    const items = makeItems();
    const onRemove = jest.fn();
    const { getByTestId } = render(
      <DayMediaGallery items={items} dayDate="2026-09-10" coverItemId="item-1" canRemove onRemove={onRemove} onOpenLightbox={() => {}} styles={styles} />
    );
    fireEvent.press(getByTestId('day-media-remove-item-2'));
    expect(onRemove).toHaveBeenCalledWith(items[1]);
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
