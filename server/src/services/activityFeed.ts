import { createHash } from 'crypto';
import type { TripActivity } from '../types';

type GroupedActivityItemPreview = {
  id: string;
  title: string;
  summary: string;
  metadata: Record<string, any>;
  createdAt: string;
};

export type GroupedActivityEvent = {
  id: string;
  kind: 'group';
  type: string;
  actorUserId?: string | null;
  startAt: string;
  endAt: string;
  count: number;
  itemsPreview: GroupedActivityItemPreview[];
  itemsTotal: number;
};

export type RawActivityEvent = TripActivity & { kind: 'event' };

export type ActivityFeedEvent = GroupedActivityEvent | RawActivityEvent;

const GROUP_WINDOW_MS = 5 * 60 * 1000;

const toEpoch = (createdAt: string): number => {
  const value = new Date(createdAt).getTime();
  return Number.isFinite(value) ? value : 0;
};

const buildGroupId = (tripId: string, type: string, actorUserId: string | null | undefined, startAt: string, endAt: string, count: number): string => {
  const base = `${tripId}|${type}|${actorUserId ?? 'system'}|${startAt}|${endAt}|${count}`;
  return `group:${createHash('sha1').update(base).digest('hex').slice(0, 16)}`;
};

const shouldGroup = (items: TripActivity[]): boolean => {
  return items.length > 1;
};

export const aggregateTripActivity = (events: TripActivity[]): ActivityFeedEvent[] => {
  const sorted = [...events].sort((a, b) => {
    const at = toEpoch(a.createdAt);
    const bt = toEpoch(b.createdAt);
    if (bt !== at) return bt - at;
    return String(b.id).localeCompare(String(a.id));
  });

  const clusters: TripActivity[][] = [];
  for (const event of sorted) {
    const latestCluster = clusters[clusters.length - 1];
    if (!latestCluster) {
      clusters.push([event]);
      continue;
    }
    const anchor = latestCluster[0];
    const sameActor = (anchor.actorUserId ?? null) === (event.actorUserId ?? null);
    const sameType = anchor.type === event.type;
    const sameTrip = anchor.tripId === event.tripId;
    const withinWindow = toEpoch(anchor.createdAt) - toEpoch(event.createdAt) <= GROUP_WINDOW_MS;
    if (sameActor && sameType && sameTrip && withinWindow) {
      latestCluster.push(event);
    } else {
      clusters.push([event]);
    }
  }

  return clusters.map((cluster) => {
    if (!shouldGroup(cluster)) {
      return { ...cluster[0], kind: 'event' } as RawActivityEvent;
    }
    const sortedCluster = [...cluster].sort((a, b) => toEpoch(b.createdAt) - toEpoch(a.createdAt));
    const newest = sortedCluster[0];
    const oldest = sortedCluster[sortedCluster.length - 1];
    const preview = sortedCluster.slice(0, 3).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      metadata: item.metadata ?? {},
      createdAt: item.createdAt,
    }));
    return {
      id: buildGroupId(newest.tripId, newest.type, newest.actorUserId, oldest.createdAt, newest.createdAt, sortedCluster.length),
      kind: 'group',
      type: newest.type,
      actorUserId: newest.actorUserId ?? null,
      startAt: oldest.createdAt,
      endAt: newest.createdAt,
      count: sortedCluster.length,
      itemsPreview: preview,
      itemsTotal: sortedCluster.length,
    } as GroupedActivityEvent;
  });
};
