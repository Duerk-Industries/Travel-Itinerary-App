import { formatMemberDisplayName, type DisplayableMember } from './memberDisplay';

export const singlePayerIds = (ids?: readonly string[] | null, defaultId?: string | null): string[] => {
  const id = ids?.find(value => !!value) ?? defaultId;
  return id ? [id] : [];
};

export const payerOptions = <T extends DisplayableMember>(members: readonly T[], label: (member: T) => string = formatMemberDisplayName) =>
  members.filter(member => member.status !== 'removed' && !member.removedAt)
    .map(member => ({ value: member.id, label: label(member) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }) || a.value.localeCompare(b.value));
