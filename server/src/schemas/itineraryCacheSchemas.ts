import { z } from 'zod';

export const InterestWeightsSchema = z.object({
  outdoors: z.number().int().min(1).max(10),
  adventure: z.number().int().min(1).max(10),
  culture: z.number().int().min(1).max(10),
  food: z.number().int().min(1).max(10),
  nightlife: z.number().int().min(1).max(10),
  relaxing: z.number().int().min(1).max(10),
  photography: z.number().int().min(1).max(10),
  authentic_local: z.number().int().min(1).max(10),
  iconic_landmarks: z.number().int().min(1).max(10),
});

export const ActivityBlockSchema = z.object({
  block_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  location_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  zone_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  role: z.enum(['anchor', 'supporting', 'filler', 'meal', 'rest', 'contingency']),
  category: z.string(),
  title: z.string().min(1).max(300),
  name_local: z.string().nullable(),
  name_script: z.string().nullable(),
  copy: z.object({
    teaser: z.string(),
    body: z.string(),
    insider_tip: z.string(),
    etiquette: z.string().nullable(),
    priority_signal: z.enum(['dont_skip', 'most_visitors_miss', 'optional']),
  }),
  timing: z.object({
    optimal_arrival: z.string().nullable(),
    hard_deadline: z.string().nullable(),
    time_box: z.string().nullable(),
    after_dark_value: z.boolean(),
  }),
  cost_band: z.object({
    currency: z.string(),
    low: z.number(),
    high: z.number(),
    note: z.string().nullable(),
  }),
  duration_minutes: z.object({
    typical: z.number().int().min(1),
    min: z.number().int().min(1),
    max: z.number().int().min(1),
  }),
  energy_cost: z.number().int().min(1).max(5),
  availability: z.object({
    closed_days: z.array(z.string()).default([]),
    season_window: z.object({ months: z.array(z.number().int().min(1).max(12)).min(1) }).optional(),
    operating_schedule: z.object({
      timezone: z.string().min(1).max(80),
      weekly: z.record(z.string(), z.array(z.object({
        opens: z.string().regex(/^\d{2}:\d{2}$/),
        closes: z.string().regex(/^\d{2}:\d{2}$/),
        last_entry: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      }))),
      seasonal_overrides: z.array(z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        opens: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        closes: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        status: z.enum(['open', 'closed']).optional(),
      })).default([]),
      exceptions: z.array(z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        status: z.enum(['open', 'closed']),
        note: z.string().max(300).optional(),
      })).default([]),
      evidence_id: z.string().max(160).optional(),
      verified_at: z.string().datetime().optional(),
      confidence: z.enum(['verified', 'provisional', 'unknown']).default('unknown'),
    }).optional(),
    booking_lead_days: z.number().int().min(0).max(365).optional(),
    ticket_required: z.boolean().optional(),
    sells_out_risk: z.enum(['low', 'medium', 'high']).optional(),
  }).optional(),
  relations: z.object({
    pairs_well_with: z.array(z.string()).default([]),
    conflicts_with: z.array(z.string()).default([]),
    substitutes_for: z.array(z.string()).default([]),
    prerequisite_of: z.string().nullable().optional(),
    foreshadows: z.array(z.string()).default([]),
    complements: z.array(z.string()).default([]),
    duplicates: z.array(z.string()).default([]),
    skip_if_completed: z.array(z.string()).default([]),
  }).optional(),
  interest_weights: InterestWeightsSchema,
  source: z.enum(['curated', 'partner', 'llm_draft']),
  last_verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export const BindingPlanSchema = z.object({
  days: z.array(z.object({
    day: z.number().int().min(1),
    template: z.string(),
    bindings: z.record(z.string(), z.string().nullable()),
    zone_focus: z.string(),
    reason_codes: z.array(z.string()),
  })),
  contingency: z.record(z.string(), z.object({
    if: z.string(),
    replace: z.string(),
    with: z.string(),
  })).optional(),
});

export type ActivityBlock = z.infer<typeof ActivityBlockSchema>;
export type BindingPlan = z.infer<typeof BindingPlanSchema>;

