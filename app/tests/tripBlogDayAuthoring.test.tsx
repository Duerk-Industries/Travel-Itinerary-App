/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

// Deliberately real timers throughout, not jest.useFakeTimers(): this suite exercises the
// autosave debounce (app/utils/useAutosave.ts, unit-tested with fake timers in
// tests/useAutosave.test.ts) *through* React Testing Library's async `findBy*`/`waitFor`, which
// poll on real timers internally — mixing fake timers with that polling is a known-unreliable
// combination. The 1.5s debounce means these tests are a little slow rather than flaky.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TripBlogTab from '../tabs/tripBlog';

const styles: Record<string, any> = {
  card: {},
  sectionTitle: {},
  button: {},
  buttonText: {},
};

const backendUrl = 'https://wanderbunnies.test';
const headers = { Authorization: 'Bearer test-token' };
const tripId = 'trip-1';

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

const baseDay = {
  id: 'day-1', tripId, localDate: '2026-09-10', headline: null, summary: null,
  coverItemId: null, coverIsExplicit: false, updateVersion: 1, items: [], activities: [],
};

const blogBody = (day: typeof baseDay) => ({
  id: 'blog-1', tripId, title: 'Our Trip', subtitle: null, introduction: null, contentRevision: 1,
  visibilityState: 'private', visibilityEpoch: 0, publicPath: null,
  days: [day],
});

describe('TripBlogTab — headline/summary and masthead autosave (Phase 1: A3/A4/A5)', () => {
  const renderTab = () => render(
    <TripBlogTab backendUrl={backendUrl} headers={headers} activeTripId={tripId} styles={styles} theme={{ colors: {} }} readOnly={false} />
  );

  const enterEditMode = async (findByText: any) => {
    const button = await findByText('Edit blog');
    await act(async () => { fireEvent.press(button); });
  };

  it('autosaves a day headline 1.5s after the last keystroke, PATCHing the correct payload', async () => {
    let currentDay = { ...baseDay };
    let patchBody: any = null;
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody(currentDay));
      if (method === 'PATCH' && url.endsWith('/blog/days/2026-09-10')) {
        patchBody = JSON.parse(String(init?.body));
        currentDay = { ...currentDay, headline: patchBody.headline, updateVersion: currentDay.updateVersion + 1 };
        return jsonResponse({ ...currentDay });
      }
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    const { findByText, findByTestId } = renderTab();
    await enterEditMode(findByText);
    const headlineInput = await findByTestId('blog-day-headline-input-2026-09-10');

    fireEvent.changeText(headlineInput, 'Lost in Trastevere');
    // Not yet — the debounce hasn't elapsed.
    expect(patchBody).toBeNull();

    await waitFor(() => expect(patchBody).not.toBeNull(), { timeout: 3000 });
    expect(patchBody).toMatchObject({ headline: 'Lost in Trastevere', updateVersion: 1 });
  }, 10000);

  it('shows a conflict banner on 409 with Keep mine / Use theirs, and Keep mine retries against the latest version', async () => {
    let currentDay = { ...baseDay };
    let patchCallCount = 0;
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody(currentDay));
      if (method === 'PATCH' && url.endsWith('/blog/days/2026-09-10')) {
        patchCallCount += 1;
        const body = JSON.parse(String(init?.body));
        if (patchCallCount === 1) {
          // Simulate someone else having already bumped the version to 2.
          return jsonResponse({ error: 'conflict', code: 'VERSION_CONFLICT', latest: { headline: 'Someone else wrote this', summary: null, updateVersion: 2 } }, 409);
        }
        // Second attempt (Keep mine) retries with updateVersion: 2 and should now succeed.
        currentDay = { ...currentDay, headline: body.headline, updateVersion: 3 };
        return jsonResponse({ ...currentDay });
      }
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    const { findByText, findByTestId, queryByTestId } = renderTab();
    await enterEditMode(findByText);
    const headlineInput = await findByTestId('blog-day-headline-input-2026-09-10');

    fireEvent.changeText(headlineInput, 'My version');
    const banner = await findByTestId('blog-day-meta-conflict-2026-09-10', {}, { timeout: 3000 });
    expect(banner).toBeTruthy();

    const keepMine = await findByTestId('blog-day-meta-conflict-2026-09-10-keep-mine');
    await act(async () => { fireEvent.press(keepMine); });

    await waitFor(() => expect(patchCallCount).toBe(2), { timeout: 3000 });
    // Conflict banner clears once the retry succeeds.
    await waitFor(() => expect(queryByTestId('blog-day-meta-conflict-2026-09-10')).toBeNull());
  }, 10000);

  it('"Use theirs" adopts the server headline/summary without issuing a write', async () => {
    let currentDay = { ...baseDay };
    let patchCallCount = 0;
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody(currentDay));
      if (method === 'PATCH' && url.endsWith('/blog/days/2026-09-10')) {
        patchCallCount += 1;
        return jsonResponse({ error: 'conflict', code: 'VERSION_CONFLICT', latest: { headline: 'Their headline', summary: 'Their summary', updateVersion: 5 } }, 409);
      }
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    const { findByText, findByTestId } = renderTab();
    await enterEditMode(findByText);
    const headlineInput = await findByTestId('blog-day-headline-input-2026-09-10');

    fireEvent.changeText(headlineInput, 'My version');
    const useTheirs = await findByTestId('blog-day-meta-conflict-2026-09-10-use-theirs', {}, { timeout: 3000 });
    const callsBeforeResolve = patchCallCount;
    await act(async () => { fireEvent.press(useTheirs); });

    expect((headlineInput.props as any).value).toBe('Their headline');
    // "Use theirs" performs no write of its own.
    expect(patchCallCount).toBe(callsBeforeResolve);
  }, 10000);

  it('autosaves the blog masthead title', async () => {
    let patchBody: any = null;
    (global as any).fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/blog/publication/status')) return jsonResponse({}, 404);
      if (method === 'GET' && url.includes(`/api/trips/${tripId}/blog?`)) return jsonResponse(blogBody({ ...baseDay }));
      if (method === 'PATCH' && url.endsWith(`/api/trips/${tripId}/blog`)) {
        patchBody = JSON.parse(String(init?.body));
        return jsonResponse({ id: 'blog-1', tripId, title: patchBody.title ?? 'Our Trip', subtitle: null, introduction: null, contentRevision: 2, visibilityState: 'private', visibilityEpoch: 0, days: [] });
      }
      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    const { findByText, findByTestId } = renderTab();
    await enterEditMode(findByText);
    const titleInput = await findByTestId('blog-masthead-title-input');

    fireEvent.changeText(titleInput, 'Italy 2026');
    await waitFor(() => expect(patchBody).not.toBeNull(), { timeout: 3000 });
    expect(patchBody.title).toBe('Italy 2026');
  }, 10000);
});
