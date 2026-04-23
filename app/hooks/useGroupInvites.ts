import { useCallback, useState } from 'react';
import { ApiClientError, requestJson } from '../utils/apiClient';
import type { GroupInvite, PendingTripShareInvite } from '../types/invites';

export type { GroupInvite, PendingTripShareInvite };

export type InviteActionResult =
  | { ok: true; nextTripId?: string | null }
  | { ok: false; error: string };

type UseGroupInvitesParams = {
  backendUrl: string;
  userToken: string | null;
};

/**
 * Owns the two invite-queue state clusters that the top-level App component
 * previously managed inline: group-member invites (`GET /api/groups/invites`)
 * and trip-share invites (`GET /api/trips/share/invites/pending`), plus the
 * accept/reject mutations for each.
 *
 * Returns plain `InviteActionResult` values so the caller can thread refresh
 * fan-out (trips, groups, followed trips) through its own hooks without
 * coupling this hook to them.
 */
export const useGroupInvites = ({ backendUrl, userToken }: UseGroupInvitesParams) => {
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [pendingTripShareInvites, setPendingTripShareInvites] = useState<
    PendingTripShareInvite[]
  >([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);

  const fetchInvites = useCallback(
    async (tokenOverride?: string): Promise<GroupInvite[]> => {
      const authToken = tokenOverride ?? userToken;
      if (!authToken) {
        setInvites([]);
        setInvitesLoaded(true);
        return [];
      }
      try {
        const data = await requestJson<GroupInvite[]>(`${backendUrl}/api/groups/invites`, {
          token: authToken,
        });
        const list = Array.isArray(data) ? data : [];
        setInvites(list);
        return list;
      } catch {
        setInvites([]);
        return [];
      } finally {
        setInvitesLoaded(true);
      }
    },
    [backendUrl, userToken]
  );

  const fetchPendingTripShareInvites = useCallback(
    async (tokenOverride?: string): Promise<PendingTripShareInvite[]> => {
      const authToken = tokenOverride ?? userToken;
      if (!authToken) {
        setPendingTripShareInvites([]);
        return [];
      }
      try {
        const data = await requestJson<{ invites?: PendingTripShareInvite[] }>(
          `${backendUrl}/api/trips/share/invites/pending`,
          { token: authToken }
        );
        const list = Array.isArray(data?.invites) ? data.invites : [];
        setPendingTripShareInvites(list);
        return list;
      } catch {
        setPendingTripShareInvites([]);
        return [];
      }
    },
    [backendUrl, userToken]
  );

  const errorMessageFromAction = async (err: unknown, fallback: string): Promise<string> => {
    if (err instanceof ApiClientError) {
      return err.message || fallback;
    }
    return fallback;
  };

  const acceptInvite = useCallback(
    async (invite: GroupInvite): Promise<InviteActionResult> => {
      if (!userToken) return { ok: false, error: 'Not signed in' };
      try {
        await requestJson(`${backendUrl}/api/groups/invites/${invite.id}/accept`, {
          method: 'POST',
          token: userToken,
        });
        await fetchInvites();
        return { ok: true, nextTripId: invite.tripId ?? invite.resolvedTripId ?? null };
      } catch (err) {
        return { ok: false, error: await errorMessageFromAction(err, 'Unable to accept invite') };
      }
    },
    [backendUrl, fetchInvites, userToken]
  );

  const rejectInvite = useCallback(
    async (invite: GroupInvite): Promise<InviteActionResult> => {
      if (!userToken) return { ok: false, error: 'Not signed in' };
      try {
        await requestJson(`${backendUrl}/api/groups/invites/${invite.id}/reject`, {
          method: 'POST',
          token: userToken,
        });
        await fetchInvites();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: await errorMessageFromAction(err, 'Unable to reject invite') };
      }
    },
    [backendUrl, fetchInvites, userToken]
  );

  const acceptPendingTripShareInvite = useCallback(
    async (invite: PendingTripShareInvite): Promise<InviteActionResult> => {
      if (!userToken) return { ok: false, error: 'Not signed in' };
      try {
        await requestJson(`${backendUrl}/api/trips/share/invites/${invite.id}/accept`, {
          method: 'POST',
          token: userToken,
        });
        setPendingTripShareInvites((prev) => prev.filter((entry) => entry.id !== invite.id));
        await fetchPendingTripShareInvites();
        return { ok: true, nextTripId: invite.tripId ?? null };
      } catch (err) {
        return { ok: false, error: await errorMessageFromAction(err, 'Unable to accept invite') };
      }
    },
    [backendUrl, fetchPendingTripShareInvites, userToken]
  );

  const rejectPendingTripShareInvite = useCallback(
    async (invite: PendingTripShareInvite): Promise<InviteActionResult> => {
      if (!userToken) return { ok: false, error: 'Not signed in' };
      try {
        await requestJson(`${backendUrl}/api/trips/share/invites/${invite.id}/reject`, {
          method: 'POST',
          token: userToken,
        });
        setPendingTripShareInvites((prev) => prev.filter((entry) => entry.id !== invite.id));
        await fetchPendingTripShareInvites();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: await errorMessageFromAction(err, 'Unable to reject invite') };
      }
    },
    [backendUrl, fetchPendingTripShareInvites, userToken]
  );

  const clearInvites = useCallback(() => {
    setInvites([]);
    setPendingTripShareInvites([]);
    setInvitesLoaded(false);
  }, []);

  return {
    invites,
    invitesLoaded,
    pendingTripShareInvites,
    fetchInvites,
    fetchPendingTripShareInvites,
    acceptInvite,
    rejectInvite,
    acceptPendingTripShareInvite,
    rejectPendingTripShareInvite,
    clearInvites,
    setInvitesLoaded,
    setPendingTripShareInvites,
  };
};
