import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../../packages/messaging/src/events';
import type { PresenceUser } from '../../packages/messaging/src/types';
import { getSocket } from '../utils/socket';

type PresenceContextValue = {
  presenceUsers: PresenceUser[];
};

const PresenceContext = createContext<PresenceContextValue>({ presenceUsers: [] });

type PresenceProviderProps = {
  activeTripId: string | null;
  userToken: string | null;
  children: React.ReactNode;
};

/**
 * Owns the live presence list for the active trip. Isolates the socket
 * PRESENCE_UPDATE subscription so that frequent heartbeat updates only
 * re-render components that actually consume `usePresenceUsers()` — not
 * every descendant of the provider.
 */
export const PresenceProvider: React.FC<PresenceProviderProps> = ({ activeTripId, userToken, children }) => {
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!userToken || !activeTripId) {
      setPresenceUsers([]);
      return;
    }
    const socket = getSocket();
    const presenceListsEqual = (a: PresenceUser[], b: PresenceUser[]): boolean => {
      if (a === b) return true;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        const av = a[i];
        const bv = b[i];
        if (av.userId !== bv.userId || av.color !== bv.color || av.initials !== bv.initials) {
          return false;
        }
      }
      return true;
    };
    const onPresence = (list: PresenceUser[]) =>
      // Skip the state update (and the consumer re-render it would trigger)
      // when the server's list matches the previous one byte-for-byte. The
      // server emits PRESENCE_UPDATE on join/leave, so duplicates are rare,
      // but reconnect storms can still send several identical lists in a
      // row.
      setPresenceUsers((prev) => (presenceListsEqual(prev, list) ? prev : list));
    const joinOnConnect = () => {
      socket.emit(CLIENT_EVENTS.JOIN_TRIP, activeTripId);
    };
    socket.on(SERVER_EVENTS.PRESENCE_UPDATE, onPresence);
    if (socket.connected) {
      socket.emit(CLIENT_EVENTS.JOIN_TRIP, activeTripId);
    } else {
      socket.once('connect', joinOnConnect);
    }
    return () => {
      socket.off(SERVER_EVENTS.PRESENCE_UPDATE, onPresence);
      // socket.io stores .once handlers in the same listener list as .on,
      // so .off removes them whether or not 'connect' has already fired.
      socket.off('connect', joinOnConnect);
    };
  }, [activeTripId, userToken]);

  const value = useMemo<PresenceContextValue>(() => ({ presenceUsers }), [presenceUsers]);

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
};

export const usePresenceUsers = (): PresenceUser[] => useContext(PresenceContext).presenceUsers;