// §2 LocationProfile — the `zones` array is the load-bearing field; without it the day-binding
// step has no geographic-coherence signal to work from. Bounded/simplified relative to the full
// design-doc example (e.g. `lodging.rationale_by_trip_shape` is a plain string map rather than a
// fixed trip-shape enum) so the corpus can grow without a schema migration every time a new trip
// shape or transit mode shows up.
export const LocationZoneAdjacencySchema = z.object({
  zone_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  minutes: z.number().int().min(0).max(300),
  mode: z.enum(['walk', 'transit', 'tram', 'metro', 'bus', 'drive', 'ferry', 'other']),
  line: z.string().max(60).optional(),
  from_stop: z.string().max(120).optional(),
  to_stop: z.string().max(120).optional(),
}).strict();

export const LocationZoneSchema = z.object({
  zone_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().min(1).max(120),
  name_local: z.string().max(120).nullable(),
  centroid: z.tuple([z.number(), z.number()]).nullable(),
  traversal: z.enum(['walk', 'transit', 'drive', 'mixed']),
  terrain_note: z.string().max(300).nullable(),
  adjacency: z.array(LocationZoneAdjacencySchema).max(12),
  lodging: z.object({
    suitable: z.boolean(),
    rationale_by_trip_shape: z.record(z.string(), z.string().max(300)).optional(),
    access_note: z.string().max(300).nullable(),
    cost_band: z.enum(['budget', 'mid', 'luxury']).nullable(),
    alternative_zone_id: z.string().max(80).nullable(),
    alternative_reason: z.string().max(200).nullable(),
  }).optional(),
}).strict();

export const LocationSeasonWindowSchema = z.object({
  label: z.string().min(1).max(40),
  months: z.array(z.number().int().min(1).max(12)).min(1).max(12),
  crowd_factor: z.number().min(0).max(2),
  heat_flag: z.boolean().optional(),
  rain_flag: z.boolean().optional(),
}).strict();

export const LocationProfileSchema = z.object({
  location_id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().min(1).max(160),
  location_type: z.enum(['city', 'hiking_region', 'national_park', 'coastal', 'beach', 'road_trip_corridor', 'multi_city_circuit']),
  country_code: z.string().length(2).nullable(),
  timezone: z.string().min(1).max(80),
  zones: z.array(LocationZoneSchema).min(1).max(24),
  season_windows: z.array(LocationSeasonWindowSchema).max(6),
  local_rhythm: z.object({
    typical_dinner_start: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    midday_closure: z.string().max(120).nullable(),
    market_mornings: z.array(z.string().max(20)).max(7),
    common_closure_day: z.string().max(20).nullable(),
  }).optional(),
  default_day_template_id: z.string().max(80).nullable(),
}).strict();

export type LocationZone = z.infer<typeof LocationZoneSchema>;
export type LocationProfile = z.infer<typeof LocationProfileSchema>;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const BaseStaySchema = z.object({
  baseStayId: z.string().min(1).max(80),
  locationId: z.string().min(1).max(160),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  lodgingItemId: z.string().max(160).optional(),
  parkingNote: z.string().max(500).optional(),
  source: z.enum(['trip_lodging', 'trip_destination']),
}).strict();

export const TravelLegSchema = z.object({
  legId: z.string().min(1).max(80),
  fromBaseStayId: z.string().min(1).max(80),
  toBaseStayId: z.string().min(1).max(80),
  mode: z.enum(['drive', 'rail', 'bus', 'flight', 'other']),
  estimatedMinutes: z.number().int().min(1).max(24 * 60),
  bufferMultiplier: z.number().min(1).max(3),
  latestArrival: IsoDateTimeSchema.optional(),
  hardDeadline: z.object({ at: IsoDateTimeSchema, reasonCode: z.string().max(80) }).optional(),
  source: z.enum(['supplied_transfer', 'static_corridor', 'heuristic', 'provider']),
  confidence: z.enum(['verified', 'estimated', 'low']),
}).strict();

