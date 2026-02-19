import { aggregateTripActivity } from '../src/services/activityFeed';
import type { TripActivity } from '../src/types';

const event = (overrides: Partial<TripActivity>): TripActivity => ({
  id: overrides.id ?? 'e1',
  tripId: overrides.tripId ?? 'trip-1',
  actorUserId: typeof overrides.actorUserId === 'undefined' ? 'user-1' : overrides.actorUserId,
  type: overrides.type ?? 'ITINERARY_ITEM_ADDED',
  title: overrides.title ?? 'Itinerary item added',
  summary: overrides.summary ?? 'Added activity',
  metadata: overrides.metadata ?? {},
  createdAt: overrides.createdAt ?? '2026-02-16T12:00:00.000Z',
});

describe('aggregateTripActivity', () => {
  it('groups same type+actor events within five minutes', () => {
    const input: TripActivity[] = [
      event({ id: 'a', createdAt: '2026-02-16T12:00:00.000Z' }),
      event({ id: 'b', createdAt: '2026-02-16T11:58:00.000Z' }),
      event({ id: 'c', createdAt: '2026-02-16T11:56:30.000Z' }),
    ];
    const output = aggregateTripActivity(input);
    expect(output).toHaveLength(1);
    expect(output[0].kind).toBe('group');
    const group = output[0] as any;
    expect(group.count).toBe(3);
    expect(group.itemsPreview).toHaveLength(3);
    expect(group.itemsTotal).toBe(3);
    expect(group.startAt).toBe('2026-02-16T11:56:30.000Z');
    expect(group.endAt).toBe('2026-02-16T12:00:00.000Z');
  });

  it('does not group when actor differs', () => {
    const input: TripActivity[] = [
      event({ id: 'a', actorUserId: 'user-1', createdAt: '2026-02-16T12:00:00.000Z' }),
      event({ id: 'b', actorUserId: 'user-2', createdAt: '2026-02-16T11:59:00.000Z' }),
    ];
    const output = aggregateTripActivity(input);
    expect(output).toHaveLength(2);
    expect((output[0] as any).kind).toBe('event');
    expect((output[1] as any).kind).toBe('event');
  });

  it('does not group when time window exceeds five minutes', () => {
    const input: TripActivity[] = [
      event({ id: 'a', createdAt: '2026-02-16T12:00:00.000Z' }),
      event({ id: 'b', createdAt: '2026-02-16T11:54:59.000Z' }),
    ];
    const output = aggregateTripActivity(input);
    expect(output).toHaveLength(2);
    expect((output[0] as any).kind).toBe('event');
    expect((output[1] as any).kind).toBe('event');
  });

  it('includes only 3 items in preview when group is larger', () => {
    const input: TripActivity[] = [
      event({ id: 'a', createdAt: '2026-02-16T12:00:00.000Z' }),
      event({ id: 'b', createdAt: '2026-02-16T11:59:30.000Z' }),
      event({ id: 'c', createdAt: '2026-02-16T11:59:00.000Z' }),
      event({ id: 'd', createdAt: '2026-02-16T11:58:45.000Z' }),
    ];
    const output = aggregateTripActivity(input);
    expect(output).toHaveLength(1);
    const group = output[0] as any;
    expect(group.kind).toBe('group');
    expect(group.count).toBe(4);
    expect(group.itemsPreview).toHaveLength(3);
    expect(group.itemsTotal).toBe(4);
  });
});
