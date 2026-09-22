/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const uploadBlogFiles = jest.fn();
jest.mock('../utils/blogUpload', () => ({ uploadBlogFiles: (...args: any[]) => uploadBlogFiles(...args) }));

import PhotoFirstComposer from '../components/PhotoFirstComposer';

const styles = { button: {}, buttonText: {} } as any;
const DAYS = ['2026-09-01', '2026-09-02'];
const context = { backendUrl: 'https://api.test', headers: {}, tripId: 'trip-1' };

const file = (name: string, capturedAt?: string, previewUri?: string) => ({ blob: new Blob(['x']), mimeType: 'image/jpeg', size: 2 * 1024 * 1024, name, capturedAt, previewUri });

const mockFetch = (group: any, storage: any = { availableBytes: 999 * 1024 * 1024, entitlementActive: true }) => {
  (global as any).fetch = jest.fn((url: string) => {
    if (String(url).includes('/blog/media/group')) return Promise.resolve({ ok: true, json: () => Promise.resolve(group) });
    if (String(url).includes('/blog-storage')) return Promise.resolve({ ok: true, json: () => Promise.resolve(storage) });
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
};

const baseProps = {
  visible: true, context, dayDates: DAYS, styles,
  onClose: jest.fn(), onCommitted: jest.fn(), testID: 'pc',
};

describe('PhotoFirstComposer', () => {
  beforeEach(() => { uploadBlogFiles.mockReset(); uploadBlogFiles.mockResolvedValue({ succeeded: 1, failed: 0, entitlementSkipped: 0, quotaBlocked: false, assets: [], errors: [] }); });

  it('shows server day buckets and flags photos with no capture date', async () => {
    mockFetch({ buckets: [{ dayDate: '2026-09-01', clientIds: ['f0'] }], unassigned: ['f1'], outOfRange: [] });
    const screen = render(<PhotoFirstComposer {...baseProps} files={[file('a.jpg', '2026-09-01T10:00:00'), file('b.jpg')]} />);

    await waitFor(() => expect(screen.getByTestId('pc-day-2026-09-01-count')).toBeTruthy());
    expect(screen.getByTestId('pc-day-2026-09-01-count').props.children).toMatch(/1 photo/);
    expect(screen.getByTestId('pc-unplaced-count')).toBeTruthy();
    // commit is blocked while b.jpg has no day
    expect(screen.getByTestId('pc-commit').props.disabled).toBe(true);
  });

  it('lets the user place an unassigned photo, then commits one batch per day', async () => {
    mockFetch({ buckets: [{ dayDate: '2026-09-01', clientIds: ['f0'] }], unassigned: ['f1'], outOfRange: [] });
    const onCommitted = jest.fn();
    const screen = render(<PhotoFirstComposer {...baseProps} onCommitted={onCommitted} files={[file('a.jpg', '2026-09-01T10:00:00'), file('b.jpg')]} />);

    await waitFor(() => expect(screen.getByTestId('pc-file-f1')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('pc-file-f1-day-2026-09-02')); });

    const commit = screen.getByTestId('pc-commit');
    await waitFor(() => expect(commit.props.disabled).toBe(false));
    await act(async () => { fireEvent.press(commit); });

    await waitFor(() => expect(onCommitted).toHaveBeenCalled());
    expect(uploadBlogFiles).toHaveBeenCalledTimes(2);
    const daysUploaded = uploadBlogFiles.mock.calls.map((c) => c[1]).sort();
    expect(daysUploaded).toEqual(['2026-09-01', '2026-09-02']);
    expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({ succeeded: 2, quotaBlocked: false }));
  });

  it('blocks commit when the batch exceeds available storage', async () => {
    mockFetch(
      { buckets: [{ dayDate: '2026-09-01', clientIds: ['f0'] }], unassigned: [], outOfRange: [] },
      { availableBytes: 1024, entitlementActive: true }
    );
    const screen = render(<PhotoFirstComposer {...baseProps} files={[file('big.jpg', '2026-09-01T10:00:00')]} />);
    await waitFor(() => expect(screen.getByTestId('pc-headroom')).toBeTruthy());
    expect(screen.getByText(/only .* is free/)).toBeTruthy();
    expect(screen.getByTestId('pc-commit').props.disabled).toBe(true);
  });

  it('requires an explicit day for an out-of-range photo', async () => {
    mockFetch({ buckets: [], unassigned: [], outOfRange: [{ clientId: 'f0', capturedAt: '2025-01-01T09:00:00' }] });
    const screen = render(<PhotoFirstComposer {...baseProps} files={[file('old.jpg', '2025-01-01T09:00:00')]} />);
    await waitFor(() => expect(screen.getByText(/outside this trip's dates/)).toBeTruthy());
    expect(screen.getByTestId('pc-commit').props.disabled).toBe(true);
    await act(async () => { fireEvent.press(screen.getByTestId('pc-file-f0-day-2026-09-01')); });
    await waitFor(() => expect(screen.getByTestId('pc-commit').props.disabled).toBe(false));
  });

  it('renders a thumbnail from previewUri', async () => {
    mockFetch({ buckets: [{ dayDate: '2026-09-01', clientIds: ['f0'] }], unassigned: [], outOfRange: [] });
    const screen = render(<PhotoFirstComposer {...baseProps} files={[file('a.jpg', '2026-09-01T10:00:00', 'blob:preview-1')]} />);
    await waitFor(() => expect(screen.getByTestId('pc-file-f0')).toBeTruthy());
    const images = screen.UNSAFE_getAllByType(require('react-native').Image);
    expect(images.some((img: any) => img.props.source?.uri === 'blob:preview-1')).toBe(true);
  });

  it('on an upload failure, stays open and shows the underlying error instead of just closing', async () => {
    mockFetch({ buckets: [{ dayDate: '2026-09-01', clientIds: ['f0'] }], unassigned: [], outOfRange: [] });
    uploadBlogFiles.mockResolvedValue({
      succeeded: 0, failed: 1, entitlementSkipped: 0, quotaBlocked: false, assets: [],
      errors: ['Storage rejected the photo (HTTP 403). The upload bucket may not allow this site — check its CORS config.'],
    });
    const onCommitted = jest.fn();
    const screen = render(<PhotoFirstComposer {...baseProps} onCommitted={onCommitted} files={[file('a.jpg', '2026-09-01T10:00:00')]} />);

    await waitFor(() => expect(screen.getByTestId('pc-commit').props.disabled).toBe(false));
    await act(async () => { fireEvent.press(screen.getByTestId('pc-commit')); });

    await waitFor(() => expect(screen.getByTestId('pc-error')).toBeTruthy());
    expect(screen.getByText(/CORS config/)).toBeTruthy();
    expect(onCommitted).not.toHaveBeenCalled(); // nothing succeeded -> no parent reload
    expect(screen.getByTestId('pc-commit').props.disabled).toBe(false); // can retry
  });

  it('offers every trip day from the grouping response, not just the dayDates prop', async () => {
    // The blog tab has only paged in 2026-09-01/02, but the trip also has 2026-09-05.
    mockFetch({
      buckets: [], unassigned: ['f0'], outOfRange: [],
      dayDates: ['2026-09-01', '2026-09-02', '2026-09-05'],
    });
    const onCommitted = jest.fn();
    const screen = render(<PhotoFirstComposer {...baseProps} onCommitted={onCommitted} files={[file('a.jpg')]} />);

    await waitFor(() => expect(screen.getByTestId('pc-file-f0')).toBeTruthy());
    // A chip for the un-paged day exists.
    await act(async () => { fireEvent.press(screen.getByTestId('pc-file-f0-day-2026-09-05')); });
    await waitFor(() => expect(screen.getByTestId('pc-commit').props.disabled).toBe(false));

    await act(async () => { fireEvent.press(screen.getByTestId('pc-commit')); });
    await waitFor(() => expect(onCommitted).toHaveBeenCalled());
    expect(uploadBlogFiles.mock.calls[0][1]).toBe('2026-09-05');
  });

  it('with defaultDayDate, an undated photo is pre-placed there and does not block commit', async () => {
    mockFetch({ buckets: [], unassigned: ['f0'], outOfRange: [] });
    const screen = render(<PhotoFirstComposer {...baseProps} defaultDayDate="2026-09-02" files={[file('b.jpg')]} />);
    await waitFor(() => expect(screen.getByTestId('pc-day-2026-09-02-count')).toBeTruthy());
    expect(screen.queryByTestId('pc-unplaced-count')).toBeNull();
    expect(screen.getByTestId('pc-commit').props.disabled).toBe(false);
  });
});
