/**
 * @jest-environment node
 */

import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        backendUrl: 'https://duerk.org',
        refreshIntervalMs: 60000,
      },
    },
  },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
}));

jest.mock('../assets/wanderbunnies-reference.png', () => 1);

const App = require('../App').default;

describe('App startup', () => {
  it('renders the signed-out native shell without crashing', () => {
    const { getByText } = render(<App />);
    expect(getByText('WanderBunnies')).toBeTruthy();
  });
});
