/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccountPrivacySettings, PrivacyChoiceDialog } from '../components/PrivacySettings';
import type { PrivacyController } from '../hooks/usePrivacyConsent';

const controller = (overrides: Partial<PrivacyController> = {}): PrivacyController => ({
  status: {
    productAnalytics: null, optionalDiagnostics: null, productEpoch: 0, diagnosticsEpoch: 0,
    diagnosticPseudonym: null, revision: 0, noticeVersion: null,
    productNoticeVersion: null, diagnosticsNoticeVersion: null,
    productAnalyticsAllowed: false, optionalDiagnosticsAllowed: false,
    productCollectionEnabled: true, diagnosticsCollectionEnabled: true,
    productConsentCurrent: false, diagnosticsConsentCurrent: false, privacySignalActive: false,
  },
  loading: false, saving: false, error: null, showPrompt: true,
  refresh: jest.fn(async () => undefined), save: jest.fn(async () => undefined),
  ...overrides,
});

describe('PrivacyChoiceDialog', () => {
  it('offers equal accept, reject and customize actions and records refusal for both purposes', async () => {
    const privacy = controller();
    const view = render(<PrivacyChoiceDialog privacy={privacy} backendUrl="http://api.test" />);
    expect(view.getByText('Accept')).toBeTruthy();
    expect(view.getByText('Reject')).toBeTruthy();
    expect(view.getByText('Customize')).toBeTruthy();
    fireEvent.press(view.getByText('Reject'));
    await waitFor(() => expect(privacy.save).toHaveBeenCalledWith({ productAnalytics: false, optionalDiagnostics: false }));
  });

  it('does not offer product analytics under a browser privacy signal', async () => {
    const privacy = controller({ status: { ...controller().status!, privacySignalActive: true } });
    const view = render(<PrivacyChoiceDialog privacy={privacy} backendUrl="http://api.test" />);
    fireEvent.press(view.getByText('Accept'));
    await waitFor(() => expect(privacy.save).toHaveBeenCalledWith({ optionalDiagnostics: true }));
  });

  it('allows independent custom choices', async () => {
    const privacy = controller();
    const view = render(<PrivacyChoiceDialog privacy={privacy} backendUrl="http://api.test" />);
    fireEvent.press(view.getByText('Customize'));
    fireEvent(view.getByLabelText('Detailed diagnostics'), 'onValueChange', true);
    fireEvent.press(view.getByText('Save choices'));
    await waitFor(() => expect(privacy.save).toHaveBeenCalledWith({ productAnalytics: false, optionalDiagnostics: true }));
  });
});

describe('AccountPrivacySettings: delete analytics data', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('asks for confirmation, then calls the self-service erasure endpoint', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ id: 'job-1', status: 'completed' }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const view = render(<AccountPrivacySettings privacy={controller({ showPrompt: false })} backendUrl="http://api.test" token="token-1" />);

    fireEvent.press(view.getByTestId('privacy-delete-analytics'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.getByTestId('privacy-delete-analytics-confirm')).toBeTruthy();

    fireEvent.press(view.getByTestId('privacy-delete-analytics-confirm-button'));
    await waitFor(() => expect(view.getByTestId('privacy-delete-analytics-result')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/account/analytics-data', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token-1' },
    });
    expect(view.getByText('Your analytics and diagnostics data has been deleted.')).toBeTruthy();
  });

  it('reports a pending job and a failure honestly', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ id: 'job-2', status: 'failed' }) })) as unknown as typeof fetch;
    const view = render(<AccountPrivacySettings privacy={controller({ showPrompt: false })} backendUrl="http://api.test" token="token-1" />);
    fireEvent.press(view.getByTestId('privacy-delete-analytics'));
    fireEvent.press(view.getByTestId('privacy-delete-analytics-confirm-button'));
    expect(await view.findByText(/will finish automatically/)).toBeTruthy();

    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    fireEvent.press(view.getByTestId('privacy-delete-analytics'));
    fireEvent.press(view.getByTestId('privacy-delete-analytics-confirm-button'));
    expect(await view.findByText(/Could not delete analytics data/)).toBeTruthy();
  });
});
