/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render } from '@testing-library/react-native';
import PaymentDialog from '../components/PaymentDialog';
import PendingInvitesModal from '../components/PendingInvitesModal';
import LodgingDetailsDialog from '../components/LodgingDetailsDialog';
import DropdownOptionButton from '../components/DropdownOptionButton';

const bareStyles: Record<string, any> = {
  modalOverlay: {},
  modalCard: {},
  expenseModalCard: {},
  sectionTitle: {},
  headerText: {},
  helperText: {},
  row: {},
  input: {},
  button: {},
  dangerButton: {},
  dangerButtonText: {},
  smallButton: {},
  buttonText: {},
  expenseToggleButton: {},
  expenseToggleSelected: {},
  expenseToggleUnselected: {},
  expenseToggleText: {},
  expenseToggleTextSelected: {},
  errorText: {},
  wizardOverlay: {},
  wizardModal: {},
  pendingInviteModal: {},
  sectionHeaderRow: {},
  card: {},
  bodyText: {},
  inviteList: {},
  inviteListContent: {},
  inviteCard: {},
  linkText: {},
  detailActionsRow: {},
};

describe('PaymentDialog accessibility', () => {
  it('labels the dialog overlay, header, and action buttons', () => {
    const { getByTestId, getByLabelText } = render(
      <PaymentDialog
        visible
        onCancel={() => {}}
        onSave={() => {}}
        participants={[]}
        sortedIds={['alice', 'bob']}
        participantLabel={(id) => (id === 'alice' ? 'Alice' : 'Bob')}
        defaultPayerId="alice"
        styles={bareStyles}
      />
    );
    const overlay = getByTestId('payment-dialog');
    expect(overlay.props.accessibilityRole).toBe('none');
    expect(overlay.props.accessibilityViewIsModal).toBe(true);
    expect(overlay.props.accessibilityLabel).toBe('Record Payment');

    expect(getByLabelText('Close payment dialog').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Save payment').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Cancel').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Payment amount').props.accessibilityLabel).toBe('Payment amount');
  });

  it('marks selected participant toggles via accessibilityState.selected', () => {
    const { getByTestId } = render(
      <PaymentDialog
        visible
        onCancel={() => {}}
        onSave={() => {}}
        participants={[]}
        sortedIds={['alice', 'bob']}
        participantLabel={(id) => (id === 'alice' ? 'Alice' : 'Bob')}
        defaultPayerId="alice"
        styles={bareStyles}
      />
    );
    // Platform.OS mock is 'ios', so the native toggle branch renders.
    const alicePayer = getByTestId('payment-payer-alice');
    const bobPayer = getByTestId('payment-payer-bob');
    expect(alicePayer.props.accessibilityRole).toBe('button');
    expect(alicePayer.props.accessibilityLabel).toBe('Payer: Alice');
    expect(alicePayer.props.accessibilityState).toEqual({ selected: true });
    expect(bobPayer.props.accessibilityState).toEqual({ selected: false });
  });
});

describe('PendingInvitesModal accessibility', () => {
  it('labels per-invite Accept/Decline buttons with the trip context', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <PendingInvitesModal
        visible
        onClose={onClose}
        invites={[
          {
            id: 'inv-1',
            groupName: 'Weekend Group',
            resolvedTripName: 'Italy 2026',
            inviterFirstName: 'Ada',
            inviterLastName: 'Lovelace',
            inviterEmail: null,
          } as any,
        ]}
        pendingTripShareInvites={[
          {
            id: 'share-1',
            tripName: 'Portugal Trip',
            role: 'member',
            inviterFirstName: 'Grace',
            inviterLastName: 'Hopper',
            inviterEmail: null,
          } as any,
        ]}
        pendingFollowCode={'FLW-1'}
        acceptInvite={() => {}}
        rejectInvite={() => {}}
        acceptPendingTripShareInvite={() => {}}
        rejectPendingTripShareInvite={() => {}}
        acceptPendingFollowCode={() => {}}
        rejectPendingFollowCode={() => {}}
        styles={bareStyles}
      />
    );
    expect(getByLabelText('Accept follow link').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Decline follow link').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Accept share invite to Portugal Trip').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Decline share invite to Portugal Trip').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Join Italy 2026').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Decline Italy 2026').props.accessibilityRole).toBe('button');
  });

  it('closes on Escape when visible', () => {
    const onClose = jest.fn();
    render(
      <PendingInvitesModal
        visible
        onClose={onClose}
        invites={[]}
        pendingTripShareInvites={[]}
        pendingFollowCode={null}
        acceptInvite={() => {}}
        rejectInvite={() => {}}
        acceptPendingTripShareInvite={() => {}}
        rejectPendingTripShareInvite={() => {}}
        acceptPendingFollowCode={() => {}}
        rejectPendingFollowCode={() => {}}
        styles={bareStyles}
      />
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('LodgingDetailsDialog accessibility', () => {
  const lodging: any = {
    id: 'lod-1',
    name: 'Hotel Europa',
    address: '123 Main St',
    checkInDate: '2026-06-01',
    checkOutDate: '2026-06-05',
    paidBy: [],
    travelerIds: [],
    totalCost: 0,
    costPerNight: 0,
    status: 'Booked',
  };

  it('labels the overlay, close button, and Edit/Delete with the lodging name', () => {
    const { getByTestId, getByLabelText } = render(
      <LodgingDetailsDialog
        visible
        lodging={lodging}
        attendees={[]}
        backendUrl="http://localhost"
        requestHeaders={{}}
        styles={bareStyles}
        payerName={() => ''}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onOpenMap={() => {}}
        testID="lodging-details"
      />
    );
    const overlay = getByTestId('lodging-details');
    expect(overlay.props.accessible).toBe(true);
    expect(overlay.props.accessibilityLabel).toBe('Lodging details: Hotel Europa');
    expect(getByLabelText('Close lodging details').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Edit Hotel Europa').props.accessibilityRole).toBe('button');
    expect(getByLabelText('Delete Hotel Europa').props.accessibilityRole).toBe('button');
  });

  it('closes on Escape', () => {
    const onClose = jest.fn();
    render(
      <LodgingDetailsDialog
        visible
        lodging={lodging}
        attendees={[]}
        backendUrl="http://localhost"
        requestHeaders={{}}
        styles={bareStyles}
        payerName={() => ''}
        onClose={onClose}
        onEdit={() => {}}
        onDelete={() => {}}
        onOpenMap={() => {}}
      />
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DropdownOptionButton accessibility', () => {
  it('exposes menuitem role and label with disabled state', () => {
    const { getByTestId } = render(
      <DropdownOptionButton
        styles={{ dropdownOption: {}, dropdownOptionHover: {}, dropdownOptionPressed: {} }}
        testID="opt-1"
        accessibilityLabel="Select option 1"
        disabled
      >
        {null}
      </DropdownOptionButton>
    );
    const btn = getByTestId('opt-1');
    expect(btn.props.accessibilityRole).toBe('menuitem');
    expect(btn.props.accessibilityLabel).toBe('Select option 1');
    expect(btn.props.accessibilityState).toEqual({ disabled: true });
  });
});
