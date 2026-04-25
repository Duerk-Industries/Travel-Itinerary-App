import { useCallback, useEffect, useState } from 'react';

type GroupLike = { id: string };

export type CreateTripResult = { ok: boolean; error?: string; tripId?: string };

type UseCreateTripWizardParams = {
  groups: GroupLike[];
  createTrip: (params: { groupId: string; name: string }) => Promise<CreateTripResult>;
  userToken: string | null;
};

/**
 * Owns the small "name + group picker" state used by the Create Trip flow
 * that App.tsx had as two inline useStates. Also handles the default-group
 * effect that auto-picks the first group when none is selected, and adjusts
 * the selection when the selected group is removed from the list.
 *
 * Returns a `submit()` helper that performs the same validation App.tsx had
 * inline (requires auth, non-empty name, chosen group); it delegates the
 * actual POST to the passed-in `createTrip` (from `useTripsData`).
 */
export const useCreateTripWizard = ({
  groups,
  createTrip,
  userToken,
}: UseCreateTripWizardParams) => {
  const [newTripName, setNewTripName] = useState('');
  const [newTripGroupId, setNewTripGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (!newTripGroupId && groups.length) {
      setNewTripGroupId(groups[0].id);
      return;
    }
    if (newTripGroupId && !groups.some((group) => group.id === newTripGroupId)) {
      setNewTripGroupId(groups[0]?.id ?? null);
    }
  }, [groups, newTripGroupId]);

  const submit = useCallback(async (): Promise<CreateTripResult> => {
    if (!userToken) return { ok: false, error: 'Not signed in' };
    const name = newTripName.trim();
    if (!name || !newTripGroupId) {
      return { ok: false, error: 'Enter a trip name and choose a group' };
    }
    const result = await createTrip({ name, groupId: newTripGroupId });
    if (result.ok) {
      setNewTripName('');
    }
    return result;
  }, [createTrip, newTripGroupId, newTripName, userToken]);

  const clearWizard = useCallback(() => {
    setNewTripName('');
  }, []);

  return {
    newTripName,
    newTripGroupId,
    setNewTripName,
    setNewTripGroupId,
    submit,
    clearWizard,
  };
};
