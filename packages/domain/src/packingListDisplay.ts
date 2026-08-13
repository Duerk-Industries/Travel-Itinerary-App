import { normalizePackingLabel } from './packingListNormalize';

export type PackingDisplayKind = 'preset' | 'trip_manual' | 'multiple_travelers' | 'personal';

export type PackingDisplayItem = {
  id: string;
  category: string;
  label: string;
  position: number;
  packedBy?: string[];
  normalizedLabel?: string;
  personalOwnerIds?: string[];
  [key: string]: unknown;
};

export type PackingDisplayInputGroup = {
  key: string;
  label: string;
  kind: PackingDisplayKind;
  order?: number;
  ownerMemberId?: string | null;
  items: PackingDisplayItem[];
};

export type PackingDisplayGroup = Omit<PackingDisplayInputGroup, 'items'> & {
  items: PackingDisplayItem[];
};

const kindRank: Record<PackingDisplayKind, number> = {
  preset: 0,
  trip_manual: 1,
  multiple_travelers: 2,
  personal: 3,
};

const presetRank = (key: string): number => {
  const normalized = key.toLowerCase();
  if (normalized === 'general') return 0;
  if (normalized === 'women') return 1;
  if (normalized === 'men') return 2;
  return 3;
};

/**
 * Orders and deduplicates materialized source groups. The first occurrence of
 * a normalized label owns the displayed row and its packed state.
 */
export const buildPackingListDisplayGroups = (
  inputGroups: PackingDisplayInputGroup[],
  currentTravelerId?: string | null
): PackingDisplayGroup[] => {
  const personalOwners = new Map<string, Set<string>>();
  for (const group of inputGroups) {
    if (group.kind !== 'personal') continue;
    for (const item of group.items) {
      const key = item.normalizedLabel || normalizePackingLabel(item.label);
      const owners = personalOwners.get(key) ?? new Set<string>();
      for (const ownerId of item.personalOwnerIds ?? (group.ownerMemberId ? [group.ownerMemberId] : [])) {
        owners.add(ownerId);
      }
      personalOwners.set(key, owners);
    }
  }

  const groups = inputGroups
    .map((group) => ({ ...group, items: [...group.items] }))
    .sort((a, b) => {
      const aRank = kindRank[a.kind];
      const bRank = kindRank[b.kind];
      if (aRank !== bRank) return aRank - bRank;
      if (a.kind === 'preset' && b.kind === 'preset') {
        const presetOrder = presetRank(a.key) - presetRank(b.key);
        if (presetOrder !== 0) return presetOrder;
      }
      if (a.kind === 'personal' && b.kind === 'personal') {
        if (a.ownerMemberId === currentTravelerId) return -1;
        if (b.ownerMemberId === currentTravelerId) return 1;
      }
      return (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label);
    });

  const sharedGroup: PackingDisplayInputGroup = {
    key: 'multiple_travelers',
    label: 'Multiple Travelers',
    kind: 'multiple_travelers',
    order: 0,
    items: [],
  };
  const seen = new Set<string>();
  const result: PackingDisplayGroup[] = [];
  const categoryGroups = new Map<string, PackingDisplayGroup>();

  for (const group of groups) {
    const remaining: PackingDisplayItem[] = [];
    for (const item of group.items) {
      const normalizedLabel = item.normalizedLabel || normalizePackingLabel(item.label);
      if (!normalizedLabel || seen.has(normalizedLabel)) continue;
      seen.add(normalizedLabel);
      const withIdentity = { ...item, normalizedLabel };
      if (group.kind === 'personal' && (personalOwners.get(normalizedLabel)?.size ?? 0) >= 2) {
        sharedGroup.items.push(withIdentity);
      } else {
        remaining.push({ ...withIdentity, category: item.category?.trim() || group.label });
      }
    }
    for (const item of remaining) {
      const category = item.category.trim() || group.label;
      const categoryKey = category.toLocaleLowerCase();
      const existing = categoryGroups.get(categoryKey);
      if (existing) {
        existing.items.push({ ...item, category: existing.label });
      } else {
        const categoryGroup = { ...group, label: category, items: [{ ...item, category }] };
        categoryGroups.set(categoryKey, categoryGroup);
        result.push(categoryGroup);
      }
    }
  }
  for (const item of sharedGroup.items) {
    const category = item.category?.trim() || sharedGroup.label;
    const categoryKey = category.toLocaleLowerCase();
    const existing = categoryGroups.get(categoryKey);
    if (existing) {
      existing.items.push({ ...item, category: existing.label });
    } else {
      const categoryGroup = { ...sharedGroup, key: 'multiple_travelers', label: category, items: [{ ...item, category }] };
      categoryGroups.set(categoryKey, categoryGroup);
      result.push(categoryGroup);
    }
  }
  return result;
};
