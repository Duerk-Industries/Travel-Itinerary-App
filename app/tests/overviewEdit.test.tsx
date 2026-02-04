import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { OverviewTab, dedupeAttendees, formatAttendeeLabel } from '../tabs/overview';
import LodgingDialog from '../components/LodgingDialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const baseTrip = {
  id: 'trip-1',
  groupId: 'group-1',
  name: 'Test Trip',
  description: 'Old description',
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

const pressByTextWithin = (root: any, label: string) => {
  const textNode = root.findAll((node: any) => node.type === 'Text' && node.props.children === label).slice(-1)[0];
  if (!textNode || !textNode.parent?.props.onPress) {
    throw new Error(`Button with label "${label}" not found.`);
  }
  textNode.parent.props.onPress();
};

const pressByTextContainsWithin = (root: any, text: string) => {
  const pressables = root.findAll((node: any) => node.type === 'TouchableOpacity' && node.props?.onPress);
  const matches: any[] = [];
  for (const pressable of pressables) {
    const textNodes = pressable.findAll((node: any) => node.type === 'Text');
    const joined = textNodes
      .map((node: any) => {
        const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
        return children.filter((child: any) => typeof child === 'string').join('');
      })
      .join(' ');
    if (joined.includes(text)) {
      matches.push(pressable);
    }
  }
  if (!matches.length) {
    throw new Error(`Button with text containing "${text}" not found.`);
  }
  matches[matches.length - 1].props.onPress();
};

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

