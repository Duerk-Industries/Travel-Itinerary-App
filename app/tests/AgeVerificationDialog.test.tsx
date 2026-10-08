/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AgeVerificationDialog, { fetchAgeVerificationStatus } from '../components/AgeVerificationDialog';

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
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
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
    fireEvent.changeText(getByTestId('age-verification-date-input'), '1990-05-04');
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
    fireEvent.changeText(getByTestId('age-verification-date-input'), '1990-13-40');
    fireEvent.press(getByTestId('age-verification-submit'));
    expect(await findByText('Enter a valid date as YYYY-MM-DD.')).toBeTruthy();
    expect(props.onVerified).not.toHaveBeenCalled();
  });

  it('offers account deletion or sign-out to an under-age user', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { code: 'UNDER_MINIMUM_AGE' }))
      .mockResolvedValueOnce(jsonResponse(204, {}));
    const { getByTestId, findByTestId, props } = renderDialog();
    fireEvent.changeText(getByTestId('age-verification-date-input'), '2015-01-01');
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

  it('fetchAgeVerificationStatus returns null on network failure so the app is not blocked by an outage', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchAgeVerificationStatus('http://api.test', 'token-1')).toBeNull();
  });
});
