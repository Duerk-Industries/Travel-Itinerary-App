/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('../utils/backendUrl', () => ({ resolveBackendUrl: () => 'https://api.test' }));
const mockSession: { token: string | null } = { token: null };
jest.mock('../utils/session', () => ({ loadSession: () => (mockSession.token ? { token: mockSession.token, name: 'Pat' } : null) }));

import PublicTripBlogPage from '../components/PublicTripBlogPage';

const DOC = {
  title: 'Iceland in May', subtitle: null, introduction: null,
  days: [{ localDate: '2026-05-14', headline: 'Reykjavik', summary: null, items: [{ id: 'i1', kindKey: 'core.text', body: '<p>We landed at last.</p>' }] }],
};
const ENGAGEMENT = { reactionsEnabled: false, days: [{ localDate: '2026-05-14', reactionCounts: {}, reactionTotal: 0, commentCount: 1 }] };
const DAY_COMMENTS = {
  localDate: '2026-05-14', reactionCounts: {}, reactionTotal: 0, commentCount: 1,
  comments: [{ id: 'c1', body: 'Looks amazing!', authorRole: 'follower', parentCommentId: null, replyCount: 0, createdAt: '2026-05-15T10:00:00.000Z', editedAt: null, deletedAt: null }],
};
const VIEWER = { signedIn: true, tripId: 'trip-1', days: [{ localDate: '2026-05-14', id: 'day-1' }] };

type Handler = (url: string, init?: RequestInit) => unknown | undefined;
const installFetch = (handlers: Handler[]) => {
  const fn = jest.fn((url: string, init?: RequestInit) => {
    for (const handler of handlers) {
      const body = handler(String(url), init);
      if (body !== undefined) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
  (global as any).fetch = fn;
  return fn;
};
const base: Handler[] = [
  (u) => (u.endsWith('/viewer') ? undefined : u.includes('/public/blog/') && !u.includes('/engagement') && !u.endsWith('/maps') ? DOC : undefined),
  (u) => (u.includes('/engagement') && u.includes('dayDate=') ? DAY_COMMENTS : u.includes('/engagement') ? ENGAGEMENT : undefined),
];

describe('PublicTripBlogPage comments from signed-in followers', () => {
  afterEach(() => { mockSession.token = null; delete (global as any).window; jest.clearAllMocks(); });

  it('shows no comment box, and asks for no viewer context, to a visitor who is not signed in', async () => {
    const fetchMock = installFetch(base);
    const screen = render(<PublicTripBlogPage username="ada" tripSlug="iceland" />);
    await waitFor(() => expect(screen.getByText(/1 comment/)).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText(/1 comment/)); });
    await waitFor(() => expect(screen.getByText('Looks amazing!')).toBeTruthy());
    expect(screen.queryByTestId('public-comment-composer-2026-05-14')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/viewer'))).toBe(false);
  });

  it('shows no comment box to a signed-in visitor who is not on this trip', async () => {
    mockSession.token = 'jwt';
    installFetch([(u) => (u.endsWith('/viewer') ? { signedIn: true, role: null } : undefined), ...base]);
    const screen = render(<PublicTripBlogPage username="ada" tripSlug="iceland" />);
    await waitFor(() => expect(screen.getByText(/1 comment/)).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText(/1 comment/)); });
    await waitFor(() => expect(screen.getByText('Looks amazing!')).toBeTruthy());
    expect(screen.queryByTestId('public-comment-composer-2026-05-14')).toBeNull();
    expect(screen.queryByText('Hide')).toBeNull();
  });

  it('lets a signed-in follower post a comment, then shows it', async () => {
    mockSession.token = 'jwt-follower';
    let posted = false;
    const fetchMock = installFetch([
      (u) => (u.endsWith('/viewer') ? { ...VIEWER, role: 'follower', canComment: true, canModerate: false } : undefined),
      (u, init) => (init?.method === 'POST' && u.endsWith('/api/trips/trip-1/blog/day/day-1/comments') ? ((posted = true), { id: 'c2', body: 'Enjoy!' }) : undefined),
      (u) => (u.includes('/engagement') && u.includes('dayDate=')
        ? { ...DAY_COMMENTS, commentCount: posted ? 2 : 1, comments: posted ? [...DAY_COMMENTS.comments, { ...DAY_COMMENTS.comments[0], id: 'c2', body: 'Enjoy!' }] : DAY_COMMENTS.comments }
        : undefined),
      ...base,
    ]);
    const screen = render(<PublicTripBlogPage username="ada" tripSlug="iceland" />);
    await waitFor(() => expect(screen.getByText(/1 comment/)).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText(/1 comment/)); });
    await waitFor(() => expect(screen.getByTestId('public-comment-composer-2026-05-14')).toBeTruthy());
    expect(screen.queryByText('Hide')).toBeNull(); // a follower cannot moderate

    fireEvent.changeText(screen.getByTestId('public-comment-input-2026-05-14'), '  Enjoy!  ');
    await act(async () => { fireEvent.press(screen.getByTestId('public-comment-post-2026-05-14')); });

    await waitFor(() => expect(screen.getByText('Enjoy!')).toBeTruthy());
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/blog/day/day-1/comments') && (init as RequestInit)?.method === 'POST')!;
    expect((post[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-follower', 'Idempotency-Key': expect.any(String) });
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ body: 'Enjoy!' });
    expect(screen.getByText(/2 comments/)).toBeTruthy();
  });

  it('shows a traveler a Hide button on comments, and removes a hidden comment', async () => {
    mockSession.token = 'jwt-traveler';
    const fetchMock = installFetch([
      (u) => (u.endsWith('/viewer') ? { ...VIEWER, role: 'traveler', canComment: true, canModerate: true } : undefined),
      (u, init) => (init?.method === 'POST' && u.endsWith('/api/trips/trip-1/blog/comments/c1/hide') ? { id: 'c1', hiddenAt: 'now' } : undefined),
      ...base,
    ]);
    const screen = render(<PublicTripBlogPage username="ada" tripSlug="iceland" />);
    await waitFor(() => expect(screen.getByText(/1 comment/)).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText(/1 comment/)); });
    await waitFor(() => expect(screen.getByTestId('public-comment-hide-c1')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('public-comment-hide-c1')); });
    await waitFor(() => expect(screen.queryByText('Looks amazing!')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/trips/trip-1/blog/comments/c1/hide', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps what was typed and says why when posting fails', async () => {
    mockSession.token = 'jwt-follower';
    (global as any).fetch = undefined;
    installFetch([
      (u) => (u.endsWith('/viewer') ? { ...VIEWER, role: 'follower', canComment: true, canModerate: false } : undefined),
      ...base,
    ]);
    const screen = render(<PublicTripBlogPage username="ada" tripSlug="iceland" />);
    await waitFor(() => expect(screen.getByText(/1 comment/)).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText(/1 comment/)); });
    await waitFor(() => expect(screen.getByTestId('public-comment-input-2026-05-14')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('public-comment-input-2026-05-14'), 'Hello');
    await act(async () => { fireEvent.press(screen.getByTestId('public-comment-post-2026-05-14')); });
    await waitFor(() => expect(screen.getByText('Your comment could not be posted.')).toBeTruthy());
    expect(screen.getByTestId('public-comment-input-2026-05-14').props.value).toBe('Hello'); // nothing lost
  });
});
