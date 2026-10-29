/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('../utils/backendUrl', () => ({ resolveBackendUrl: () => 'https://api.test' }));

import PublicTripBlogPage from '../components/PublicTripBlogPage';
import BlogPublicPreview from '../components/BlogPublicPreview';

const DOC = {
  title: 'Iceland in May',
  subtitle: null,
  introduction: null,
  days: [{ localDate: '2026-05-14', headline: 'Reykjavik', summary: null, items: [{ id: 'i1', kindKey: 'core.text', body: '<p>We landed at last.</p>' }] }],
};

const installFetch = () => {
  const fn = jest.fn((_url: string, _options?: RequestInit) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(DOC) }));
  (global as any).fetch = fn;
  return fn;
};

describe('public blog preview', () => {
  afterEach(() => { jest.clearAllMocks(); });

  it('renders the public document from the signed-in trip endpoint, and never calls public engagement or maps', async () => {
    const fetchMock = installFetch();
    const { findByText } = render(<PublicTripBlogPage username="" tripSlug="" preview={{ tripId: 'trip 1', headers: { Authorization: 'Bearer t' } }} />);
    expect(await findByText('Iceland in May')).toBeTruthy();
    expect(await findByText('We landed at last.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/trips/trip%201/blog/preview', { cache: 'no-store', headers: { Authorization: 'Bearer t' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/public/blog/'))).toBe(true);
  });

  it('shows who can see the preview and closes on request', async () => {
    installFetch();
    const onClose = jest.fn();
    const { getByTestId, findByText } = render(<BlogPublicPreview visible tripId="t1" headers={{}} onClose={onClose} styles={{}} />);
    expect(getByTestId('blog-public-preview-banner').props.children).toMatch(/Only travelers on this trip/);
    await findByText('Iceland in May');
    fireEvent.press(getByTestId('blog-public-preview-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