// 'activity_block' and 'travel_leg' checkpoints resolve checkpointId against data the renderer
// already has (a bound ActivityBlock or a TravelLeg) at zero marginal cost. 'logistics_waypoint'
// is for stops that are neither — a fuel stop, a conditional detour — and carries its own small,
// reviewed reasonCode instead of inventing free text at render time; the refine below enforces
// that pairing so a waypoint can never reach the renderer without a code to look copy up by.
const TimedRouteCheckpointSchema = z.object({
  checkpointId: z.string().min(1).max(100),
  checkpointType: z.enum(['activity_block', 'travel_leg', 'logistics_waypoint']),
  reasonCode: z.string().min(1).max(80).optional(),
  earliestStart: IsoDateTimeSchema.optional(),
  latestDeparture: IsoDateTimeSchema.optional(),
  durationMinutes: z.number().int().min(0).max(24 * 60),
  required: z.boolean(),
  cutPriority: z.number().int().min(0).max(100).optional(),
}).strict().refine(
  (checkpoint) => checkpoint.checkpointType !== 'logistics_waypoint' || Boolean(checkpoint.reasonCode),
  { message: 'logistics_waypoint checkpoints require a reasonCode', path: ['reasonCode'] }
);

export const TimedRouteDaySchema = z.object({
  date: IsoDateSchema,
  hardDeadline: z.object({ at: IsoDateTimeSchema, reasonCode: z.string().max(80) }).optional(),
  requiredSlackMinutes: z.number().int().min(0).max(24 * 60),
  checkpoints: z.array(TimedRouteCheckpointSchema).max(12),
}).strict();

export const DayVariantSchema = z.object({
  variantId: z.string().min(1).max(100),
  labelReasonCode: z.string().min(1).max(80),
  blockIds: z.array(z.string()).max(40),
  legIds: z.array(z.string()).max(16),
  estimatedMinutes: z.number().int().min(0).max(24 * 60),
  conditions: z.array(z.enum(['dry', 'poor_weather', 'opening_hours', 'reservation_confirmed'])).max(8),
  exclusiveGroup: z.string().min(1).max(100),
  tradeoffReasonCodes: z.array(z.string().max(80)).max(8),
}).strict();

export const RoadTripConflictSchema = z.object({
  code: z.enum(['MISSING_BASE', 'DEADLINE_INFEASIBLE', 'TRANSPORT_WINDOW', 'VARIANT_CONFLICT', 'SCHEDULE_UNKNOWN', 'LIMIT_REACHED']),
  date: IsoDateSchema.optional(),
  message: z.string().min(1).max(500),
  required: z.boolean(),
}).strict();

export const TripLogisticsOverlaySchema = z.object({
  schemaVersion: z.literal('road-trip-lite-v1'),
  baseStays: z.array(BaseStaySchema).max(16),
  travelLegs: z.array(TravelLegSchema).max(32),
  timedRouteDays: z.array(TimedRouteDaySchema).max(31),
  dayVariants: z.array(DayVariantSchema).max(124),
  activeVariantIds: z.array(z.string()).max(124),
  conflicts: z.array(RoadTripConflictSchema).max(64),
  daysByBase: z.array(z.object({ baseStayId: z.string(), dates: z.array(IsoDateSchema).max(31) }).strict()).max(16),
  drivingSummary: z.array(z.object({
    date: IsoDateSchema,
    legIds: z.array(z.string()),
    bufferedMinutes: z.number().int().min(0).max(24 * 60),
    requiredSlackMinutes: z.number().int().min(0).max(24 * 60),
    confidence: z.enum(['verified', 'estimated', 'low']),
  }).strict()).max(31),
}).strict();

export type BaseStay = z.infer<typeof BaseStaySchema>;
export type TravelLeg = z.infer<typeof TravelLegSchema>;
export type TimedRouteDay = z.infer<typeof TimedRouteDaySchema>;
export type TimedRouteCheckpoint = TimedRouteDay['checkpoints'][number];
export type DayVariant = z.infer<typeof DayVariantSchema>;
export type RoadTripConflict = z.infer<typeof RoadTripConflictSchema>;
export type TripLogisticsOverlay = z.infer<typeof TripLogisticsOverlaySchema>;
