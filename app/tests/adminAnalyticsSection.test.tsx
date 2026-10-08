/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AnalyticsSection } from '../components/admin/AnalyticsSection';
import { getAppTheme } from '../theme/theme';

const theme = getAppTheme('light' as any, 'light');
const s = (value: number | null) => ({ value, suppressed: value === null });

const report = {
  meta: {
    metricVersion: 'v1', windowDays: 30, eventsScanned: 120, truncated: true, latestReceivedAt: '2026-10-08T12:00:00.000Z',
    minCohort: 10, notes: ['Consenting users only: accounts that never opted in are not represented.'],
    definitions: { population: 'Consenting active accounts …', reach: 'r', meaningfulAdoption: 'm', repeatUse: 'u', platformCohorts: 'p', tripPhase: 't', duringTripEngagement: 'd', taskFailureRate: 'f' },
  },
  adoption: {
    activeAccounts: s(40),
    features: [
      { feature: 'lodging', reachAccounts: s(20), reach: 0.5, adoptedAccounts: s(12), meaningfulAdoption: 0.3, repeatAccounts: s(10), repeatUse: 0.5 },
      { feature: 'blog', reachAccounts: s(null), reach: null, adoptedAccounts: s(0), meaningfulAdoption: 0, repeatAccounts: s(0), repeatUse: null },
    ],
    tasks: [],
  },
  platform: { activeAccounts: s(40), cohorts: { webOnly: s(20), nativeOnly: s(10), both: s(null) }, platforms: [{ platform: 'web', accounts: s(30), sessions: 80 }], appVersions: [] },
  tripPhase: { phases: [{ phase: 'during_trip', accounts: s(12), events: 50 }], travelerTripPairs: s(20), duringTripPairs: s(12), duringTripEngagement: 0.6, timezoneCoverage: { device: 1 } },
};

const fetchMock = jest.fn(async (url: string) => ({
  ok: true,
  status: 200,
  json: async () => (url.includes('/costs/ledger')
    ? { windowKey: '2026-10', totals: { estimatedMicros: 1_500_000, attempts: 3, unknownAttempts: 1 }, coverage: { attributionRatio: 0.5, pricingRatio: 0.66 }, directCostPerUser: { count: 2, medianMicros: 1, p95Micros: 2, maxMicros: 2 }, byProvider: [], reconciliation: [] }
    : report),
  text: async () => '# WanderBunnies analytics export: adoption\nfeature\n',
}));

beforeEach(() => {
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('Admin → Analytics', () => {
  it('shows suppressed counts as dashes, the population, and a truncation warning', async () => {
    const view = render(<AnalyticsSection backendUrl="http://api.test" headers={{ Authorization: 'Bearer admin' }} theme={theme} />);
    await waitFor(() => expect(view.getByTestId('admin-analytics-adoption')).toBeTruthy());
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/admin/analytics/report?days=30');
    expect(view.getByText('Consenting active accounts …')).toBeTruthy();
    expect(view.getByText(/Truncated/)).toBeTruthy();
    expect(view.getByText(/Consenting users only/)).toBeTruthy();
    expect(view.getAllByText('—').length).toBeGreaterThan(0); // blog reach suppressed
  });

  it('switches window and view, using fixed windows and the cost ledger', async () => {
    const view = render(<AnalyticsSection backendUrl="http://api.test" headers={{}} theme={theme} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.press(view.getByTestId('admin-analytics-window-7'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === 'http://api.test/api/admin/analytics/report?days=7')).toBe(true));
    fireEvent.press(view.getByTestId('admin-analytics-view-cost'));
    await waitFor(() => expect(view.getByTestId('admin-analytics-cost')).toBeTruthy());
    expect(fetchMock.mock.calls.some(([u]) => /\/api\/admin\/costs\/ledger\?month=\d{4}-\d{2}$/.test(u))).toBe(true);
    expect(view.getByText('$1.50')).toBeTruthy();
  });

  it('downloads the CSV for the current view and window', async () => {
    const view = render(<AnalyticsSection backendUrl="http://api.test" headers={{}} theme={theme} />);
    await waitFor(() => expect(view.getByTestId('admin-analytics-adoption')).toBeTruthy());
    fireEvent.press(view.getByTestId('admin-analytics-view-trip_phase'));
    fireEvent.press(view.getByTestId('admin-analytics-export'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === 'http://api.test/api/admin/analytics/export.csv?days=30&view=trip_phase')).toBe(true));
  });
});

describe('Admin → Analytics → Rollout', () => {
  it('requires a reason and saves the chosen mode for one purpose', async () => {
    const rollout = {
      product_analytics: { flagEnabled: true, mode: 'internal', percent: 0, excludeEurope: true },
      optional_diagnostics: { flagEnabled: false, mode: 'off', percent: 0, excludeEurope: true },
    };
    const calls: Array<[string, any]> = [];
    global.fetch = jest.fn(async (url: string, init?: any) => {
      calls.push([url, init]);
      return { ok: true, status: 200, json: async () => (url.endsWith('/analytics/rollout') ? rollout : report), text: async () => '' };
    }) as unknown as typeof fetch;

    const view = render(<AnalyticsSection backendUrl="http://api.test" headers={{ Authorization: 'Bearer admin' }} theme={theme} />);
    fireEvent.press(view.getByTestId('admin-analytics-view-rollout'));
    await waitFor(() => expect(view.getByTestId('admin-analytics-rollout')).toBeTruthy());
    expect(view.getByText(/diagnostics_user_linked_enabled: OFF/)).toBeTruthy();

    fireEvent.press(view.getByTestId('admin-rollout-product_analytics-percentage'));
    fireEvent.changeText(view.getByLabelText('Product analytics percentage'), '25');
    fireEvent.press(view.getByTestId('admin-rollout-product_analytics-save'));
    expect(calls.some(([u, init]) => init?.method === 'PUT')).toBe(false); // no reason yet

    fireEvent.changeText(view.getByLabelText('Product analytics reason'), 'Canary step 2');
    fireEvent.press(view.getByTestId('admin-rollout-product_analytics-save'));
    await waitFor(() => expect(calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const [url, init] = calls.find(([, i]) => i?.method === 'PUT')!;
    expect(url).toBe('http://api.test/api/admin/analytics/rollout/product_analytics');
    expect(JSON.parse(init.body)).toEqual({ mode: 'percentage', percent: 25, excludeEurope: true, reason: 'Canary step 2' });
  });
});
