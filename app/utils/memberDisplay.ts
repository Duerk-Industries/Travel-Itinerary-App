export type DisplayableMember = {
  id: string;
  userId?: string | null;
  guestName?: string | null;
  email?: string | null;
  userEmail?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  status?: 'active' | 'pending' | 'removed' | string | null;
  removedAt?: string | null;
};

const normalizedEmail = (member: Pick<DisplayableMember, 'email' | 'userEmail'>): string =>
  String(member.email ?? member.userEmail ?? '').trim().toLowerCase();

export const formatMemberDisplayName = (member: Pick<
  DisplayableMember,
  'guestName' | 'email' | 'userEmail' | 'firstName' | 'lastName'
>): string => {
  const first = String(member.firstName ?? '').trim();
  const last = String(member.lastName ?? '').trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  const guest = String(member.guestName ?? '').trim();
  if (guest) return guest;

  const email = String(member.email ?? member.userEmail ?? '').trim();
  if (email) return email;

  return 'Traveler';
};

export const buildMemberDisplayLookup = <T extends DisplayableMember>(members: T[]): Map<string, string> => {
  const lookup = new Map<string, string>();
  members.forEach((member) => {
    const name = formatMemberDisplayName(member);
    [member.id, member.userId, member.email, member.userEmail]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .forEach((value) => {
        lookup.set(value, name);
        lookup.set(value.toLowerCase(), name);
      });
  });
  return lookup;
};

export const formatTravelerListDisplay = (
  ids: string[] | null | undefined,
  fallbackText: string | null | undefined,
  members: DisplayableMember[]
): string => {
  const lookup = buildMemberDisplayLookup(members);
  const resolvedIds = (ids ?? [])
    .map((id) => lookup.get(String(id).trim()) ?? lookup.get(String(id).trim().toLowerCase()))
    .filter(Boolean) as string[];
  if (resolvedIds.length) {
    return Array.from(new Set(resolvedIds)).join(', ');
  }

  return String(fallbackText ?? '')
    .split(',')
    .map((part) => {
      const value = part.trim();
      return lookup.get(value) ?? lookup.get(value.toLowerCase()) ?? value;
    })
    .filter(Boolean)
    .join(', ');
};

export const dedupeMembersByIdentity = <T extends DisplayableMember>(members: T[]): T[] => {
  const byKey = new Map<string, T>();
  const score = (member: T): number => {
    let total = 0;
    if (String(member.firstName ?? '').trim() || String(member.lastName ?? '').trim()) total += 8;
    if (String(member.guestName ?? '').trim()) total += 4;
    if (member.status === 'active') total += 3;
    if (!member.removedAt) total += 1;
    if (member.userId) total += 2;
    return total;
  };

  for (const member of members) {
    const key = normalizedEmail(member) || String(member.userId ?? member.id);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, member);
      continue;
    }
    const keep = score(member) > score(existing) ? member : existing;
    const mergeFrom = keep === member ? existing : member;
    byKey.set(key, {
      ...mergeFrom,
      ...keep,
      firstName: keep.firstName ?? mergeFrom.firstName,
      lastName: keep.lastName ?? mergeFrom.lastName,
      guestName: keep.guestName ?? mergeFrom.guestName,
      email: keep.email ?? mergeFrom.email,
      userEmail: keep.userEmail ?? mergeFrom.userEmail,
      userId: keep.userId ?? mergeFrom.userId,
      status: keep.status ?? mergeFrom.status,
      removedAt: keep.removedAt ?? mergeFrom.removedAt,
    });
  }

  return Array.from(byKey.values());
};
