import { useCallback, useState } from 'react';
import { type Trait } from '../tabs/traits';
import { requestJson } from '../utils/apiClient';

export type TraitGender = 'female' | 'male' | 'nonbinary' | 'prefer-not';

const isTraitGender = (value: unknown): value is TraitGender =>
  value === 'female' || value === 'male' || value === 'nonbinary' || value === 'prefer-not';

type UseTraitsParams = {
  backendUrl: string;
  userToken: string | null;
};

/**
 * Owns the traits + demographics state cluster that App.tsx previously held
 * as six separate useState calls plus two inline fetcher useCallbacks:
 *
 *   - `traits` + `setTraits` — the list from /api/traits
 *   - `newTraitName` — add-trait input
 *   - `selectedTraitNames` — Set<string> of trait names the user has opted
 *     into (seeded from `traits` on fetch)
 *   - `traitAge`, `traitGender`, `showGenderDropdown` — the demographics form
 *
 * `fetchTraits` and `fetchTraitProfile` are preserved so existing callers
 * (login + refresh effects) keep their behavior.
 */
export const useTraits = ({ backendUrl, userToken }: UseTraitsParams) => {
  const [traits, setTraits] = useState<Trait[]>([]);
  const [newTraitName, setNewTraitName] = useState('');
  const [selectedTraitNames, setSelectedTraitNames] = useState<Set<string>>(new Set());
  const [traitAge, setTraitAge] = useState('');
  const [traitGender, setTraitGender] = useState<TraitGender>('prefer-not');
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);

  const fetchTraits = useCallback(async (): Promise<void> => {
    if (!userToken) return;
    try {
      const data = await requestJson<Trait[]>(`${backendUrl}/api/traits`, { token: userToken });
      const list = Array.isArray(data) ? data : [];
      setTraits(list);
      setSelectedTraitNames(new Set(list.map((t) => t.name)));
    } catch {
      // preserve prior inline behavior: silent failure keeps existing state
    }
  }, [backendUrl, userToken]);

  const fetchTraitProfile = useCallback(async (): Promise<void> => {
    if (!userToken) return;
    try {
      const raw = await requestJson<{ age?: unknown; gender?: unknown } | null>(
        `${backendUrl}/api/traits/profile/demographics`,
        { token: userToken }
      );
      const data = raw ?? {};
      if (data.age != null) setTraitAge(String(data.age));
      if (isTraitGender(data.gender)) setTraitGender(data.gender);
    } catch {
      // same as above — leave existing state untouched on failure
    }
  }, [backendUrl, userToken]);

  const clearTraitsState = useCallback(() => {
    setTraits([]);
    setNewTraitName('');
    setSelectedTraitNames(new Set());
    setTraitAge('');
    setTraitGender('prefer-not');
    setShowGenderDropdown(false);
  }, []);

  return {
    // state
    traits,
    newTraitName,
    selectedTraitNames,
    traitAge,
    traitGender,
    showGenderDropdown,
    // setters
    setTraits,
    setNewTraitName,
    setSelectedTraitNames,
    setTraitAge,
    setTraitGender,
    setShowGenderDropdown,
    // actions
    fetchTraits,
    fetchTraitProfile,
    clearTraitsState,
  };
};
