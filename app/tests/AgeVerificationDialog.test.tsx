/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import AgeVerificationDialog, { fetchAgeVerificationStatus } from '../components/AgeVerificationDialog';
import { getAppTheme } from '../theme/theme';

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const renderDialog = (overrides: Partial<React.ComponentProps<typeof AgeVerificationDialog>> = {}) => {
  const props = {
    visible: true,
    styles: {},
    backendUrl: 'http://api.test',
    token: 'token-1',
    onVerified: jest.fn(),
    onSignOut: jest.fn(),
    ...overrides,
  };
  return { ...render(<AgeVerificationDialog {...props} />), props };
};

describe('AgeVerificationDialog', () => {
  const originalFetch = global.fetch;
  const originalOS = Platform.OS;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    Platform.OS = 'web';
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    Platform.OS = originalOS;
    global.fetch = originalFetch;
  });

  it('is a neutral age screen: the minimum age is not shown before submission', () => {
    const { getByTestId, queryByText } = renderDialog();
    expect(getByTestId('age-verification-dialog')).toBeTruthy();
    expect(queryByText(/16/)).toBeNull();
  });

  it('posts the date of birth and reports success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { required: false }));
    const { getByTestId, props } = renderDialog();
    const dateField = getByTestId('age-verification-date-input') as any;
    expect(dateField.props.type).toBe('date');
    fireEvent(dateField, 'change', { target: { value: '1990-05-04' } });
    fireEvent.press(getByTestId('age-verification-submit'));
    await waitFor(() => expect(props.onVerified).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/account/age-verification');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ dateOfBirth: '1990-05-04' });
    expect(init.headers.Authorization).toBe('Bearer token-1');
  });

  it('shows a validation message for an invalid date', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { code: 'INVALID_DATE_OF_BIRTH' }));
    const { getByTestId, findByText, props } = renderDialog();
    fireEvent(getByTestId('age-verification-date-input'), 'change', { target: { value: '1990-05-04' } });
    fireEvent.press(getByTestId('age-verification-submit'));
    expect(await findByText('Choose a valid date of birth.')).toBeTruthy();
    expect(props.onVerified).not.toHaveBeenCalled();
  });

  it('offers account deletion or sign-out to an under-age user', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { code: 'UNDER_MINIMUM_AGE' }))
      .mockResolvedValueOnce(jsonResponse(204, {}));
    const { getByTestId, findByTestId, props } = renderDialog();
    fireEvent(getByTestId('age-verification-date-input'), 'change', { target: { value: `${new Date().getFullYear() - 5}-01-01` } });
    fireEvent.press(getByTestId('age-verification-submit'));
    await findByTestId('age-verification-under-age');
    expect(props.onVerified).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('age-verification-delete-account'));
    await waitFor(() => expect(props.onSignOut).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('http://api.test/api/account');
    expect(init.method).toBe('DELETE');
  });

  it('lets the user sign out without answering', () => {
    const { getByTestId, props } = renderDialog();
    fireEvent.press(getByTestId('age-verification-sign-out'));
    expect(props.onSignOut).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the shared native picker and commits the selected birth date', async () => {
    Platform.OS = 'ios';
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { required: false }));
    const { getByTestId, props } = renderDialog();
    fireEvent.press(getByTestId('age-verification-date-input'));
    const picker = getByTestId('native-date-time-picker');
    expect(picker.props.display).toBe('spinner');
    expect(picker.props.value.getFullYear()).toBe(new Date().getFullYear() - 25);
    act(() => picker.props.onValueChange({ nativeEvent: {} }, new Date(1990, 4, 4)));
    fireEvent.press(getByTestId('age-verification-date-input-done'));
    fireEvent.press(getByTestId('age-verification-submit'));
    await waitFor(() => expect(props.onVerified).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ dateOfBirth: '1990-05-04' });
  });

  it.each([
    ['web', 'light'], ['web', 'dark'],
    ['ios', 'light'], ['ios', 'dark'],
    ['android', 'light'], ['android', 'dark'],
  ] as const)('keeps the date control and sign-out action usable on %s in %s mode', (platform, mode) => {
    Platform.OS = platform;
    const theme = getAppTheme(mode, mode);
    const { getByTestId, props } = renderDialog({ theme });
    const dateField = getByTestId('age-verification-date-input');
    if (platform === 'web') {
      expect(dateField.props.type).toBe('date');
      expect(dateField.props.style.colorScheme).toBe(mode);
    } else {
      fireEvent.press(dateField);
      const picker = getByTestId('native-date-time-picker');
      if (platform === 'ios') {
        expect(picker.props.themeVariant).toBe(mode);
        expect(picker.props.textColor).toBe(theme.colors.text);
      } else {
        expect(picker.props.mode).toBe('date');
      }
    }
    const signOut = getByTestId('age-verification-sign-out');
    expect(signOut.props.style.some((part: any) => part?.minHeight === 44)).toBe(true);
    fireEvent.press(signOut);
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('fetchAgeVerificationStatus returns null on network failure so the app is not blocked by an outage', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchAgeVerificationStatus('http://api.test', 'token-1')).toBeNull();
  });
});
