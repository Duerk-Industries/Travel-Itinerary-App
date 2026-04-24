/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import RetryableErrorBanner from '../components/RetryableErrorBanner';

describe('RetryableErrorBanner', () => {
  it('renders nothing in the idle state', () => {
    const { queryByTestId } = render(
      <RetryableErrorBanner state="idle" error={null} onRetry={jest.fn()} />,
    );
    expect(queryByTestId('retryable-error-banner')).toBeNull();
  });

  it('renders nothing in the success state', () => {
    const { queryByTestId } = render(
      <RetryableErrorBanner state="success" error={null} onRetry={jest.fn()} />,
    );
    expect(queryByTestId('retryable-error-banner')).toBeNull();
  });

  it('renders the error message with a retry button in the failed state', () => {
    const onRetry = jest.fn();
    const { getByTestId } = render(
      <RetryableErrorBanner
        state="failed"
        error={new Error('Network unreachable')}
        onRetry={onRetry}
        actionLabel="Save expense"
      />,
    );
    const message = getByTestId('retryable-error-banner-message');
    expect(message.props.children).toBe('Network unreachable');

    const retryButton = getByTestId('retryable-error-banner-retry');
    expect(retryButton.props.accessibilityLabel).toBe('Retry Save expense');
    expect(retryButton.props.accessibilityState?.disabled).toBe(false);

    fireEvent.press(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic message when no error is provided in failed state', () => {
    const { getByTestId } = render(
      <RetryableErrorBanner state="failed" error={null} onRetry={jest.fn()} />,
    );
    const message = getByTestId('retryable-error-banner-message');
    expect(message.props.children).toBe('Something went wrong.');
  });

  it('shows "Retrying…" and marks the retry button disabled while pending (after a prior failure)', () => {
    const onRetry = jest.fn();
    const { getByTestId } = render(
      <RetryableErrorBanner
        state="pending"
        error={new Error('Previous attempt failed')}
        onRetry={onRetry}
        actionLabel="Save"
      />,
    );
    const message = getByTestId('retryable-error-banner-message');
    expect(message.props.children).toBe('Retrying…');

    // Both the `disabled` prop (native-side) and accessibilityState.disabled
    // (screen-reader-side) must be set — that's the real-device guarantee.
    // RNTL's fireEvent.press bypasses `disabled`, so we can't assert the
    // handler isn't called here; the native render respects `disabled`.
    const retryButton = getByTestId('retryable-error-banner-retry');
    expect(retryButton.props.accessibilityState?.disabled).toBe(true);
    expect(retryButton.props.disabled).toBe(true);
  });

  it('renders a Dismiss button only when onDismiss is provided', () => {
    const onDismiss = jest.fn();
    const { queryByTestId, rerender, getByTestId } = render(
      <RetryableErrorBanner state="failed" error={new Error('x')} onRetry={jest.fn()} />,
    );
    expect(queryByTestId('retryable-error-banner-dismiss')).toBeNull();

    rerender(
      <RetryableErrorBanner
        state="failed"
        error={new Error('x')}
        onRetry={jest.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(getByTestId('retryable-error-banner-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('exposes a role=alert with a live region for screen readers', () => {
    const { getByTestId } = render(
      <RetryableErrorBanner
        state="failed"
        error={new Error('Save failed')}
        onRetry={jest.fn()}
        actionLabel="Save expense"
      />,
    );
    const banner = getByTestId('retryable-error-banner');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
    expect(banner.props.accessibilityLabel).toBe('Save expense failed. Save failed');
  });
});
