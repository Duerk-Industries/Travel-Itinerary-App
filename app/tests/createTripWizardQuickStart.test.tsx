/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import CreateTripWizard from '../tabs/createTripWizard';

// Covers implementation-plan-ux-remediation.md Initiative C: the wizard
// defaults to a 3-field Quick Start screen instead of opening directly on
// the full 9-step "Trip Details" step, with a documented flag-off fallback
// and a "Customize before creating" escape hatch into the full wizard.
//
// The wizard consumes a large, evolving `styles` object by key; a Proxy that
// returns `{}` for any key stands in for a full literal so this test isn't
// coupled to (and doesn't need updating for) every style name the component
// happens to reference.
const styles: Record<string, any> = new Proxy(
  {},
  {
    get: () => ({}),
  }
);

const baseProps = {
  backendUrl: 'http://localhost:4000',
  userToken: 'token',
  headers: {} as Record<string, string>,
  traits: [] as any[],
  airportOptions: [] as string[],
  onSearchAirports: jest.fn(),
  styles,
  onCancel: jest.fn(),
  onTripCreated: jest.fn(),
  onAiItineraryQueued: jest.fn(),
  onUnauthorized: jest.fn(),
  onWizardCarRentals: jest.fn(),
  currentUserName: 'Rose Nguyen',
  currentUserEmail: 'rose@example.com',
};

describe('CreateTripWizard Quick Start', () => {
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => [] } as any);
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    if (!originalFetch) delete (global as any).fetch;
    else (global as any).fetch = originalFetch;
  });

  it('opens on the 3-field Quick Start screen by default', () => {
    const { getByText, getByTestId, queryByText } = render(<CreateTripWizard {...baseProps} />);
    expect(getByText('Start planning in seconds')).toBeTruthy();
    expect(getByTestId('quick-start-trip-name')).toBeTruthy();
    expect(getByTestId('quick-start-create')).toBeTruthy();
    // The full wizard's step-by-step heading is not shown in Quick Start mode.
    expect(queryByText('Step 1 of 9: Trip Details')).toBeNull();
  });

  it('opens directly on the full step wizard when featureQuickStartTripWizard is disabled', () => {
    const { getByText, queryByText } = render(
      <CreateTripWizard {...baseProps} featureQuickStartTripWizard={false} />
    );
    expect(getByText('Step 1 of 9: Trip Details')).toBeTruthy();
    expect(queryByText('Start planning in seconds')).toBeNull();
  });

  it('lets a traveler switch from Quick Start into the full wizard via "Customize before creating"', () => {
    const { getByTestId, getByText, queryByText } = render(<CreateTripWizard {...baseProps} />);
    fireEvent.press(getByTestId('quick-start-customize'));
    expect(getByText('Step 1 of 9: Trip Details')).toBeTruthy();
    expect(queryByText('Start planning in seconds')).toBeNull();
  });

  it('disables Create Trip until a name, destination, and both dates are present', () => {
    const { getByTestId } = render(<CreateTripWizard {...baseProps} />);
    const createButton = getByTestId('quick-start-create');
    expect(createButton.props.accessibilityState?.disabled ?? createButton.props.disabled).toBeTruthy();

    fireEvent.changeText(getByTestId('quick-start-trip-name'), 'Kyoto Trip');
    // Name alone still isn't enough — destination and dates are still missing.
    expect(getByTestId('quick-start-create').props.accessibilityState?.disabled ?? getByTestId('quick-start-create').props.disabled).toBeTruthy();
  });

  it('cancels the wizard (not just steps back) when Cancel is pressed from Quick Start', () => {
    const onCancel = jest.fn();
    const { getByText } = render(<CreateTripWizard {...baseProps} onCancel={onCancel} />);
    fireEvent.press(getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
