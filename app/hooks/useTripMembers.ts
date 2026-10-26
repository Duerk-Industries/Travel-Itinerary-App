import { useMemo } from 'react';
import type { GroupMemberOption } from '../tabs/transfers';

export interface TripMembersDerivation {
  /** Group members filtered down to "real" users — excludes guest entries and removed members. */
  userMembers: GroupMemberOption[];
  /** Stable array of user-member ids, memoized so cost-calculation helpers can depend on it. */
  memberIds: string[];
  /** The signed-in user's member id in the current trip's group, or null if not a member. */
  currentUserMemberId: string | null;
  /** Trip creator when still a traveler, else the signed-in user or first active traveler. */
  defaultPayerId: string | null;
}

/**
 * Derives trip-member-related values from the current `groupMembers` list +
 * the signed-in user's email. Previously lived as four adjacent `useMemo`
 * blocks in App.tsx; pulled into a hook so consumers (the car-rentals panel
 * in the near term, extracted tabs in the longer term) can opt in without
 * carrying all of App.tsx's context.
 *
 * Cheap to call — each selector is a `useMemo` with stable dependencies.
 */
export function useTripMembers(
  groupMembers: GroupMemberOption[],
  userEmail: string | null | undefined,
  tripCreatorId?: string | null,
): TripMembersDerivation {
  const userMembers = useMemo(
    () => groupMembers.filter((m) => !m.guestName && m.status !== 'removed'),
    [groupMembers],
  );

  const memberIds = useMemo(() => userMembers.map((m) => m.id), [userMembers]);

  const currentUserMemberId = useMemo(() => {
    if (!userEmail) return null;
    const normalized = userEmail.toLowerCase();
    const match = userMembers.find((m) => m.email && m.email.toLowerCase() === normalized);
    return match?.id ?? null;
  }, [userMembers, userEmail]);

  const defaultPayerId = useMemo(() => {
    const creator = tripCreatorId ? userMembers.find((member) => member.userId === tripCreatorId) : null;
    if (creator) return creator.id;
    if (currentUserMemberId) return currentUserMemberId;
    if (userMembers.length) return userMembers[0].id;
    return null;
  }, [currentUserMemberId, userMembers, tripCreatorId]);

  return { userMembers, memberIds, currentUserMemberId, defaultPayerId };
}
