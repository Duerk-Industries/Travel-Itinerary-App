/**
 * @jest-environment node
 */

import React, { Suspense, lazy } from 'react';
import { render } from '@testing-library/react-native';
import LazyTabFallback from '../components/LazyTabFallback';

describe('LazyTabFallback', () => {
  it('renders the default label', () => {
    const { getByTestId, getByText } = render(<LazyTabFallback />);
    expect(getByTestId('lazy-tab-fallback')).toBeTruthy();
    expect(getByText('Loading…')).toBeTruthy();
  });

  it('honors custom label and testID props', () => {
    const { getByTestId, getByText } = render(
      <LazyTabFallback label="Loading admin…" testID="lazy-admin-fallback" />
    );
    expect(getByTestId('lazy-admin-fallback')).toBeTruthy();
    expect(getByText('Loading admin…')).toBeTruthy();
  });

  it('renders when a Suspense boundary child is pending', () => {
    const Pending: React.FC = () => {
      throw new Promise<void>(() => {
        // never resolves — keeps Suspense boundary in pending state
      });
    };

    const { getByTestId } = render(
      <Suspense fallback={<LazyTabFallback testID="lazy-test-fallback" />}>
        <Pending />
      </Suspense>
    );

    expect(getByTestId('lazy-test-fallback')).toBeTruthy();
  });

  it('supports being used as a React.lazy() fallback', () => {
    const LazyChild = lazy(
      () =>
        new Promise<{ default: React.ComponentType }>(() => {
          // never resolves — fallback should render
        })
    );

    const { getByTestId } = render(
      <Suspense fallback={<LazyTabFallback testID="lazy-test-fallback" />}>
        <LazyChild />
      </Suspense>
    );

    expect(getByTestId('lazy-test-fallback')).toBeTruthy();
  });
});
