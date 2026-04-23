import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { GroupInvite, PendingTripShareInvite } from '../types/invites';

type PendingInvitesModalProps = {
  visible: boolean;
  onClose: () => void;
  invites: GroupInvite[];
  pendingTripShareInvites: PendingTripShareInvite[];
  pendingFollowCode: string | null;
  acceptInvite: (invite: GroupInvite) => void;
  rejectInvite: (invite: GroupInvite) => void;
  acceptPendingTripShareInvite: (invite: PendingTripShareInvite) => void;
  rejectPendingTripShareInvite: (invite: PendingTripShareInvite) => void;
  acceptPendingFollowCode: () => void;
  rejectPendingFollowCode: () => void;
  styles: Record<string, any>;
};

/**
 * Modal that surfaces pending trip invites, trip-share invites, and a
 * follow-link prompt captured from a ?followCode= URL parameter. Extracted
 * verbatim from App.tsx — behavior unchanged, just moved into its own file
 * so App.tsx's JSX is smaller.
 */
const PendingInvitesModal: React.FC<PendingInvitesModalProps> = ({
  visible,
  onClose,
  invites,
  pendingTripShareInvites,
  pendingFollowCode,
  acceptInvite,
  rejectInvite,
  acceptPendingTripShareInvite,
  rejectPendingTripShareInvite,
  acceptPendingFollowCode,
  rejectPendingFollowCode,
  styles,
}) => {
  if (!visible) return null;
  return (
    <View style={styles.wizardOverlay}>
      <View
        style={[styles.wizardModal, styles.pendingInviteModal]}
        testID="invite-modal"
        accessible
        accessibilityRole="alert"
        accessibilityViewIsModal
        accessibilityLabel="Trip Invites"
      >
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Trip Invites
            </Text>
            <TouchableOpacity
              style={[styles.button, styles.smallButton]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close invites"
            >
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.helperText}>
            Choose which pending trip access requests you want to accept.
          </Text>
          <ScrollView style={styles.inviteList} contentContainerStyle={styles.inviteListContent}>
            {pendingFollowCode ? (
              <View style={styles.inviteCard}>
                <Text style={styles.bodyText}>Follow shared trip</Text>
                <Text style={styles.helperText}>
                  A follow link was opened for this account. Accept to start following the trip, or decline to remove it.
                </Text>
                <View style={styles.row}>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton]}
                    onPress={acceptPendingFollowCode}
                    testID="follow-link-accept"
                  >
                    <Text style={styles.buttonText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton, styles.dangerButton]}
                    onPress={rejectPendingFollowCode}
                    testID="follow-link-decline"
                  >
                    <Text style={styles.dangerButtonText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {pendingTripShareInvites.map((invite) => {
              const inviterName = `${invite.inviterFirstName ?? ''} ${invite.inviterLastName ?? ''}`.trim();
              const inviterLine = inviterName || invite.inviterEmail || 'Someone';
              const accessLabel = invite.role === 'member' ? 'member access' : 'follower access';
              return (
                <View key={invite.id} style={styles.inviteCard}>
                  <Text style={styles.bodyText}>{invite.tripName || 'Shared Trip'}</Text>
                  <Text style={styles.helperText}>Invited by {inviterLine}</Text>
                  <Text style={styles.helperText}>Access: {accessLabel}</Text>
                  <View style={styles.row}>
                    <TouchableOpacity
                      style={[styles.button, styles.smallButton]}
                      onPress={() => acceptPendingTripShareInvite(invite)}
                      testID={`share-invite-accept-${invite.id}`}
                    >
                      <Text style={styles.buttonText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.smallButton, styles.dangerButton]}
                      onPress={() => rejectPendingTripShareInvite(invite)}
                      testID={`share-invite-decline-${invite.id}`}
                    >
                      <Text style={styles.dangerButtonText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
            {invites.map((invite) => {
              const tripLabel = invite.resolvedTripName ?? invite.groupName ?? 'Upcoming Trip';
              const inviterName = `${invite.inviterFirstName ?? ''} ${invite.inviterLastName ?? ''}`.trim();
              const inviterLine = inviterName || invite.inviterEmail || 'Someone';
              return (
                <View key={invite.id} style={styles.inviteCard}>
                  <Text style={styles.bodyText}>{tripLabel}</Text>
                  <Text style={styles.helperText}>Invited by {inviterLine}</Text>
                  <View style={styles.row}>
                    <TouchableOpacity
                      style={[styles.button, styles.smallButton]}
                      onPress={() => acceptInvite(invite)}
                      testID={`invite-join-${invite.id}`}
                    >
                      <Text style={styles.buttonText}>Join</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.smallButton, styles.dangerButton]}
                      onPress={() => rejectInvite(invite)}
                      testID={`invite-decline-${invite.id}`}
                    >
                      <Text style={styles.dangerButtonText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </View>
  );
};

export default PendingInvitesModal;
