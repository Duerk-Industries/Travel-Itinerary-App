import type { PlanningMapPoint } from '../../server/src/types';
export type TripMapProps = {
  points: PlanningMapPoint[]; nativeEnabled?: boolean; selectedId?: string | null; onSelect?: (id: string) => void; testID?: string;
  /** Opening a map starts any missing coordinate lookups in its owner. */
  onOpenChange?: (open: boolean) => void;
  locating?: boolean;
  locationNotice?: string;
};
