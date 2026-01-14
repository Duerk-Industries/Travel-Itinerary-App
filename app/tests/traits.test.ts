import { describe, expect, test } from '@jest/globals';
import { traitOptions, toggleTraitState } from '../tabs/traitsLogic';

type Trait = { id?: string; name: string };

describe('Traits tab logic', () => {
  test('removing a default trait leaves it available but unselected', () => {
    const baseTrait = traitOptions[0];
    const state = {
      traits: [{ id: 'base-1', name: baseTrait }] as Trait[],
      selected: new Set<string>([baseTrait]),
    };

    const { nextSelected, nextTraits, removedTrait } = toggleTraitState(state, baseTrait);

    expect(nextSelected.has(baseTrait)).toBe(false);
    expect(nextTraits.some((t) => t.name === baseTrait)).toBe(true);
    expect(removedTrait?.id).toBe('base-1');
  });

  test('removing a custom trait deletes it from the list', () => {
    const custom = 'Mountain biking';
    const state = {
      traits: [{ id: 'custom-1', name: custom }] as Trait[],
      selected: new Set<string>([custom]),
    };

    const { nextSelected, nextTraits, removedTrait } = toggleTraitState(state, custom);

    expect(nextSelected.has(custom)).toBe(false);
    expect(nextTraits.some((t) => t.name === custom)).toBe(false);
    expect(removedTrait?.id).toBe('custom-1');
  });

  test('adding a custom trait selects it and stores it', () => {
    const custom = 'Kayaking';
    const state = { traits: [] as Trait[], selected: new Set<string>() };

    const { nextSelected, nextTraits } = toggleTraitState(state, custom);

    expect(nextSelected.has(custom)).toBe(true);
    expect(nextTraits.some((t) => t.name === custom)).toBe(true);
  });
});
