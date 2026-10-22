import type { PlanningMapPoint } from '../../server/src/types';
export type TripMapProps = {
  points: PlanningMapPoint[]; nativeEnabled?: boolean; selectedId?: string | null; onSelect?: (id: string) => void; testID?: string;
  /** Looks up the saved address of stops that are not on the map yet; resolves to a short result message. Omitted when unavailable. */
  onFindLocations?: () => Promise<string>;
  /** How many stops that action would look up. */
  findLocationsCount?: number;
  /** Name of the service that receives the addresses, for the privacy note beside the button. */
  findLocationsProvider?: string | null;
};