describe('Overview edit controls', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn(async (url: string, options?: any) => {
      if (String(url).includes('/api/itineraries')) {
        return { ok: true, json: async () => [] } as any;
      }
      if (String(url).includes('/api/trips/') && options?.method === 'PATCH') {
        return { ok: true, json: async () => ({}) } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('save applies changes via PATCH', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(<OverviewTab {...baseProps} />);
    });
    const root = tree!.root;

    act(() => {
      pressByText(root, 'Edit');
    });

    const textInputs = root.findAllByType('TextInput');
    const descriptionInput = textInputs[textInputs.length - 1];
    act(() => {
      descriptionInput.props.onChangeText('New description');
    });

    await act(async () => {
      pressByText(root, 'Save');
    });

    const patchCalls = (global as any).fetch.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('/api/trips/')
    );
    expect(patchCalls.length).toBe(1);
    const patchBody = JSON.parse(patchCalls[0][1].body);
    expect(patchBody.description).toBe('New description');
  });

  test('cancel discards changes without PATCH', async () => {
    let tree: any;
    await act(async () => {
      tree = renderer.create(<OverviewTab {...baseProps} />);
    });
    const root = tree!.root;

    act(() => {
      pressByText(root, 'Edit');
    });
    const textInputs = root.findAllByType('TextInput');
    const descriptionInput = textInputs[textInputs.length - 1];
    act(() => {
      descriptionInput.props.onChangeText('Should not save');
    });

    act(() => {
      pressByText(root, 'Cancel');
    });

    const patchCalls = (global as any).fetch.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('/api/trips/')
    );
    expect(patchCalls.length).toBe(0);
  });

  test('dedupes attendees and renders name with email once', async () => {
    const attendees: Array<{
      id: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      userEmail?: string;
      status?: 'pending' | 'active' | 'removed';
    }> = [
      {
        id: 'member-1',
        firstName: 'Vicky',
        lastName: 'Duerk',
        email: 'vduerk@gmail.com',
        status: 'pending',
      },
      {
        id: 'member-2',
        userEmail: 'vduerk@gmail.com',
        status: 'pending',
      },
    ];

    const deduped = dedupeAttendees(attendees);
    expect(deduped.length).toBe(1);
    expect(formatAttendeeLabel(deduped[0])).toBe('Vicky Duerk (vduerk@gmail.com)');
  });

  test('add traveler sends guestName when email is provided', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({}) }) as any);
    (global as any).fetch = fetchMock;

    let tree: any;
    await act(async () => {
      tree = renderer.create(<OverviewTab {...baseProps} />);
    });
    const root = tree!.root;

    act(() => {
      const editNode = findByText(root, 'Edit');
      if (!editNode?.parent?.props.onPress) {
        throw new Error('Edit button not found.');
      }
      editNode.parent.props.onPress();
    });

    act(() => {
      const addTravelerNode = findByText(root, '+ Add');
      if (!addTravelerNode?.parent?.props.onPress) {
        throw new Error('Add Traveler button not found.');
      }
      addTravelerNode.parent.props.onPress();
    });

    const firstNameInput = root.findAllByProps({ placeholder: 'First name' })[0];
    const lastNameInput = root.findAllByProps({ placeholder: 'Last name' })[0];
    const emailInput = root.findAllByProps({ placeholder: 'Email (optional)' })[0];
    act(() => {
      firstNameInput.props.onChangeText('Vicky');
      lastNameInput.props.onChangeText('Duerk');
      emailInput.props.onChangeText('vduerk@gmail.com');
    });

    await act(async () => {
      pressByText(root, 'Save Traveler');
    });

    const addCall = fetchMock.mock.calls.find((call: any[]) => String(call[0]).includes('/api/groups/'));
    if (!addCall) {
      throw new Error('Expected add traveler request');
    }
    const options = (addCall as unknown[])[1] as { body?: string } | undefined;
    if (!options?.body) {
      throw new Error('Expected add traveler request body');
    }
    const body = JSON.parse(options.body);
    expect(body.email).toBe('vduerk@gmail.com');
    expect(body.guestName).toBe('Vicky Duerk');
  });

  test('removes traveler via group members endpoint on save', async () => {
    const attendees = [
      {
        id: 'member-1',
        firstName: 'Vicky',
        lastName: 'Duerk',
        email: 'vduerk@gmail.com',
        status: 'active' as const,
      },
    ];
    const fetchMock = jest.fn(async (url: string, options?: any) => {
      if (String(url).includes('/api/trips/') && options?.method === 'PATCH') {
        return { ok: true, json: async () => ({}) } as any;
      }
      if (String(url).includes('/api/groups/') && options?.method === 'DELETE') {
        return { ok: true, json: async () => ({}) } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });
    (global as any).fetch = fetchMock;

    let tree: any;
    await act(async () => {
      tree = renderer.create(<OverviewTab {...baseProps} attendees={attendees} />);
    });
    const root = tree!.root;

    act(() => {
      pressByText(root, 'Edit');
    });
    act(() => {
      const travelerChip = root.findByProps({ testID: 'attendee-chip-vduerk-gmail-com' });
      const removeButton = travelerChip.findByType('TouchableOpacity');
      removeButton.props.onPress();
    });
    await act(async () => {
      pressByText(root, 'Save');
    });

    const deleteCall = fetchMock.mock.calls.find((call: any[]) =>
      String(call[0]).includes(`/api/groups/${baseTrip.groupId}/members/member-1`)
    );
    expect(deleteCall).toBeTruthy();
  });

  test('edits lodging paid by and saves via PUT', async () => {
    const fetchMock = jest.fn(async (url: string, options?: any) => {
      if (String(url).includes('/api/itineraries')) {
        return { ok: true, json: async () => [] } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });
    (global as any).fetch = fetchMock;

    const attendees = [
      { id: 'member-1', firstName: 'John', lastName: 'Doe', email: 'john@doe.com', status: 'active' as const },
      { id: 'member-2', firstName: 'Jane', lastName: 'Doe', email: 'jane@doe.com', status: 'active' as const },
    ];
    const lodgings = [
      {
        id: 'lodging-1',
        userId: 'user-1',
        tripId: baseTrip.id,
        name: 'Hotel 1',
        checkInDate: '2026-01-02',
        checkOutDate: '2026-01-05',
        rooms: '1',
        refundBy: '',
        totalCost: '400',
        costPerNight: '100',
        address: '123 Main St',
        paidBy: ['member-1'],
        travelerIds: ['member-1'],
      },
    ];

    let tree: any;
    await act(async () => {
      tree = renderer.create(
        <OverviewTab
          {...baseProps}
          attendees={attendees}
          lodgings={lodgings as any}
          defaultPayerId="member-1"
        />
      );
    });
    const root = tree!.root;

    act(() => {
      pressByText(root, 'Edit');
    });

    act(() => {
      pressByText(root, 'Hotel 1');
    });

    const lodgingDialog = root.findByType(LodgingDialog);
    act(() => {
      pressByTextContainsWithin(lodgingDialog, 'Jane Doe');
    });

    await act(async () => {
      pressByTextWithin(lodgingDialog, 'Save');
    });

    const lodgingCall = fetchMock.mock.calls.find((call: any[]) => String(call[0]).includes('/api/lodgings/lodging-1'));
    if (!lodgingCall) {
      throw new Error('Expected lodging update request');
    }
    const options = lodgingCall[1];
    expect(options.method).toBe('PUT');
    const payload = JSON.parse(options.body);
    expect(payload.paidBy).toEqual(['member-1', 'member-2']);
  });
});
