import { z } from 'zod';

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ItineraryEvidenceSchema = z.object({
  sourceType: z.enum(['catalog', 'wikipedia', 'curated', 'partner', 'llm_draft', 'heuristic']),
  sourceLabel: z.string().max(200).nullable(),
  sourceUrl: z.string().max(2000).nullable(),
  verifiedAt: z.string().max(80).nullable(),
  confidence: z.enum(['verified', 'provisional', 'unknown']),
}).strict();

export const AnnotatedActivitySchema = z.object({
  name: z.string().min(1).max(300),
  activityType: z.string().max(80),
  names: z.object({
    display: z.string().min(1).max(300),
    native: z.string().max(300).nullable(),
    romanized: z.string().max(300).nullable(),
    travelerLanguage: z.string().max(300).nullable(),
  }).strict(),
  whatItIs: z.string().max(1600).nullable(),
  whyIncluded: z.string().max(600).nullable(),
  insiderTip: z.string().max(600).nullable(),
  etiquette: z.string().max(600).nullable(),
  priority: z.enum(['dont_skip', 'most_visitors_miss', 'optional']).nullable(),
  timing: z.object({
    startTime: z.string().max(20).nullable(),
    duration: z.string().max(40).nullable(),
    optimalArrival: z.string().max(200).nullable(),
    hardDeadline: z.string().max(200).nullable(),
    afterDarkValue: z.boolean(),
  }).strict(),
  booking: z.object({
    required: z.boolean().nullable(),
    leadDays: z.number().int().min(0).max(365).nullable(),
    sellsOutRisk: z.enum(['low', 'medium', 'high']).nullable(),
    verificationRequired: z.boolean(),
  }).strict(),
  effort: z.object({
    energyCost: z.number().int().min(1).max(5).nullable(),
    weatherDependent: z.boolean(),
  }).strict(),
  alternatives: z.array(z.string().max(300)).max(8),
  evidence: z.array(ItineraryEvidenceSchema).max(8),
  confidence: z.enum(['verified', 'provisional', 'unknown']),
}).strict();

export const AnnotatedDaySchema = z.object({
  day: z.number().int().min(1),
  date: IsoDateSchema,
  base: z.string().min(1).max(200),
  theme: z.string().min(1).max(400),
  intensity: z.enum(['light', 'balanced', 'high']),
  logisticsNotes: z.array(z.string().max(600)).max(12),
  activities: z.array(AnnotatedActivitySchema).max(8),
  contingencies: z.array(z.object({
    condition: z.enum(['rain', 'fatigue', 'closure', 'reservation']),
    recommendation: z.string().min(1).max(500),
    confidence: z.enum(['verified', 'provisional', 'unknown']),
  }).strict()).max(8),
}).strict();

export const ItineraryActionSchema = z.object({
  id: z.string().min(1).max(160),
  type: z.enum(['book', 'verify', 'prepare']),
  timing: z.enum(['now', 'soon', 'before_trip', 'one_week_before', 'day_of']),
  date: IsoDateSchema.nullable(),
  label: z.string().min(1).max(500),
  reason: z.string().min(1).max(700),
  confidence: z.enum(['verified', 'provisional', 'unknown']),
}).strict();

export const AnnotatedItinerarySchema = z.object({
  schemaVersion: z.literal('annotated-itinerary-v1'),
  route: z.object({
    thesis: z.string().min(1).max(1200),
    organizingFactors: z.array(z.string().max(500)).max(12),
    tradeoffs: z.array(z.string().max(500)).max(8),
    hotelChanges: z.number().int().min(0).max(50),
    bases: z.array(z.object({
      location: z.string().min(1).max(200),
      checkIn: IsoDateSchema,
      checkOut: IsoDateSchema,
      nights: z.number().int().min(0).max(365),
      rationale: z.string().min(1).max(700),
      dayTrips: z.array(z.string().max(200)).max(12),
    }).strict()).max(32),
    fragileConnections: z.array(z.object({
      date: IsoDateSchema,
      from: z.string().min(1).max(200),
      to: z.string().min(1).max(200),
      reason: z.string().min(1).max(500),
      confidence: z.enum(['verified', 'estimated', 'unknown']),
    }).strict()).max(16),
  }).strict(),
  days: z.array(AnnotatedDaySchema).max(366),
  actions: z.array(ItineraryActionSchema).max(200),
  summary: z.object({
    dayCount: z.number().int().min(1).max(366),
    baseCount: z.number().int().min(1).max(50),
    hotelChanges: z.number().int().min(0).max(50),
    transferDays: z.number().int().min(0).max(366),
    bookingActionCount: z.number().int().min(0).max(200),
    hikes: z.array(z.object({
      date: IsoDateSchema,
      name: z.string().min(1).max(300),
      distance: z.string().max(80).nullable(),
      elevationGain: z.string().max(80).nullable(),
      verificationRequired: z.boolean(),
    }).strict()).max(60),
  }).strict(),
  validation: z.object({
    evidenceCoverage: z.number().min(0).max(1),
    unsupportedActivities: z.array(z.string().max(300)).max(100),
    unverifiedOperationalFacts: z.array(z.string().max(700)).max(100),
    bookingActionsCovered: z.boolean(),
    repairs: z.array(z.string().max(700)).max(100),
  }).strict(),
}).strict();

export type AnnotatedItinerary = z.infer<typeof AnnotatedItinerarySchema>;
export type AnnotatedActivity = z.infer<typeof AnnotatedActivitySchema>;
export type ItineraryEvidence = z.infer<typeof ItineraryEvidenceSchema>;
