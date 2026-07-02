import { useCallback, useEffect, useState } from 'react';
import {
  fetchFollowedTripsApi,
  loadFollowCodes,
  loadFollowCodesAsync,
  loadFollowPayloads,
  loadFollowPayloadsAsync,
  saveFollowCodes,
  saveFollowCodesAsync,
  saveFollowPayloads,
  saveFollowPayloadsAsync,
  type FollowedTrip,
} from '../tabs/follow';
import type { InvitePayload } from '../utils/inviteCodes';
import { ApiClientError, requestJson } from '../utils/apiClient';
import { canAccessWebStorage, readAsync, removeAsync, writeAsync } from '../utils/persistentStorage';

export type { FollowedTrip };

export const pendingFollowCodeStorageKey = 'stp.pendingFollowCode';

const hasWindow = (): boolean => canAccessWebStorage();

const readPendingFollowCode = (): string | null => {
  if (!hasWindow()) return null;
  const stored = window.localStorage.getItem(pendingFollowCodeStorageKey)?.trim();
  return stored || null;
};

type UseFollowedTripsParams = {
  backendUrl: string;
  onUnauthorized?: () => void;
  userToken: string | null;
};

/**
 * Owns the "follow a trip by invite code" state cluster that App.tsx
 * previously managed inline:
 *   - `followedTrips` list + `fetchFollowedTrips` refresh
 *   - the enter-a-code form (`followInviteCode`, `followLoading`, `followError`)
 *     plus the `handleFollowTripByCode` action
 *   - per-trip generated share codes persisted to localStorage
 *   - `pendingFollowCode` captured from the login query param, persisted
 *     across reloads until consumed
 *
 * Selection state (`selectedFollowedTripId`/`selectedFollowedTripDetails`)
 * deliberately stays in App.tsx because it couples to the page router.
 */
export const useFollowedTrips = ({
  backendUrl,
  onUnauthorized,
  userToken,
}: UseFollowedTripsParams) => {
  const [followedTrips, setFollowedTrips] = useState<FollowedTrip[]>([]);
  const [followInviteCode, setFollowInviteCode] = useState('');
  const [followLoading, setFollowLoading] = useState(false);
  const [followError, setFollowError] = useState('');
  const [followCodes, setFollowCodes] = useState<Record<string, string>>(() =>
    hasWindow() ? loadFollowCodes() : {}
  );
  const [followCodeLoading, setFollowCodeLoading] = useState<Record<string, boolean>>({});
  const [followCodeError, setFollowCodeError] = useState<string | null>(null);
  const [followCodePayloads, setFollowCodePayloads] = useState<Record<string, InvitePayload>>(() =>
    hasWindow() ? loadFollowPayloads() : {}
  );
  const [pendingFollowCode, setPendingFollowCode] = useState<string | null>(() => readPendingFollowCode());

  // Native hydration: pull persisted follow codes/payloads/pendingCode from
  // AsyncStorage after the initial render. (Web reads them synchronously in
  // the useState initializers above.)
  useEffect(() => {
    if (hasWindow()) return;
    let cancelled = false;
    void (async () => {
      const [codes, payloads, pending] = await Promise.all([
        loadFollowCodesAsync(),
        loadFollowPayloadsAsync(),
        readAsync(pendingFollowCodeStorageKey),
      ]);
      if (cancelled) return;
      if (codes && Object.keys(codes).length) setFollowCodes(codes);
      if (payloads && Object.keys(payloads).length) setFollowCodePayloads(payloads);
      const trimmed = pending?.trim();
      if (trimmed) setPendingFollowCode(trimmed);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist generated codes + payloads on change (web sync, native async).
  useEffect(() => {
    if (hasWindow()) saveFollowCodes(followCodes);
    else void saveFollowCodesAsync(followCodes);
  }, [followCodes]);

  useEffect(() => {
    if (hasWindow()) saveFollowPayloads(followCodePayloads);
    else void saveFollowPayloadsAsync(followCodePayloads);
  }, [followCodePayloads]);

  // Persist pendingFollowCode so it survives a page reload between login
  // and the moment the user accepts/rejects the follow prompt.
  useEffect(() => {
    if (hasWindow()) {
      if (pendingFollowCode) {
        window.localStorage.setItem(pendingFollowCodeStorageKey, pendingFollowCode);
      } else {
        window.localStorage.removeItem(pendingFollowCodeStorageKey);
      }
      return;
    }
    if (pendingFollowCode) {
      void writeAsync(pendingFollowCodeStorageKey, pendingFollowCode);
    } else {
      void removeAsync(pendingFollowCodeStorageKey);
    }
  }, [pendingFollowCode]);

  const fetchFollowedTrips = useCallback(
    async (tokenOverride?: string): Promise<FollowedTrip[]> => {
      const authToken = tokenOverride ?? userToken;
      if (!authToken) {
        setFollowedTrips([]);
        return [];
      }
      try {
        const trips = await fetchFollowedTripsApi(backendUrl, {
          Authorization: `Bearer ${authToken}`,
        });
        setFollowedTrips(trips);
        return trips;
      } catch (err) {
        if ((err as { code?: string } | null)?.code === 'UNAUTHORIZED') {
          onUnauthorized?.();
        } else {
          setFollowedTrips([]);
        }
        return [];
      }
    },
    [backendUrl, onUnauthorized, userToken]
  );

  const handleFollowTripByCode = useCallback(
    async (inviteCode: string): Promise<string | null> => {
      if (!userToken) return 'You need to be logged in';
      const code = inviteCode.trim();
      if (!code) return 'Enter a follow code';
      setFollowLoading(true);
      setFollowError('');
      try {
        await requestJson(`${backendUrl}/api/trips/follow`, {
          body: { inviteCode: code },
          method: 'POST',
          token: userToken,
        });
        try {
          const trips = await fetchFollowedTripsApi(backendUrl, {
            Authorization: `Bearer ${userToken}`,
          });
          setFollowedTrips(trips);
        } catch {
          // ignore refresh failure after a successful follow
        }
        setFollowInviteCode('');
        setFollowError('');
        return null;
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          onUnauthorized?.();
          return 'Unauthorized';
        }
        const message =
          err instanceof ApiClientError
            ? err.message || 'Unable to follow trip'
            : (err as Error).message || 'Unable to follow trip';
        setFollowError(message);
        return message;
      } finally {
        setFollowLoading(false);
      }
    },
    [backendUrl, onUnauthorized, userToken]
  );

  const clearFollowedTripsData = useCallback(() => {
    setFollowedTrips([]);
    setFollowInviteCode('');
    setFollowError('');
    setFollowCodes({});
    setFollowCodeLoading({});
    setFollowCodeError(null);
    setFollowCodePayloads({});
    setPendingFollowCode(null);
  }, []);

  return {
    // state
    followedTrips,
    followInviteCode,
    followLoading,
    followError,
    followCodes,
    followCodeLoading,
    followCodeError,
    followCodePayloads,
    pendingFollowCode,
    // setters (FollowTab consumes several directly)
    setFollowedTrips,
    setFollowInviteCode,
    setFollowLoading,
    setFollowError,
    setFollowCodes,
    setFollowCodeLoading,
    setFollowCodeError,
    setFollowCodePayloads,
    setPendingFollowCode,
    // actions
    fetchFollowedTrips,
    handleFollowTripByCode,
    clearFollowedTripsData,
  };
};
