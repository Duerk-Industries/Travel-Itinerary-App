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

type Route = [test: (url: string, options?: RequestInit) => boolean, payload: unknown, ok?: boolean, status?: number];

const installFetch = (routes: Route[]) => {
  const fn = jest.fn((url: string, options?: RequestInit) => {
    for (const [test, payload, ok = true, status = 200] of routes) {
      if (test(String(url), options)) {
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
  afterEach(() => { jest.clearAllMocks(); delete (global as any).window; });

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

  it('lets a public reader add and remove a reaction and keeps the selected state for a return visit', async () => {
    const stored = new Map<string, string>();
    (global as any).window = {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => { stored.set(key, value); },
        removeItem: (key: string) => { stored.delete(key); },
      },
      crypto: { getRandomValues: (bytes: Uint8Array) => { bytes.fill(7); return bytes; } },
    };
    const mutation = (url: string) => url.includes('/engagement/day/2026-05-14/reaction');
    const fetchMock = installFetch([
      [(url, options) => mutation(url) && options?.method === 'DELETE', { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null }],
      [mutation, { reactionCounts: { heart: 1 }, reactionTotal: 1, commentCount: 0, userReaction: 'heart' }],
      [isDocument, DOC],
      [isEngagementList, { days: [{ localDate: '2026-05-14', reactionCounts: {}, reactionTotal: 0, commentCount: 0 }] }],
    ]);
    const screen = render(<PublicTripBlogPage username="ada" tripSlug="iceland" />);
    await waitFor(() => expect(screen.getByLabelText('React with heart')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByLabelText('React with heart')); });
    await waitFor(() => expect(screen.getByLabelText('Remove heart')).toBeTruthy());
    expect(screen.getByText('1')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/engagement/day/2026-05-14/reaction'), expect.objectContaining({ method: 'PUT' }));
    expect(stored.get('wanderbunnies:public-reaction:ada:iceland:selected')).toContain('heart');
    await act(async () => { fireEvent.press(screen.getByLabelText('Remove heart')); });
    await waitFor(() => expect(screen.getByLabelText('React with heart')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/engagement/day/2026-05-14/reaction'), expect.objectContaining({ method: 'DELETE' }));
    expect(stored.has('wanderbunnies:public-reaction:ada:iceland:id')).toBe(false);
  });
});
