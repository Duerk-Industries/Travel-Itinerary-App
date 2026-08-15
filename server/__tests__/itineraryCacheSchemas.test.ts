import { TimedRouteDaySchema, TripLogisticsOverlaySchema } from '../src/schemas/itineraryCacheSchemas';

const baseCheckpoint = {
  checkpointId: 'chk_1',
  durationMinutes: 30,
  required: false,
};

describe('TimedRouteDaySchema checkpoints', () => {
  it('accepts an activity_block checkpoint with no reasonCode', () => {
    const result = TimedRouteDaySchema.safeParse({
      date: '2026-09-11',
      requiredSlackMinutes: 0,
      checkpoints: [{ ...baseCheckpoint, checkpointType: 'activity_block' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a travel_leg checkpoint with no reasonCode', () => {
    const result = TimedRouteDaySchema.safeParse({
      date: '2026-09-11',
      requiredSlackMinutes: 0,
      checkpoints: [{ ...baseCheckpoint, checkpointType: 'travel_leg', required: true }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a logistics_waypoint checkpoint only when it carries a reasonCode', () => {
    const withReasonCode = TimedRouteDaySchema.safeParse({
      date: '2026-09-11',
      requiredSlackMinutes: 0,
      checkpoints: [{ ...baseCheckpoint, checkpointType: 'logistics_waypoint', reasonCode: 'FUEL_STOP' }],
    });
    expect(withReasonCode.success).toBe(true);

    const withoutReasonCode = TimedRouteDaySchema.safeParse({
      date: '2026-09-11',
      requiredSlackMinutes: 0,
      checkpoints: [{ ...baseCheckpoint, checkpointType: 'logistics_waypoint' }],
    });
    expect(withoutReasonCode.success).toBe(false);
  });

  it('rejects an unrecognized checkpointType', () => {
    const result = TimedRouteDaySchema.safeParse({
      date: '2026-09-11',
      requiredSlackMinutes: 0,
      checkpoints: [{ ...baseCheckpoint, checkpointType: 'mystery_stop' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than the per-day checkpoint cap', () => {
    const checkpoints = Array.from({ length: 13 }, (_, index) => ({
      ...baseCheckpoint,
      checkpointId: `chk_${index}`,
      checkpointType: 'activity_block' as const,
    }));
    const result = TimedRouteDaySchema.safeParse({ date: '2026-09-11', requiredSlackMinutes: 0, checkpoints });
    expect(result.success).toBe(false);
  });
});

describe('TripLogisticsOverlaySchema privacy boundary', () => {
  const validOverlay = {
    schemaVersion: 'road-trip-lite-v1' as const,
    baseStays: [],
    travelLegs: [],
    timedRouteDays: [],
    dayVariants: [],
    activeVariantIds: [],
    conflicts: [],
    daysByBase: [],
    drivingSummary: [],
  };

  it('parses a minimal empty overlay', () => {
    expect(TripLogisticsOverlaySchema.safeParse(validOverlay).success).toBe(true);
  });

  it('rejects an unknown top-level field rather than silently dropping or accepting it', () => {
    const result = TripLogisticsOverlaySchema.safeParse({ ...validOverlay, userId: 'account-123' });
    expect(result.success).toBe(false);
  });
});
