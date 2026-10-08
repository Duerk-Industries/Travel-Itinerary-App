/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PrivacyRequestsSection, dueLabel } from '../components/admin/PrivacyRequestsSection';
import { getAppTheme } from '../theme/theme';

const theme = getAppTheme('light' as any, 'light');
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const requests = [
  {
    id: 'r-due', requestType: 'access', jurisdiction: 'GDPR', channel: 'email', status: 'open',
    receivedAt: iso(-10), dueAt: iso(20), extended: false, subjectHash: null, notes: null, closedAt: null, overdue: false,
  },
  {
    id: 'r-late', requestType: 'erasure', jurisdiction: 'CCPA', channel: 'web', status: 'verifying',
    receivedAt: iso(-50), dueAt: iso(-5), extended: false, subjectHash: 'abcdef0123456789abcdef', notes: 'Identity check sent', closedAt: null, overdue: true,
  },
  {
    id: 'r-done', requestType: 'portability', jurisdiction: 'UK_GDPR', channel: 'email', status: 'completed',
    receivedAt: iso(-40), dueAt: iso(-10), extended: false, subjectHash: null, notes: null, closedAt: iso(-12), overdue: false,
  },
];

const jobs = [
  {
    id: 'job-1', scope: 'account', status: 'failed', attempts: 3, lastError: 'step failed', requestedBy: 'user',
    requestedAt: iso(-3), dueAt: iso(27), completedAt: null,
    steps: { trips: { status: 'done', affected: 2 }, push_tokens: { status: 'failed', error: 'timeout' }, sentry: { status: 'not_applicable' } },
  },
];

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/erasure-jobs')) return { ok: true, status: 200, json: async () => ({ jobs }) };
    if (init?.method === 'POST' || init?.method === 'PATCH') return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ requests, overdueCount: 1 }) };
  });
  (global as any).fetch = fetchMock;
});

const renderSection = () =>
  render(<PrivacyRequestsSection backendUrl="http://api.test" headers={{ Authorization: 'Bearer admin' }} theme={theme} />);
const writeCall = (method: string) => fetchMock.mock.calls.find(([, init]) => init?.method === method);

describe('dueLabel', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  it('counts days to or past the due date, and shows the close date once closed', () => {
    expect(dueLabel({ status: 'open', dueAt: '2026-10-13T12:00:00Z', closedAt: null }, now)).toBe('due in 5 days');
    expect(dueLabel({ status: 'open', dueAt: '2026-10-08T18:00:00Z', closedAt: null }, now)).toBe('due in 1 day');
    expect(dueLabel({ status: 'open', dueAt: '2026-10-05T12:00:00Z', closedAt: null }, now)).toBe('3 days overdue');
    expect(dueLabel({ status: 'completed', dueAt: '2026-10-05T12:00:00Z', closedAt: '2026-10-04T09:00:00Z' }, now)).toBe('closed 2026-10-04');
  });
});

describe('PrivacyRequestsSection', () => {
  it('lists active requests overdue-first with an overdue banner, hiding closed ones', async () => {
    const screen = renderSection();
    await waitFor(() => expect(screen.getByTestId('admin-privacy-request-r-late')).toBeTruthy());
    expect(screen.getByTestId('admin-privacy-overdue').props.children).toBe('1 request is past the statutory due date.');
    expect(screen.queryByTestId('admin-privacy-request-r-done')).toBeNull();
    const ids = screen.getAllByTestId(/^admin-privacy-request-r-/).map((n) => n.props.testID);
    expect(ids).toEqual(['admin-privacy-request-r-late', 'admin-privacy-request-r-due']);
    expect(screen.getByText(/Account subject abcdef012345…/)).toBeTruthy();
  });

  it('filters by status through the API', async () => {
    const screen = renderSection();
    await waitFor(() => expect(screen.getByTestId('admin-privacy-request-r-late')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-privacy-filter-completed'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/rights-requests?status=completed'))).toBe(true));
  });

  it('records a new request only with a reason, and never asks for the requester identity', async () => {
    const screen = renderSection();
    await waitFor(() => expect(screen.getByTestId('admin-privacy-request-r-due')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-privacy-new-toggle'));
    fireEvent.press(screen.getByTestId('admin-privacy-new-type-erasure'));
    fireEvent.press(screen.getByTestId('admin-privacy-new-jurisdiction-UK_GDPR'));
    fireEvent.changeText(screen.getByLabelText('Date received (YYYY-MM-DD)'), '2026-10-01');
    fireEvent.press(screen.getByTestId('admin-privacy-new-save'));
    expect(writeCall('POST')).toBeUndefined(); // no reason yet

    fireEvent.changeText(screen.getByLabelText('New request reason'), 'Email from support inbox');
    fireEvent.changeText(screen.getByLabelText('Account user ID (optional)'), ' user-42 ');
    fireEvent.press(screen.getByTestId('admin-privacy-new-save'));
    await waitFor(() => expect(writeCall('POST')).toBeTruthy());
    const [url, init] = writeCall('POST')!;
    expect(url).toBe('http://api.test/api/admin/privacy/rights-requests');
    expect(JSON.parse(String(init.body))).toEqual({
      requestType: 'erasure', jurisdiction: 'UK_GDPR', channel: 'email', receivedAt: '2026-10-01',
      reason: 'Email from support inbox', accountUserId: 'user-42',
    });
    expect(screen.queryByLabelText(/email address|name/i)).toBeNull();
  });

  it('updates status and applies the one-time extension with a reason', async () => {
    const screen = renderSection();
    await waitFor(() => expect(screen.getByTestId('admin-privacy-request-r-due')).toBeTruthy());
    fireEvent.press(screen.getByText(/access · GDPR · open/));
    fireEvent.press(screen.getByTestId('admin-privacy-status-r-due-in_progress'));
    fireEvent(screen.getByLabelText('Apply the statutory extension'), 'valueChange', true);
    fireEvent.changeText(screen.getByLabelText('Update reason'), 'Complex request; requester told');
    fireEvent.press(screen.getByTestId('admin-privacy-save-r-due'));
    await waitFor(() => expect(writeCall('PATCH')).toBeTruthy());
    const [url, init] = writeCall('PATCH')!;
    expect(url).toBe('http://api.test/api/admin/privacy/rights-requests/r-due');
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'Complex request; requester told', status: 'in_progress', extend: true });
  });

  it('shows erasure jobs with failed steps and no raw user IDs', async () => {
    const screen = renderSection();
    fireEvent.press(screen.getByTestId('admin-privacy-tab-erasure'));
    await waitFor(() => expect(screen.getByTestId('admin-erasure-job-job-1')).toBeTruthy());
    expect(screen.getByText('account erasure · failed')).toBeTruthy();
    expect(screen.getByText('2/3 steps done')).toBeTruthy();
    expect(screen.getByText('push_tokens: timeout')).toBeTruthy();
    fireEvent.press(screen.getByTestId('admin-erasure-filter-failed'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/erasure-jobs?status=failed'))).toBe(true));
  });
});

