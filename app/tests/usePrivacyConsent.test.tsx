/** @jest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react-native';
import { usePrivacyConsent } from '../hooks/usePrivacyConsent';
import { closeSentry, initSentry } from '../utils/sentry';

jest.mock('../utils/sentry', () => ({
  initSentry: jest.fn(),
  closeSentry: jest.fn(async () => undefined),
}));

const response = (pseudonym: string | null) => ({
  ok: true,
  json: async () => ({
    productAnalytics: false, optionalDiagnostics: Boolean(pseudonym),
    productEpoch: 1, diagnosticsEpoch: 1, diagnosticPseudonym: pseudonym,
    revision: 1, noticeVersion: 'diagnostics-v1',
    productNoticeVersion: 'analytics-v1', diagnosticsNoticeVersion: 'diagnostics-v1',
    productAnalyticsAllowed: false, optionalDiagnosticsAllowed: Boolean(pseudonym),
    productCollectionEnabled: false, diagnosticsCollectionEnabled: true,
    productConsentCurrent: true, diagnosticsConsentCurrent: true, privacySignalActive: false,
  }),
}) as Response;

describe('usePrivacyConsent account isolation', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('keeps diagnostics off when the preference request fails', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const view = renderHook(() => usePrivacyConsent('http://api.test', 'token-a'));
    await waitFor(() => expect(view.result.current.error).toMatch(/unavailable/));
    expect(view.result.current.status).toBeNull();
    expect(initSentry).not.toHaveBeenCalled();
  });

  it('does not reuse one account’s diagnostic pseudonym for a second account', async () => {
    let releaseSecond: ((value: Response) => void) | undefined;
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response('subject-a'))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseSecond = resolve; })) as unknown as typeof fetch;
    const view = renderHook(({ token }) => usePrivacyConsent('http://api.test', token), {
      initialProps: { token: 'token-a' },
    });
    await waitFor(() => expect(initSentry).toHaveBeenCalledWith({ pseudonym: 'subject-a' }));
    jest.mocked(initSentry).mockClear();
    view.rerender({ token: 'token-b' });
    expect(view.result.current.status).toBeNull();
    expect(initSentry).not.toHaveBeenCalled();
    releaseSecond?.(response(null));
    await waitFor(() => expect(view.result.current.status?.optionalDiagnosticsAllowed).toBe(false));
    expect(initSentry).not.toHaveBeenCalled();
    expect(closeSentry).toHaveBeenCalled();
  });

  it('ignores an older refresh response after a withdrawal is saved', async () => {
    let releaseRefresh: ((value: Response) => void) | undefined;
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response('subject-a'))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseRefresh = resolve; }))
      .mockResolvedValueOnce(response(null)) as unknown as typeof fetch;
    const view = renderHook(() => usePrivacyConsent('http://api.test', 'token-a'));
    await waitFor(() => expect(view.result.current.status?.optionalDiagnosticsAllowed).toBe(true));
    const staleRefresh = view.result.current.refresh();
    await view.result.current.save({ optionalDiagnostics: false });
    await waitFor(() => expect(view.result.current.status?.optionalDiagnosticsAllowed).toBe(false));
    jest.mocked(initSentry).mockClear();
    releaseRefresh?.(response('subject-a'));
    await staleRefresh;
    expect(view.result.current.status?.optionalDiagnosticsAllowed).toBe(false);
    expect(initSentry).not.toHaveBeenCalled();
  });
});
