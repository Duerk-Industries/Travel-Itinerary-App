import { useEffect, useState } from 'react';
import type { Trip } from '../types/trips';
import type { FollowedTrip } from '../tabs/follow';
import { requestJson } from '../utils/apiClient';

type UseSelectedFollowedTripDetailsParams = {
  backendUrl: string;
  selectedFollowedTrip: FollowedTrip | null;
  selectedFollowedTripId: string | null;
  userToken: string | null;
};

/**
 * When a followed trip is selected, load its canonical `/api/trips/:id`
 * details so the rest of the app can render the full Trip shape rather than
 * the abbreviated `FollowedTrip` record. Falls back to a null state whenever
 * no trip is selected or the user is signed out, and cancels stale requests
 * if the selection changes mid-fetch.
 */
export const useSelectedFollowedTripDetails = ({
  backendUrl,
  selectedFollowedTrip,
  selectedFollowedTripId,
  userToken,
}: UseSelectedFollowedTripDetailsParams) => {
  const [selectedFollowedTripDetails, setSelectedFollowedTripDetails] = useState<Trip | null>(null);
  const fallbackTripName = selectedFollowedTrip?.tripName;
  const fallbackDestination = selectedFollowedTrip?.destination;

  useEffect(() => {
    if (!selectedFollowedTripId || !userToken) {
      setSelectedFollowedTripDetails(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await requestJson<any>(
          `${backendUrl}/api/trips/${selectedFollowedTripId}`,
          { token: userToken }
        );
        if (cancelled) return;
        if (data?.id) {
          setSelectedFollowedTripDetails({
            id: data.id,
            groupId: data.groupId ?? '',
            groupName: data.groupName ?? '',
            name: data.name ?? fallbackTripName ?? 'Trip',
            description: data.description ?? null,
            destination: data.destination ?? fallbackDestination ?? null,
            locationIds: Array.isArray(data.locationIds) ? data.locationIds : [],
            startDate: data.startDate ?? null,
            endDate: data.endDate ?? null,
            startMonth: data.startMonth ?? null,
            startYear: data.startYear ?? null,
            durationDays: data.durationDays ?? null,
            currency: data.currency ?? null,
            createdAt: data.createdAt ?? '',
          });
        } else {
          setSelectedFollowedTripDetails(null);
        }
      } catch {
        if (!cancelled) setSelectedFollowedTripDetails(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, fallbackDestination, fallbackTripName, selectedFollowedTripId, userToken]);

  return {
    selectedFollowedTripDetails,
    setSelectedFollowedTripDetails,
  };
};
