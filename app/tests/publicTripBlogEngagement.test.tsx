/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('../utils/backendUrl', () => ({ resolveBackendUrl: () => 'https://api.test' }));

import PublicTripBlogPage from '../components/PublicTripBlogPage';

const DOC = {
  title: 'Iceland in May',
  subtitle: null,
  introduction: null,
  days: [
    {
      localDate: '2026-05-14',
      headline: 'Reykjavik',
      summary: null,
      items: [{ id: 'i1', kindKey: 'core.text', body: '<p>We landed at last.</p>' }],
    },
  ],
};

type Route = [test: (url: string) => boolean, payload: unknown, ok?: boolean, status?: number];

const installFetch = (routes: Route[]) => {
  const fn = jest.fn((url: string) => {
    for (const [test, payload, ok = true, status = 200] of routes) {
      if (test(String(url))) {
        return Promise.resolve({ ok, status, json: () => Promise.resolve(payload) });
      }
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
  (global as any).fetch = fn;
  return fn;
};

const isEngagementList = (u: string) => u.includes('/engagement') && !u.includes('dayDate=');
const isEngagementDay = (u: string) => u.includes('/engagement') && u.includes('dayDate=');
const isDocument = (u: string) => u.includes('/public/blog/') && !u.includes('/engagement');

describe('PublicTripBlogPage — public engagement', () => {
  afterEach(() => jest.clearAllMocks());

  it('shows per-day reaction chips and a comment count from the engagement summary', async () => {
    installFetch([
      [isDocument, DOC],
      [isEngagementList, { days: [{ localDate: '2026-05-14', reactionCounts: { heart: 3, fire: 1 }, reactionTotal: 4, commentCount: 2 }] }],
    ]);

    const screen = render(<PublicTripBlogPage username="ada" tripSlug="iceland" />);

    await waitFor(() => expect(screen.getByText('Reykjavik')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy());
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText(/2 comments/)).toBeTruthy();
  });

  it('renders the day normally when the engagement endpoint 404s (flag off)', async () => {
    installFetch([
      [isDocument, DOC],
      [isEngagementList, { error: 'not found' }, false, 404],
    ]);

    const screen = render(<PublicTripBlogPage username="ada" tripSlug="iceland" />);

    await waitFor(() => expect(screen.getByText('Reykjavik')).toBeTruthy());
    expect(screen.getByText('We landed at last.')).toBeTruthy();
    expect(screen.queryByText(/comment/)).toBeNull();
  });

  it('expands the day thread on tap, showing sanitized comments with a role label but no identity', async () => {
    installFetch([
      [isDocument, DOC],
      [isEngagementList, { days: [{ localDate: '2026-05-14', reactionCounts: {}, reactionTotal: 0, commentCount: 1 }] }],
      [isEngagementDay, {
        localDate: '2026-05-14',
        reactionCounts: {},
        reactionTotal: 0,
        commentCount: 1,
        comments: [{
          id: 'c1', body: 'Looks amazing!', authorRole: 'follower',
          parentCommentId: null, replyCount: 0,
          createdAt: '2026-05-15T10:00:00.000Z', editedAt: null, deletedAt: null,
        }],
      }],
    ]);

    const screen = render(<PublicTripBlogPage username="ada" tripSlug="iceland" />);
    await waitFor(() => expect(screen.getByText(/1 comment/)).toBeTruthy());

    await act(async () => { fireEvent.press(screen.getByText(/1 comment/)); });

    await waitFor(() => expect(screen.getByText('Looks amazing!')).toBeTruthy());
    expect(screen.getByText(/Follower ·/)).toBeTruthy();
  });
});
