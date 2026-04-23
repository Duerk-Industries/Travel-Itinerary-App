import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dedupeMembersByIdentity } from '../utils/memberDisplay';
import { ApiClientError, requestJson } from '../utils/apiClient';
import { loadLastActiveTripId } from '../utils/session';
import type { GroupMemberOption, GroupView, Trip } from '../types/trips';

type MutationResult = {
  ok: boolean;
  error?: string;
  tripId?: string;
};

type UseTripsDataParams = {
  activeTripId: string | null;
  backendUrl: string;
  groupSort: 'created' | 'name';
  isFollowingMode: boolean;
  onUnauthorized?: () => void;
  requirePasswordSetup: boolean;
  selectedFollowedTripDetails: Trip | null;
  setActiveTripId: Dispatch<SetStateAction<string | null>>;
  userEmail: string | null;
  userToken: string | null;
};

const normalizeGroupMember = (member: any): GroupMemberOption => ({
  id: member.id,
  userId: member.userId ?? undefined,
  guestName: member.guestName ?? member.guest_name ?? undefined,
  email: member.email ?? member.userEmail ?? undefined,
  userEmail: member.userEmail ?? member.email ?? undefined,
  firstName: member.firstName ?? member.first_name ?? undefined,
  lastName: member.lastName ?? member.last_name ?? undefined,
  status: member.status ?? undefined,
  removedAt: member.removedAt ?? undefined,
});

const normalizeGroup = (group: GroupView): GroupView => ({
  ...group,
  members: Array.isArray(group.members)
    ? dedupeMembersByIdentity(
        group.members.map((member) => ({
          ...member,
          email: member.email ?? member.userEmail ?? undefined,
          userEmail: member.userEmail ?? member.email ?? undefined,
          firstName: member.firstName ?? undefined,
          lastName: member.lastName ?? undefined,
        }))
      )
    : [],
  invites: Array.isArray(group.invites) ? group.invites : [],
});

const isUnauthorizedStatus = (status: number, requirePasswordSetup: boolean): boolean =>
  status === 401 || (status === 403 && !requirePasswordSetup);

