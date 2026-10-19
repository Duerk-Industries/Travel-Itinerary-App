/// <reference types="jest" />

import React from 'react';
import { render } from '@testing-library/react-native';
import OfflineBanner from '../components/OfflineBanner';

describe('OfflineBanner', () => {
  it('renders the status supplied by the app connection subscription', () => {
    const { getByTestId, rerender } = render(<OfflineBanner status="reconnecting" />);

    expect(getByTestId('offline-banner').props.accessibilityLabel).toBe('Reconnecting…');

    rerender(<OfflineBanner status="online" />);
    expect(() => getByTestId('offline-banner')).toThrow();
  });

  it('keeps the cached-data warning while offline access is read-only', () => {
    const { getByText } = render(<OfflineBanner status="online" offlineReadOnly />);

    expect(getByText('Offline — cached trip data is read-only.')).toBeTruthy();
  });
});

describe('OfflineBanner copy matches what the app lets you do offline', () => {
  it('tells a signed-out visitor to connect instead of mentioning cached trips they do not have', () => {
    const { getByText } = render(<OfflineBanner status="offline" offlineReadOnly signedIn={false} />);
    expect(getByText("You're offline. Connect to the internet to sign in.")).toBeTruthy();
  });

  it('says expenses can still be added when that is true, instead of claiming changes are not saved', () => {
    const { getByText, queryByText } = render(<OfflineBanner status="offline" offlineReadOnly canAddExpenses />);
    expect(getByText('Offline — you can still add expenses. Everything else is read-only until you reconnect.')).toBeTruthy();
    expect(queryByText(/changes will not be saved/)).toBeNull();
  });

  it('keeps the read-only warning when expenses cannot be added (cached unlock, followed trips)', () => {
    const { getByText } = render(<OfflineBanner status="offline" offlineReadOnly canAddExpenses={false} />);
    expect(getByText('Offline — cached trip data is read-only.')).toBeTruthy();
  });
});
