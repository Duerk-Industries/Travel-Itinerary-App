export type TraitRecord = { id?: string; name: string; level?: number; notes?: string | null; createdAt?: string };

export const traitOptions: string[] = [
  'Adventurous',
  'Hiking',
  'Cafes',
  'Relaxing',
  'Beaches',
  'Nightlife',
  'Cultural',
  'Foodie',
  'Road Trips',
  'Museums',
  'Luxury',
  'Budget',
  'Outdoorsy',
  'Photography',
  'Family Friendly',
  'Solo Travel',
];

type ToggleState<T extends TraitRecord> = {
  traits: T[];
  selected: Set<string>;
};

export const toggleTraitState = <T extends TraitRecord>(
  state: ToggleState<T>,
  name: string,
  baseOptions: string[] = traitOptions
): { nextSelected: Set<string>; nextTraits: T[]; removedTrait?: T } => {
  const isBase = baseOptions.includes(name);
  const existing = state.traits.find((t) => t.name === name);
  const nextSelected = new Set(state.selected);
  const nextTraits: T[] = state.traits.slice();
  let removedTrait: T | undefined;

  if (nextSelected.has(name)) {
    nextSelected.delete(name);
    if (!isBase && existing) {
      removedTrait = existing;
      return {
        nextSelected,
        nextTraits: nextTraits.filter((t) => t.name !== name),
        removedTrait,
      };
    }
    if (existing) {
      removedTrait = existing;
    }
    return { nextSelected, nextTraits, removedTrait };
  }

  nextSelected.add(name);
  if (!isBase && !existing) {
    nextTraits.push({ name } as T);
  }
  return { nextSelected, nextTraits };
};