export const useTripsData = ({
  activeTripId,
  backendUrl,
  groupSort,
  isFollowingMode,
  onUnauthorized,
  requirePasswordSetup,
  selectedFollowedTripDetails,
  setActiveTripId,
  userEmail,
  userToken,
}: UseTripsDataParams) => {
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMemberOption[]>([]);
  const suppressedGroupMemberFetchesRef = useRef<Map<string, string>>(new Map());

  const handleRequestError = useCallback(
    (error: unknown): string | undefined => {
      if (error instanceof ApiClientError) {
        if (isUnauthorizedStatus(error.status, requirePasswordSetup)) {
          onUnauthorized?.();
          return undefined;
        }
        if (error.status === 403) {
          return undefined;
        }
        return error.message;
      }
      return undefined;
    },
    [onUnauthorized, requirePasswordSetup]
  );

  const fetchGroups = useCallback(
    async (sort?: 'created' | 'name'): Promise<GroupView[]> => {
      if (!userToken) {
        setGroups([]);
        return [];
      }

      try {
        const data = await requestJson<GroupView[]>(
          `${backendUrl}/api/groups?sort=${sort ?? groupSort}`,
          { token: userToken }
        );
        const normalized = (Array.isArray(data) ? data : []).map(normalizeGroup);
        setGroups(normalized);
        return normalized;
      } catch (error) {
        handleRequestError(error);
        return [];
      }
    },
    [backendUrl, groupSort, handleRequestError, userToken]
  );

  const fetchTrips = useCallback(
    async (tokenOverride?: string): Promise<Trip[]> => {
      const authToken = tokenOverride ?? userToken;
      if (!authToken) {
        setTrips([]);
        return [];
      }

      try {
        const data = await requestJson<Trip[]>(`${backendUrl}/api/trips`, { token: authToken });
        const normalized = Array.isArray(data) ? data : [];
        setTrips(normalized);
        setActiveTripId((currentTripId) => {
          const preferredTripId = currentTripId ?? loadLastActiveTripId(userEmail ?? null);
          if (!preferredTripId && normalized.length) {
            return normalized[0].id;
          }
          if (preferredTripId && !isFollowingMode && !normalized.find((trip) => trip.id === preferredTripId)) {
            return normalized[0]?.id ?? null;
          }
          return currentTripId;
        });
        return normalized;
      } catch (error) {
        handleRequestError(error);
        return [];
      }
    },
    [backendUrl, handleRequestError, isFollowingMode, setActiveTripId, userEmail, userToken]
  );

  const fetchGroupMembersForActiveTrip = useCallback(async (): Promise<GroupMemberOption[]> => {
    if (!userToken || !activeTripId) {
      setGroupMembers([]);
      return [];
    }

    const trip = isFollowingMode ? selectedFollowedTripDetails : trips.find((item) => item.id === activeTripId) ?? null;
    const groupId = trip?.groupId;
    if (!groupId) {
      setGroupMembers([]);
      return [];
    }

    if (suppressedGroupMemberFetchesRef.current.has(groupId)) {
      setGroupMembers([]);
      return [];
    }

    try {
      const data = await requestJson<any[]>(`${backendUrl}/api/groups/${groupId}/members`, {
        token: userToken,
      });
      suppressedGroupMemberFetchesRef.current.delete(groupId);
      const normalized = dedupeMembersByIdentity((Array.isArray(data) ? data : []).map(normalizeGroupMember));
      const visibleMembers = normalized.filter((member) => member.status !== 'removed');
      setGroupMembers(visibleMembers);
      return visibleMembers;
    } catch (error) {
      if (error instanceof ApiClientError && isUnauthorizedStatus(error.status, requirePasswordSetup)) {
        onUnauthorized?.();
      } else if (error instanceof ApiClientError) {
        const message = String(error.message ?? `status ${error.status}`);
        suppressedGroupMemberFetchesRef.current.set(groupId, message);
        console.warn(`[groups] suppressing repeated member fetch for group=${groupId}: ${message}`);
      }
      setGroupMembers([]);
      return [];
    }
  }, [
    activeTripId,
    backendUrl,
    isFollowingMode,
    onUnauthorized,
    requirePasswordSetup,
    selectedFollowedTripDetails,
    trips,
    userToken,
  ]);

  useEffect(() => {
    suppressedGroupMemberFetchesRef.current.clear();
  }, [activeTripId]);

  useEffect(() => {
    if (userToken && !requirePasswordSetup) {
      void fetchGroupMembersForActiveTrip();
      return;
    }
    setGroupMembers([]);
  }, [fetchGroupMembersForActiveTrip, requirePasswordSetup, userToken]);

  const addMemberToGroup = useCallback(
    async (groupId: string, payload: Record<string, unknown>): Promise<MutationResult> => {
      if (!userToken) return { ok: false, error: 'Not signed in' };
      try {
        await requestJson(`${backendUrl}/api/groups/${groupId}/members`, {
          body: payload,
          method: 'POST',
          token: userToken,
        });
        await fetchGroups();
        if (activeTripId) {
          await fetchGroupMembersForActiveTrip();
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: handleRequestError(error) ?? 'Unable to add member' };
      }
    },
    [activeTripId, backendUrl, fetchGroupMembersForActiveTrip, fetchGroups, handleRequestError, userToken]
  );

  const removeMemberFromGroup = useCallback(
    async (groupId: string, memberId: string): Promise<MutationResult> => {
      if (!userToken) return { ok: false, error: 'Not signed in' };
      try {
        await requestJson(`${backendUrl}/api/groups/${groupId}/members/${memberId}`, {
          method: 'DELETE',
          token: userToken,
        });
        await fetchGroups();
        if (activeTripId) {
          await fetchGroupMembersForActiveTrip();
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: handleRequestError(error) ?? 'Unable to remove member' };
      }
    },
    [activeTripId, backendUrl, fetchGroupMembersForActiveTrip, fetchGroups, handleRequestError, userToken]
  );

  const cancelInvite = useCallback(
    async (inviteId: string): Promise<MutationResult> => {
      if (!userToken) return { ok: false, error: 'Not signed in' };
      try {
        await requestJson(`${backendUrl}/api/groups/invites/${inviteId}`, {
          method: 'DELETE',
          token: userToken,
        });
        await fetchGroups();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: handleRequestError(error) ?? 'Unable to cancel invite' };
      }
    },
    [backendUrl, fetchGroups, handleRequestError, userToken]
  );

  const createTrip = useCallback(
    async (params: { groupId: string; name: string }): Promise<MutationResult> => {
      if (!userToken) return { ok: false, error: 'Not signed in' };
      try {
        const data = await requestJson<{ id?: string }>(`${backendUrl}/api/trips`, {
          body: { groupId: params.groupId, name: params.name },
          method: 'POST',
          token: userToken,
        });
        if (data?.id) {
          setActiveTripId(data.id);
        }
        await fetchTrips();
        return { ok: true, tripId: data?.id };
      } catch (error) {
        return { ok: false, error: handleRequestError(error) ?? 'Unable to create trip' };
      }
    },
    [backendUrl, fetchTrips, handleRequestError, setActiveTripId, userToken]
  );

  const clearTripsData = useCallback(() => {
    setGroups([]);
    setTrips([]);
    setGroupMembers([]);
    suppressedGroupMemberFetchesRef.current.clear();
  }, []);

  return {
    addMemberToGroup,
    cancelInvite,
    clearTripsData,
    createTrip,
    fetchGroups,
    fetchGroupMembersForActiveTrip,
    fetchTrips,
    groupMembers,
    groups,
    removeMemberFromGroup,
    trips,
  };
};
