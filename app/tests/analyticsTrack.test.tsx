/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { render } from '@testing-library/react-native';
import {
  __resetAnalyticsForTests,
  configureAnalytics,
  flushAnalytics,
  getAnalyticsQueueForTesting,
  track,
  useTrackView,
} from '../utils/analytics/track';
import { analyticsViewForPage } from '../utils/analytics/features';
import { ANALYTICS_LIMITS } from '../../packages/analytics/src/registry';

let clock = Date.parse('2026-10-08T12:00:00Z');
const fetcher = jest.fn(async (_url: string, _init: any) => ({ ok: true, status: 200 }));
const enable = (token = 'token-1') => configureAnalytics({ backendUrl: 'http://api.test', token, enabled: true });
const queuedNames = () => getAnalyticsQueueForTesting().map((e) => e.event_name);

beforeEach(() => {
  clock = Date.parse('2026-10-08T12:00:00Z');
  fetcher.mockClear();
  fetcher.mockImplementation(async () => ({ ok: true, status: 200 }));
  __resetAnalyticsForTests({ fetcher, now: () => clock });
});

describe('analytics tracker', () => {
  it('collects nothing before consent or after withdrawal, and purges on withdrawal', async () => {
    track('task_started', { task: 'add_item', feature: 'lodging' });
    expect(queuedNames()).toEqual([]);

    enable();
    track('task_started', { task: 'add_item', feature: 'lodging' });
    expect(queuedNames()).toEqual(['session_started', 'task_started']);

    configureAnalytics({ backendUrl: 'http://api.test', token: 'token-1', enabled: false });
    expect(queuedNames()).toEqual([]);
    track('task_started', { task: 'add_item', feature: 'lodging' });
    await flushAnalytics();
    expect(queuedNames()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('purges on sign-out or account switch', () => {
    enable('token-a');
    track('task_started', { task: 'import', feature: 'imports' });
    enable('token-b');
    expect(queuedNames()).toEqual([]);
  });

  it('builds registry-shaped events and only attaches trips to trip-scoped events', () => {
    enable();
    track('feature_viewed', { feature: 'itinerary', entry_point: 'nav' }, { tripId: 'trip-1' });
    const [session, view] = getAnalyticsQueueForTesting();
    expect(session).not.toHaveProperty('trip_id'); // session_started is not trip-scoped
    expect(view).toMatchObject({ event_name: 'feature_viewed', schema_version: 1, trip_id: 'trip-1', session_id: session.session_id });
    expect(['web', 'ios', 'android']).toContain(view.platform);
    expect(view.event_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(view.session_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(view).not.toHaveProperty('user_id');
  });

  it('never sends server-only events from the client', () => {
    enable();
    track('trip_created' as any, { via_wizard: true });
    expect(queuedNames()).toEqual([]);
  });

  it('sends a frozen batch, drops it on success, and resends the same IDs after a failure', async () => {
    enable();
    track('task_started', { task: 'invite', feature: 'collaboration' });
    fetcher.mockImplementationOnce(async () => ({ ok: false, status: 503 }));
    await flushAnalytics();
    const firstIds = JSON.parse(fetcher.mock.calls[0][1].body).events.map((e: any) => e.event_id);
    expect(queuedNames()).toHaveLength(2);

    await flushAnalytics(); // still backing off
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock += 10_000;
    await flushAnalytics();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).events.map((e: any) => e.event_id)).toEqual(firstIds);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer token-1');
    expect(queuedNames()).toEqual([]);
  });

  it('stops collecting when the server refuses consent (403), without retrying', async () => {
    enable();
    track('task_started', { task: 'invite', feature: 'collaboration' });
    fetcher.mockImplementationOnce(async () => ({ ok: false, status: 403 }));
    await flushAnalytics();
    expect(queuedNames()).toEqual([]);
    track('task_started', { task: 'invite', feature: 'collaboration' });
    expect(queuedNames()).toEqual([]);
  });

  it('flushes automatically at a full batch', () => {
    enable();
    for (let i = 0; i < ANALYTICS_LIMITS.maxBatchEvents; i += 1) track('task_started', { task: 'packing', feature: 'packing' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).events).toHaveLength(ANALYTICS_LIMITS.maxBatchEvents);
  });

  it('bounds the queue and drops events older than 24 hours', async () => {
    enable();
    fetcher.mockImplementation(async () => ({ ok: false, status: 503 })); // keep everything queued
    for (let i = 0; i < ANALYTICS_LIMITS.maxQueuedEvents + 30; i += 1) track('task_started', { task: 'packing', feature: 'packing' });
    expect(getAnalyticsQueueForTesting().length).toBeLessThanOrEqual(ANALYTICS_LIMITS.maxQueuedEvents);

    clock += ANALYTICS_LIMITS.maxEventAgeMs + 1;
    track('task_started', { task: 'packing', feature: 'packing' });
    expect(getAnalyticsQueueForTesting().every((e) => Date.parse(e.occurred_at) === clock)).toBe(true);
  });

  it('starts a new session after 30 minutes of inactivity', () => {
    enable();
    track('task_started', { task: 'import', feature: 'imports' });
    const firstSession = getAnalyticsQueueForTesting()[0].session_id;
    clock += ANALYTICS_LIMITS.sessionIdleMs + 1;
    track('task_started', { task: 'import', feature: 'imports' });
    const events = getAnalyticsQueueForTesting();
    const resumed = events.filter((e) => e.event_name === 'session_started');
    expect(resumed.map((e) => e.properties.resumed)).toEqual([false, true]);
    expect(events[events.length - 1].session_id).not.toBe(firstSession);
  });
});

describe('useTrackView', () => {
  const View = ({ feature, tripId }: { feature: any; tripId: string | null }) => {
    useTrackView(feature, tripId);
    return null;
  };

  it('records one view per feature and trip per session, even when re-rendered', () => {
    enable();
    const view = render(<React.StrictMode><View feature="lodging" tripId="trip-1" /></React.StrictMode>);
    view.rerender(<React.StrictMode><View feature="lodging" tripId="trip-1" /></React.StrictMode>);
    view.rerender(<React.StrictMode><View feature="activities" tripId="trip-1" /></React.StrictMode>);
    view.rerender(<React.StrictMode><View feature="lodging" tripId="trip-1" /></React.StrictMode>);
    expect(getAnalyticsQueueForTesting().filter((e) => e.event_name === 'feature_viewed').map((e) => e.properties.feature)).toEqual(['lodging', 'activities']);
  });

  it('records nothing without consent', () => {
    render(<View feature="lodging" tripId="trip-1" />);
    expect(getAnalyticsQueueForTesting()).toEqual([]);
  });
});

describe('analyticsViewForPage', () => {
  it('maps pages to stable features, never tracks admin, and only scopes trip pages', () => {
    expect(analyticsViewForPage('flights', 'trip-1')).toEqual({ feature: 'transfers', tripId: 'trip-1' });
    expect(analyticsViewForPage('tours', 'trip-1')).toEqual({ feature: 'activities', tripId: 'trip-1' });
    expect(analyticsViewForPage('trips', 'trip-1')).toEqual({ feature: 'trips', tripId: null });
    expect(analyticsViewForPage('admin', 'trip-1')).toEqual({ feature: null, tripId: null });
    expect(analyticsViewForPage('account-privacy', 'trip-1')).toEqual({ feature: 'account', tripId: null });
  });
});
