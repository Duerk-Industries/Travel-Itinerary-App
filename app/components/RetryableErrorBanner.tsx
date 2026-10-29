import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { memo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { RetryableMutationState } from '../hooks/useRetryableMutation';

type RetryableErrorBannerProps = {
  /** Current state of the underlying `useRetryableMutation` hook. */
  state: RetryableMutationState;
  /** Last captured error from the hook (only rendered when `state === 'failed'`). */
  error: Error | null;
  /** Hook's `retry()` callback — invoked when the user presses the retry button. */
  onRetry: () => void;
  /** Optional `reset()` handler; when provided, adds a "Dismiss" button next to Retry. */
  onDismiss?: () => void;
  /** Label describing the action being retried, e.g. "Save expense". Used in the a11y label. */
  actionLabel?: string;
  containerStyle?: Record<string, unknown>;
  textStyle?: Record<string, unknown>;
};

const defaultContainer = (_theme: import('../theme/theme').AppTheme): Record<string, unknown> => themeStyle('components_RetryableErrorBanner_1', {  }, _theme);

const defaultText = (_theme: import('../theme/theme').AppTheme): Record<string, unknown> => themeStyle('components_RetryableErrorBanner_2', {  }, _theme);

const defaultButton = (_theme: import('../theme/theme').AppTheme): Record<string, unknown> => themeStyle('components_RetryableErrorBanner_3', {  }, _theme);

const defaultButtonText = (_theme: import('../theme/theme').AppTheme): Record<string, unknown> => themeStyle('components_RetryableErrorBanner_4', {  }, _theme);

/**
 * Renders a red error banner with a Retry button for a failed mutation. Pair
 * with `useRetryableMutation`: pass `state`, `error`, and bind `onRetry` to
 * the hook's `retry`. Hidden unless `state === 'failed'`.
 *
 * The retry button is disabled while `state === 'pending'` (e.g. after the
 * user presses Retry and we're waiting) so the user can't enqueue duplicate
 * writes.
 */
const RetryableErrorBannerComponent: React.FC<RetryableErrorBannerProps> = ({
  state,
  error,
  onRetry,
  onDismiss,
  actionLabel,
  containerStyle,
  textStyle,
}) => {
  const _styleTheme = useStyleTheme();
  if (state !== 'failed' && state !== 'pending') return null;
  if (state === 'pending' && !error) return null;

  const message = error?.message ?? 'Something went wrong.';
  const retrying = state === 'pending';
  const retryA11y = actionLabel ? `Retry ${actionLabel}` : 'Retry';

  return (
    <View
      style={[defaultContainer(_styleTheme), containerStyle] as any}
      testID="retryable-error-banner"
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${actionLabel ? `${actionLabel} failed. ` : ''}${message}`}
    >
      <Text style={[defaultText(_styleTheme), textStyle] as any} testID="retryable-error-banner-message">
        {retrying ? 'Retrying…' : message}
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        disabled={retrying}
        accessibilityRole="button"
        accessibilityLabel={retryA11y}
        accessibilityState={{ disabled: retrying }}
        style={[defaultButton(_styleTheme), retrying && themeStyle('components_RetryableErrorBanner_5', {  }, _styleTheme)] as any}
        testID="retryable-error-banner-retry"
      >
        <Text style={defaultButtonText(_styleTheme) as any}>{retrying ? '…' : 'Retry'}</Text>
      </TouchableOpacity>
      {onDismiss ? (
        <TouchableOpacity
          onPress={onDismiss}
          disabled={retrying}
          accessibilityRole="button"
          accessibilityLabel={actionLabel ? `Dismiss ${actionLabel} error` : 'Dismiss error'}
          accessibilityState={{ disabled: retrying }}
          style={[defaultButton(_styleTheme), retrying && themeStyle('components_RetryableErrorBanner_6', {  }, _styleTheme)] as any}
          testID="retryable-error-banner-dismiss"
        >
          <Text style={defaultButtonText(_styleTheme) as any}>Dismiss</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const RetryableErrorBanner = memo(RetryableErrorBannerComponent);

export default RetryableErrorBanner;
