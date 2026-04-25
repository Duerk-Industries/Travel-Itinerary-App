export interface GroupInvite {
  id: string;
  groupId: string;
  groupName?: string | null;
  inviterEmail?: string | null;
  inviterFirstName?: string | null;
  inviterLastName?: string | null;
  inviteeEmail?: string | null;
  status?: 'pending' | 'accepted';
  createdAt?: string;
  tripId?: string | null;
  resolvedTripId?: string | null;
  resolvedTripName?: string | null;
}

export interface PendingTripShareInvite {
  id: string;
  tripId: string;
  tripName: string;
  destination?: string | null;
  inviteeEmail?: string | null;
  inviterEmail?: string | null;
  inviterFirstName?: string | null;
  inviterLastName?: string | null;
  role: 'member' | 'follower';
  status: 'pending';
  createdAt?: string | null;
  expiresAt?: string | null;
}
