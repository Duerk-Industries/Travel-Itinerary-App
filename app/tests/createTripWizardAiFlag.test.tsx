/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import CreateTripWizard from '../tabs/createTripWizard';

// Covers the `ai_itinerary_generation` feature flag (+ tier entitlement)
// hiding the "create with AI" option in the trip wizard. App.tsx computes
// `aiItineraryGenerationAllowed` from GET /api/account's `entitlements`
// field and passes it straight through as a prop.
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
  featureQuickStartTripWizard: false,
};

// Drives the full step wizard from "Trip Details" through to the
// "Itinerary" step (index 3) using only the minimum required fields.
const advanceToItineraryStep = ({ getByLabelText, getByText }: ReturnType<typeof render>) => {
  fireEvent.changeText(getByLabelText('Trip name'), 'Kyoto Trip');
  fireEvent.press(getByText('Next')); // Trip Details -> Dates

  fireEvent.press(getByText('Flexible Timeline'));
  fireEvent.press(getByLabelText('Select month'));
  fireEvent.press(getByLabelText('Select January'));
  fireEvent.press(getByLabelText('Select year'));
  fireEvent.press(getByLabelText(`Select ${new Date().getFullYear()}`));
  fireEvent.press(getByLabelText('Select number of days'));
  fireEvent.press(getByLabelText('Select 1'));
  fireEvent.press(getByText('Next')); // Dates -> Participants

  fireEvent.press(getByText('Next')); // Participants -> Itinerary
};

describe('CreateTripWizard AI itinerary generation flag', () => {
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

  it('shows the AI Yes/No option when generation is allowed', () => {
    const utils = render(<CreateTripWizard {...baseProps} aiItineraryGenerationAllowed />);
    advanceToItineraryStep(utils);

    expect(utils.getByText('Step 4 of 9: Itinerary')).toBeTruthy();
    expect(utils.getByText('Would you like to create a base itinerary using the help of AI?')).toBeTruthy();
    expect(utils.getByText('Yes')).toBeTruthy();
  });

  it('hides the AI option and locks the wizard to manual mode when generation is disallowed', () => {
    const utils = render(<CreateTripWizard {...baseProps} aiItineraryGenerationAllowed={false} />);
    advanceToItineraryStep(utils);

    expect(utils.getByText('Step 4 of 9: Itinerary')).toBeTruthy();
    expect(utils.queryByText('Would you like to create a base itinerary using the help of AI?')).toBeNull();
    expect(utils.queryByText('Yes')).toBeNull();
    expect(
      utils.getByText('AI itinerary generation is currently unavailable. You can build your itinerary manually below.')
    ).toBeTruthy();
    // Manual mode is auto-selected, so the manual itinerary builder shows immediately.
    expect(utils.getByText('All days are free to start. Add manual items to any day.')).toBeTruthy();
  });
});
