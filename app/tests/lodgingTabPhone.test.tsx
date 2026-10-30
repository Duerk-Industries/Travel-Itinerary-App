/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import * as ReactNative from 'react-native';
import { render } from '@testing-library/react-native';
import LodgingTab from '../tabs/LodgingTab';
import type { Lodging } from '../tabs/lodging';

const styles = new Proxy({}, { get: () => ({}) }) as Record<string, any>;

const groupMembers = [
  { id: 'm1', userId: 'u1', firstName: 'Maya', lastName: 'Chen', status: 'active' as const },
  { id: 'm2', userId: 'u2', firstName: 'Jordan', lastName: 'Reyes', status: 'active' as const },
  { id: 'm3', userId: 'u3', firstName: 'Priya', lastName: 'Patel', status: 'active' as const },
];

const lodgings: Lodging[] = [
  {
    id: 'l1', userId: 'u1', tripId: 't1', status: 'Booked', name: 'Alfama apartment', checkInDate: '2026-10-29', checkOutDate: '2026-11-02',
    rooms: '2', refundBy: '', totalCost: '1180', costPerNight: '', address: '', paidBy: ['m1'], travelerIds: ['m1', 'm2', 'm3'],
    upVotes: 3, downVotes: 0, upVoterIds: ['u1', 'u2', 'u3'], downVoterIds: [],
  },
  {
    id: 'l2', userId: 'u1', tripId: 't1', status: 'Proposed', name: 'Baixa hotel', checkInDate: '2026-10-29', checkOutDate: '2026-11-02',
    rooms: '2', refundBy: '', totalCost: '1420', costPerNight: '', address: '', paidBy: [], travelerIds: [],
    upVotes: 1, downVotes: 1, upVoterIds: ['u2'], downVoterIds: ['u3'], userVote: null,
  },
];

const renderTab = () =>
  render(
    <LodgingTab
      backendUrl=""
      jsonHeaders={{}}
      requestHeaders={{}}
      trip={{ id: 't1', startDate: '2026-10-29' }}
      lodgings={lodgings}
      groupMembers={groupMembers}
      defaultPayerId="m1"
      styles={styles}
      onOpenMap={() => {}}
      formatMemberName={() => ''}
      payerName={() => ''}
    />,
  );

describe('LodgingTab phone layout', () => {
  beforeEach(() => {
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 430, height: 932, scale: 3, fontScale: 1 });
  });
  afterEach(() => jest.restoreAllMocks());

  it('renders cards instead of the wide table', () => {
    const { getByTestId, queryByTestId } = renderTab();
    expect(getByTestId('lodging-cards')).toBeTruthy();
    expect(queryByTestId('lodging-table-horizontal-scroll')).toBeNull();
    expect(queryByTestId('lodging-add')).toBeNull();
    expect(queryByTestId('lodging-table-edit')).toBeNull();
  });

  it('keeps status badges but hides retired proposal votes', () => {
    const { queryByTestId, queryByText, getByText } = renderTab();
    expect(getByText('Booked')).toBeTruthy();
    expect(queryByTestId('lodging-votes-l1')).toBeNull();
    expect(queryByTestId('lodging-upvoters-l1-u1')).toBeNull();
    expect(queryByText('👍 Vote up')).toBeNull();
  });
});
