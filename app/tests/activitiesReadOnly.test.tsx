/**
 * @jest-environment node
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { ActivityTab, type Tour } from '../tabs/activities';

const styles = {
  card: {},
  sectionHeaderRow: {},
  sectionTitle: {},
  button: {},
  roundButton: {},
  buttonText: {},
  tableScroll: {},
  tableScrollContent: {},
  table: {},
  tableRow: {},
  tableHeader: {},
  cell: {},
  lastCell: {},
  headerText: {},
  actionCell: {},
  smallButton: {},
  dangerButton: {},
  dangerButtonText: {},
  cellText: {},
  flightTitle: {},
  helperText: {},
};

const tour: Tour = {
  id: 'tour-1',
  status: 'Proposed',
  activityType: 'Tour',
  date: '2026-09-02',
  name: 'Walking Tour',
  startLocation: 'Old Town',
  startTime: '10:00',
  duration: '2h',
  cost: '40',
  freeCancelBy: '',
  bookedOn: '',
  reference: 'TOUR1',
  paidBy: ['member-1'],
  travelerIds: ['member-1'],
  netVotes: 0,
  userVote: null,
  netRating: 0,
  userRating: null,
};

const groupMembers = [
  { id: 'member-1', firstName: 'Bryan', lastName: 'Traveler', email: 'bryan@example.com', status: 'active' as const },
];

describe('ActivityTab read-only mode', () => {
  test('removes add, edit, and delete controls for followed trips', () => {
    const { queryByTestId, getAllByText } = render(
      <ActivityTab
        backendUrl="http://localhost"
        userToken={null}
        activeTripId="trip-1"
        tours={[tour]}
        setTours={jest.fn()}
        defaultPayerId="member-1"
        payerName={() => 'Bryan Traveler'}
        formatMemberName={(member) => `${member.firstName} ${member.lastName}`}
        groupMembers={groupMembers}
        jsonHeaders={{}}
        payerTotals={{ 'member-1': 40 }}
        toursTotal={40}
        styles={styles as any}
        nativeDateTimePicker={null}
        fetchTours={jest.fn().mockResolvedValue(undefined)}
        readOnly
      />
    );

    expect(queryByTestId('activity-add')).toBeNull();
    expect(queryByTestId('activity-edit-tour-1')).toBeNull();
    expect(queryByTestId('activity-delete-tour-1')).toBeNull();
    expect(getAllByText('View only').length).toBeGreaterThan(0);
  });
});
