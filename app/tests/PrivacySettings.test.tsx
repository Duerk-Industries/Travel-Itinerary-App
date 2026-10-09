/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import { AccountPrivacySettings, PrivacyChoiceDialog } from '../components/PrivacySettings';
import type { PrivacyController } from '../hooks/usePrivacyConsent';
import { getAppTheme } from '../theme/theme';

const theme = getAppTheme('light', 'light');
const flattenStyle = (style: any): Record<string, any> => Array.isArray(style)
  ? Object.assign({}, ...style.map(flattenStyle))
  : (style ?? {});
const contrastRatio = (foreground: string, background: string): number => {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

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
    const view = render(<PrivacyChoiceDialog privacy={privacy} backendUrl="http://api.test" theme={theme} />);
    expect(view.getByText('Accept')).toBeTruthy();
    expect(view.getByText('Reject')).toBeTruthy();
    expect(view.getByText('Customize')).toBeTruthy();
    fireEvent.press(view.getByText('Reject'));
    await waitFor(() => expect(privacy.save).toHaveBeenCalledWith({ productAnalytics: false, optionalDiagnostics: false }));
  });

  it('does not offer product analytics under a browser privacy signal', async () => {
    const privacy = controller({ status: { ...controller().status!, privacySignalActive: true } });
    const view = render(<PrivacyChoiceDialog privacy={privacy} backendUrl="http://api.test" theme={theme} />);
    fireEvent.press(view.getByText('Accept'));
    await waitFor(() => expect(privacy.save).toHaveBeenCalledWith({ optionalDiagnostics: true }));
  });

  it('allows independent custom choices', async () => {
    const privacy = controller();
    const view = render(<PrivacyChoiceDialog privacy={privacy} backendUrl="http://api.test" theme={theme} />);
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
    const view = render(<AccountPrivacySettings privacy={controller({ showPrompt: false })} backendUrl="http://api.test" token="token-1" theme={theme} />);

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
    const view = render(<AccountPrivacySettings privacy={controller({ showPrompt: false })} backendUrl="http://api.test" token="token-1" theme={theme} />);
    fireEvent.press(view.getByTestId('privacy-delete-analytics'));
    fireEvent.press(view.getByTestId('privacy-delete-analytics-confirm-button'));
    expect(await view.findByText(/will finish automatically/)).toBeTruthy();

    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    fireEvent.press(view.getByTestId('privacy-delete-analytics'));
    fireEvent.press(view.getByTestId('privacy-delete-analytics-confirm-button'));
    expect(await view.findByText(/Could not delete analytics data/)).toBeTruthy();
  });
});

describe('AccountPrivacySettings public links', () => {
  it('opens each legal page from the profile privacy section', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      const view = render(<AccountPrivacySettings privacy={controller({ showPrompt: false })} backendUrl="http://api.test" token="token-1" theme={theme} />);
      for (const label of ['Privacy notice', 'Cookie notice', 'Your choices', 'Delete account']) {
        fireEvent.press(view.getByText(label));
      }
      expect(open.mock.calls.map(([url]) => url)).toEqual([
        'http://api.test/privacy.html',
        'http://api.test/cookies.html',
        'http://api.test/privacy-choices.html',
        'http://api.test/delete-account.html',
      ]);
    } finally {
      open.mockRestore();
    }
  });
});

describe('privacy surfaces across platforms and appearances', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  it.each([
    ['web', 'light'], ['web', 'dark'],
    ['ios', 'light'], ['ios', 'dark'],
    ['android', 'light'], ['android', 'dark'],
  ] as const)('keeps panel text, errors, switches and actions legible on %s in %s mode', async (platform, mode) => {
    Platform.OS = platform;
    const appearance = getAppTheme(mode, mode);
    const unavailable = controller({
      showPrompt: false,
      error: 'Privacy settings are unavailable. Optional collection is off.',
      status: { ...controller().status!, productCollectionEnabled: false, diagnosticsCollectionEnabled: false },
    });
    const account = render(<AccountPrivacySettings privacy={unavailable} backendUrl="http://api.test" token="token-1" theme={appearance} />);
    const card = flattenStyle(account.getByTestId('privacy-settings-card').props.style);
    const title = flattenStyle(account.getByText('Privacy').props.style);
    const description = flattenStyle(account.getByText(/Necessary account/).props.style);
    const error = flattenStyle(account.getByText(unavailable.error!).props.style);
    const button = flattenStyle(account.getByTestId('privacy-notice-button').props.style);
    const buttonText = flattenStyle(account.getByText('Privacy notice').props.style);
    expect(card.backgroundColor).toBe(appearance.colors.surface);
    expect(contrastRatio(title.color, card.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(description.color, card.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(error.color, card.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(buttonText.color, button.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(button.minHeight).toBeGreaterThanOrEqual(44);
    expect(account.getByLabelText('Product analytics').props.trackColor.false).toBeTruthy();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    fireEvent.press(account.getByTestId('privacy-notice-button'));
    expect(openURL).toHaveBeenCalledWith('http://api.test/privacy.html');
    openURL.mockRestore();
    account.unmount();

    const privacy = controller();
    const dialog = render(<PrivacyChoiceDialog privacy={privacy} backendUrl="http://api.test" theme={appearance} />);
    const panel = flattenStyle(dialog.getByTestId('privacy-choice-panel').props.style);
    const heading = flattenStyle(dialog.getByText('Your privacy choices').props.style);
    const explanation = flattenStyle(dialog.getByText(/You can use WanderBunnies/).props.style);
    const accept = flattenStyle(dialog.getByTestId('privacy-choice-accept').props.style);
    const acceptText = flattenStyle(dialog.getByText('Accept').props.style);
    const reject = flattenStyle(dialog.getByTestId('privacy-choice-reject').props.style);
    const rejectText = flattenStyle(dialog.getByText('Reject').props.style);
    expect(panel.backgroundColor).toBe(appearance.colors.surface);
    expect(contrastRatio(heading.color, panel.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(explanation.color, panel.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(acceptText.color, accept.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(rejectText.color, reject.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(accept.minHeight).toBeGreaterThanOrEqual(44);
    fireEvent.press(dialog.getByTestId('privacy-choice-reject'));
    await waitFor(() => expect(privacy.save).toHaveBeenCalledWith({ productAnalytics: false, optionalDiagnostics: false }));
  });
});
