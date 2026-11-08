import { useCallback, useRef, useState } from 'react';
import { fetchFamilyRelationships, fetchFellowTravelers, type FellowTraveler } from '../tabs/account';

type UseAccountSidecarsParams = {
  backendUrl: string;
  userToken: string | null;
};

/**
 * Owns the two "account sidecar" state slices that App.tsx held as separate
 * useStates + two thin useCallback wrappers around helpers in tabs/account:
 *
 *   - `familyRelationships` — list of family links the user has
 *   - `fellowTravelers`     — list of named companions for solo-booking flows
 *
 * `loadFamilyRelationships` / `loadFellowTravelers` accept an optional
 * token override (used during the login flow where `userToken` may not yet
 * be in state), mirroring the prior inline behavior.
 */
export const useAccountSidecars = ({ backendUrl, userToken }: UseAccountSidecarsParams) => {
  const scope = `${backendUrl}:${userToken}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const [familyRelationships, setFamilyRelationships] = useState<any[]>([]);
  const [fellowTravelers, setFellowTravelers] = useState<FellowTraveler[]>([]);

  const loadFamilyRelationships = useCallback(
    (token?: string) =>
      fetchFamilyRelationships({
        backendUrl,
        token: token ?? userToken,
        setFamilyRelationships: value => { if (scopeRef.current === scope) setFamilyRelationships(value); },
      }),
    [backendUrl, userToken]
  );

  const loadFellowTravelers = useCallback(
    (token?: string) =>
      fetchFellowTravelers({
        backendUrl,
        token: token ?? userToken,
        setFellowTravelers: value => { if (scopeRef.current === scope) setFellowTravelers(value); },
      }),
    [backendUrl, userToken]
  );

  const clearAccountSidecars = useCallback(() => {
    setFamilyRelationships([]);
    setFellowTravelers([]);
  }, []);

  return {
    familyRelationships,
    fellowTravelers,
    setFamilyRelationships,
    setFellowTravelers,
    loadFamilyRelationships,
    loadFellowTravelers,
    clearAccountSidecars,
  };
};
