/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import PremiumTrialWelcomeDialog from '../components/PremiumTrialWelcomeDialog';

const styles = {
  modalOverlay: {},
  confirmModal: {},
  sectionTitle: {},
  helperText: {},
  premiumTrialFeatureList: {},
  row: {},
  button: {},
  smallButton: {},
  buttonText: {},
  secondaryButton: {},
  secondaryButtonText: {},
};

describe('PremiumTrialWelcomeDialog', () => {
  it('explains trial features and routes to Premium plans', () => {
    const onViewPlans = jest.fn();
    const onDismiss = jest.fn();
    const { getByText, getByTestId } = render(
      <PremiumTrialWelcomeDialog
        visible
        styles={styles}
        onViewPlans={onViewPlans}
        onDismiss={onDismiss}
      />,
    );

    expect(getByText('Try Premium free')).toBeTruthy();
    expect(getByText('• AI itinerary generation')).toBeTruthy();
    expect(getByText('• Email import for bookings')).toBeTruthy();
    expect(getByText('• Cost tracking and CSV exports')).toBeTruthy();
    expect(getByText('• Trip sharing and collaboration tools')).toBeTruthy();

    fireEvent.press(getByTestId('premium-trial-view-plans'));
    expect(onViewPlans).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId('premium-trial-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when hidden', () => {
    const { queryByTestId } = render(
      <PremiumTrialWelcomeDialog
        visible={false}
        styles={styles}
        onViewPlans={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );

    expect(queryByTestId('premium-trial-welcome-dialog')).toBeNull();
  });
});
