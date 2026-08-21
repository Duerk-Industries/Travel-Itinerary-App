/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { OverviewTab } from '../tabs/overview';
import { getAppTheme } from '../theme/theme';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Covers the `ai_itinerary_generation` feature flag (+ tier entitlement)
// hiding the failed-generation "Retry" button — retrying would just 402
// again while the flag/entitlement is off.
const baseTrip = {
  id: 'trip-1',
  groupId: 'group-1',
  name: 'Test Trip',
  description: '',
  createdAt: '2026-01-01',
};

const baseProps = {
  backendUrl: 'http://localhost:4000',
  headers: { Authorization: 'Bearer token' },
  jsonHeaders: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
  trip: baseTrip,
  group: { id: 'group-1', name: 'Group', members: [] },
  attendees: [],
  flights: [],
  lodgings: [],
  tours: [],
  carRentals: [],
  defaultPayerId: null,
  styles: {},
  theme: getAppTheme('light', 'light'),
  mapApp: 'google' as any,
  onOpenAddress: jest.fn(),
  onRefreshTrips: jest.fn(),
  onRefreshGroups: jest.fn(),
  onRefreshGroupMembers: jest.fn(),
  onFlightDataChanged: jest.fn(),
  onLodgingDataChanged: jest.fn(),
  onTourDataChanged: jest.fn(),
  onAddCarRental: jest.fn(),
  openFlightInFlightsTab: jest.fn(),
  openLodgingDetails: jest.fn(),
  aiItineraryPending: false,
  aiItineraryFailedMessage: 'generation failed',
  onRetryAiItinerary: jest.fn(),
  onDismissAiItineraryError: jest.fn(),
};

const findRetryButton = (root: any) =>
  root.findAllByProps({ testID: 'ai-itinerary-retry-button' }).filter((node: any) => typeof node.props?.onPress === 'function');

describe('Overview failed AI itinerary banner', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as any);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('shows the Retry button when AI itinerary generation is allowed', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(<OverviewTab {...(baseProps as any)} aiItineraryGenerationAllowed />);
    });
    expect(findRetryButton(tree!.root).length).toBeGreaterThan(0);
  });

  test('hides the Retry button when AI itinerary generation is disallowed', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(<OverviewTab {...(baseProps as any)} aiItineraryGenerationAllowed={false} />);
    });
    expect(findRetryButton(tree!.root).length).toBe(0);
  });
});
