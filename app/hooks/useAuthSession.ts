import { useCallback, useState } from 'react';

export type UserRole = 'user' | 'admin';

export type SessionPayload = {
  token: string;
  name: string | null;
  email: string | null;
  userId: string | null;
  role: UserRole;
};

/**
 * Owns the core user-identity state cluster that App.tsx previously held as
 * five separate `useState` calls:
 *   - userToken   : JWT for all API requests
 *   - userName    : display name shown in the top bar
 *   - userEmail   : primary email, used to seed the members list
 *   - userId      : server-side user id
 *   - userRole    : 'user' | 'admin' — gates the admin tab
 *
 * The hook intentionally keeps the same variable names and setter shapes so
 * existing call sites (162 references across App.tsx) don't need to be
 * touched. `applySession` / `clearSessionState` are convenience helpers for
 * the three places (login, session restore, logout) that mutate all five at
 * once.
 *
 * `lastRefreshAt` / `isRefreshing` are NOT owned here — they belong to the
 * refresh-polling lifecycle, not the identity cluster, and stay in App.tsx.
 */
export const useAuthSession = () => {
  const [userToken, setUserToken] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('user');

  const clearSessionState = useCallback(() => {
    setUserToken(null);
    setUserName(null);
    setUserEmail(null);
    setUserId(null);
    setUserRole('user');
  }, []);

  const applySession = useCallback((payload: SessionPayload) => {
    setUserToken(payload.token);
    setUserName(payload.name);
    setUserEmail(payload.email);
    setUserId(payload.userId);
    setUserRole(payload.role);
  }, []);

  return {
    // state
    userToken,
    userName,
    userEmail,
    userId,
    userRole,
    // raw setters (preserved for existing call sites)
    setUserToken,
    setUserName,
    setUserEmail,
    setUserId,
    setUserRole,
    // convenience helpers
    applySession,
    clearSessionState,
  };
};
