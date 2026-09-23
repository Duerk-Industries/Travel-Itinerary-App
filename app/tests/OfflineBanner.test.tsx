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
