/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import PendingInvitesModal from '../components/PendingInvitesModal';
import type { GroupInvite, PendingTripShareInvite } from '../types/invites';

const styles: Record<string, any> = {
  wizardOverlay: {},
  wizardModal: {},
  pendingInviteModal: {},
  card: {},
  sectionHeaderRow: {},
  sectionTitle: {},
  helperText: {},
  inviteList: {},
  inviteListContent: {},
  inviteCard: {},
  bodyText: {},
  row: {},
  button: {},
  smallButton: {},
  dangerButton: {},
  buttonText: {},
  dangerButtonText: {},
};

const baseProps = {
  visible: true,
  onClose: () => {},
  invites: [] as GroupInvite[],
  pendingTripShareInvites: [] as PendingTripShareInvite[],
  pendingFollowCode: null as string | null,
  acceptInvite: () => {},
  rejectInvite: () => {},
  acceptPendingTripShareInvite: () => {},
  rejectPendingTripShareInvite: () => {},
  acceptPendingFollowCode: () => {},
  rejectPendingFollowCode: () => {},
  styles,
};

describe('PendingInvitesModal', () => {
  it('renders nothing when visible=false', () => {
    const { queryByTestId } = render(
      <PendingInvitesModal {...baseProps} visible={false} />
    );
    expect(queryByTestId('invite-modal')).toBeNull();
  });

  it('renders the modal shell with accessibility labels when visible', () => {
    const { getByTestId, getByLabelText } = render(<PendingInvitesModal {...baseProps} />);
    const modal = getByTestId('invite-modal');
    expect(modal.props.accessibilityRole).toBe('alert');
    expect(modal.props.accessibilityViewIsModal).toBe(true);
    expect(modal.props.accessibilityLabel).toBe('Trip Invites');
    // Close button is labelled for screen readers
    expect(getByLabelText('Close invites')).toBeTruthy();
  });

  it('fires onClose when the close button is pressed', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <PendingInvitesModal {...baseProps} onClose={onClose} />
    );
    fireEvent.press(getByLabelText('Close invites'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the follow-link card when pendingFollowCode is set', () => {
    const acceptFollow = jest.fn();
    const rejectFollow = jest.fn();
    const { getByTestId } = render(
      <PendingInvitesModal
        {...baseProps}
        pendingFollowCode="ABC123"
        acceptPendingFollowCode={acceptFollow}
        rejectPendingFollowCode={rejectFollow}
      />
    );
    fireEvent.press(getByTestId('follow-link-accept'));
    fireEvent.press(getByTestId('follow-link-decline'));
    expect(acceptFollow).toHaveBeenCalledTimes(1);
    expect(rejectFollow).toHaveBeenCalledTimes(1);
  });

  it('renders one row per trip-share invite and wires accept/decline per id', () => {
    const accept = jest.fn();
    const reject = jest.fn();
    const invite: PendingTripShareInvite = {
      id: 'share-1',
      tripId: 't-1',
      tripName: 'Rome',
      role: 'member',
      status: 'pending',
    };
    const { getByTestId } = render(
      <PendingInvitesModal
        {...baseProps}
        pendingTripShareInvites={[invite]}
        acceptPendingTripShareInvite={accept}
        rejectPendingTripShareInvite={reject}
      />
    );
    fireEvent.press(getByTestId('share-invite-accept-share-1'));
    fireEvent.press(getByTestId('share-invite-decline-share-1'));
    expect(accept).toHaveBeenCalledWith(invite);
    expect(reject).toHaveBeenCalledWith(invite);
  });

  it('renders one row per group invite and wires join/decline per id', () => {
    const accept = jest.fn();
    const reject = jest.fn();
    const invite: GroupInvite = {
      id: 'inv-9',
      groupId: 'g-9',
      resolvedTripName: 'Italy Adventure',
    };
    const { getByTestId } = render(
      <PendingInvitesModal
        {...baseProps}
        invites={[invite]}
        acceptInvite={accept}
        rejectInvite={reject}
      />
    );
    fireEvent.press(getByTestId('invite-join-inv-9'));
    fireEvent.press(getByTestId('invite-decline-inv-9'));
    expect(accept).toHaveBeenCalledWith(invite);
    expect(reject).toHaveBeenCalledWith(invite);
  });
});
