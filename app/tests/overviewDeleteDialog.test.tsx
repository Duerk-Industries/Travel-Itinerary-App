/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { OverviewTab } from '../tabs/overview';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const baseTrip = {
  id: 'trip-1',
  groupId: 'group-1',
  name: 'Test Trip',
  description: 'Old description',
  createdAt: '2026-01-01',
};

const sampleTour = {
  id: 'tour-1',
  status: 'Proposed',
  date: '2026-09-02',
  name: 'Museum Tour',
  startLocation: 'Old Town',
  startTime: '10:00',
  duration: '2h',
  cost: '40',
  freeCancelBy: '',
  bookedOn: '',
  reference: '',
};

const findByText = (root: any, label: string) =>
  root.findAll((node: any) => node.type === 'Text' && node.props.children === label).slice(-1)[0];

const pressByText = (root: any, label: string) => {
  const textNode = findByText(root, label);
  if (!textNode || !textNode.parent?.props.onPress) {
    throw new Error(`Button with label "${label}" not found.`);
  }
  textNode.parent.props.onPress();
};

// Some pressable labels (e.g. "View details") aren't the Text's direct parent — they're
// nested inside a wrapping View whose ancestor TouchableOpacity carries onPress. Walk up
// to the nearest pressable ancestor instead of assuming the immediate parent has onPress.
const pressByTextContains = (root: any, text: string) => {
  const pressables = root.findAll((node: any) => node.type === 'TouchableOpacity' && node.props?.onPress);
  for (const pressable of pressables) {
    const textNodes = pressable.findAll((node: any) => node.type === 'Text');
    const joined = textNodes
      .map((node: any) => {
        const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
        return children.filter((child: any) => typeof child === 'string').join('');
      })
      .join(' ');
    if (joined.includes(text)) {
      pressable.props.onPress();
      return;
    }
  }
  throw new Error(`Button with text containing "${text}" not found.`);
};

// A single logical element can surface at multiple fiber levels (e.g. a memo() wrapper,
// its inner component, and the host View it renders) all carrying the same testID prop —
// use findAllByProps and pick whichever match actually carries the handler, rather than
// findByProps, which throws on more than one match.
const pressByTestId = (root: any, testID: string) => {
  const matches = root.findAllByProps({ testID }).filter((node: any) => typeof node.props?.onPress === 'function');
  const node = matches[matches.length - 1];
  if (!node) throw new Error(`Pressable with testID "${testID}" not found.`);
  node.props.onPress();
};

// The ConfirmDialog's Confirm button and TripItemDetailsDialog's Delete button both
// render literal "Delete" text, so pressByText's "last match" heuristic is ambiguous
// between them. accessibilityLabel disambiguates: the details dialog's is
// "Delete activity" (via `Delete ${kind}`), the confirm dialog's default is just "Delete".
const pressByAccessibilityLabel = (root: any, accessibilityLabel: string) => {
  const matches = root
    .findAllByProps({ accessibilityLabel })
    .filter((node: any) => typeof node.props.onPress === 'function');
  const node = matches[matches.length - 1];
  if (!node) throw new Error(`Pressable with accessibilityLabel "${accessibilityLabel}" not found.`);
  node.props.onPress();
};

const findByTestIdOrNull = (root: any, testID: string) => {
  const matches = root.findAllByProps({ testID });
  return matches.length ? matches[0] : null;
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
  tours: [sampleTour],
  carRentals: [],
  defaultPayerId: null,
  styles: {},
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
  featureStandardizedItemDialogs: true,
};

describe('Overview standardized item-details dialog: delete flow', () => {
  let resolveDelete: (() => void) | null = null;

  beforeEach(() => {
    resolveDelete = null;
    baseProps.onTourDataChanged.mockClear();
    // The DELETE request is held open deliberately (never auto-resolves) so the test
    // can assert the dialogs close on confirm BEFORE the network call completes —
    // exactly the "closes immediately even though the action is async" requirement.
    (global as any).fetch = jest.fn((url: string, options?: any) => {
      if (String(url).includes('/api/activities/') && options?.method === 'DELETE') {
        return new Promise((resolve) => {
          resolveDelete = () => resolve({ ok: true, json: async () => ({}) } as any);
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as any);
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('closes the details and confirmation dialogs immediately on Delete, before the DELETE request resolves', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(<OverviewTab {...(baseProps as any)} />);
    });
    const root = tree!.root;

    act(() => {
      pressByTextContains(root, 'View details');
    });

    // Open the activity's standardized details dialog from the day card's activity row.
    act(() => {
      pressByTestId(root, 'day-details-activity-tour-1');
    });
    expect(findByTestIdOrNull(root, 'activity-overview-details')).toBeTruthy();

    // The details dialog's own Delete button opens the confirmation dialog (details
    // dialog itself stays mounted underneath it, matching current behavior).
    act(() => {
      pressByTestId(root, 'activity-details-delete');
    });
    expect(findByTestIdOrNull(root, 'confirm-dialog')).toBeTruthy();

    // Confirming delete must close both dialogs synchronously — the DELETE request is
    // still pending (resolveDelete hasn't been called yet) — never lag/appear hung.
    act(() => {
      pressByAccessibilityLabel(root, 'Delete');
    });

    expect(findByTestIdOrNull(root, 'confirm-dialog')).toBeNull();
    expect(findByTestIdOrNull(root, 'activity-overview-details')).toBeNull();
    expect(baseProps.onTourDataChanged).not.toHaveBeenCalled();
    expect(resolveDelete).toBeTruthy();

    // Only once the network request actually completes does the data-changed callback fire.
    await act(async () => {
      resolveDelete!();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(baseProps.onTourDataChanged).toHaveBeenCalledTimes(1);
  });

  test('surfaces an Alert and does not silently swallow a failed delete', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => undefined);
    (global as any).fetch = jest.fn((url: string, options?: any) => {
      if (String(url).includes('/api/activities/') && options?.method === 'DELETE') {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'Only the creator can delete this activity' }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as any);
    });

    let tree: any;
    await act(async () => {
      tree = renderer.create(<OverviewTab {...(baseProps as any)} />);
    });
    const root = tree!.root;

    act(() => {
      pressByTextContains(root, 'View details');
    });
    act(() => {
      pressByTestId(root, 'day-details-activity-tour-1');
    });
    act(() => {
      pressByTestId(root, 'activity-details-delete');
    });

    await act(async () => {
      pressByAccessibilityLabel(root, 'Delete');
      await Promise.resolve();
      await Promise.resolve();
    });

    // Dialogs still close immediately regardless of the eventual outcome...
    expect(findByTestIdOrNull(root, 'confirm-dialog')).toBeNull();
    // ...and the failure is surfaced rather than silently dropped.
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Only the creator can delete this activity'));
    alertSpy.mockRestore();
  });
});
