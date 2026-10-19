import type { PlanningMapPoint } from '../../server/src/types';
export type TripMapProps = { points: PlanningMapPoint[]; selectedId?: string | null; onSelect?: (id: string) => void; testID?: string };
