/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PrivacyChoiceDialog } from '../components/PrivacySettings';
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
