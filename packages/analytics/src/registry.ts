/**
 * Product-analytics event registry — the single source of truth for what may be
 * collected (docs/implementation-plans/analytics-upgrade.md, Phase 2).
 *
 * CANONICAL COPY. server/src/analytics/registry.ts is a byte-identical mirror
 * (the server deploy uploads server/ alone, so it cannot import this package);
 * regenerate it with `npm run sync:analytics-registry` — a server test fails
 * when the two differ.
 *
 * Rules for adding an event (reviewed in the PR):
 *  - It answers a named product question (`question`) and has an `owner`.
 *  - Properties are enums, booleans or bounded integers only. No free text,
 *    IDs, URLs, names, destinations, prompts or content — by construction.
 *  - A new consent purpose or data category also needs the privacy notice,
 *    cookie notice and App Store / Play disclosures updated together.
 *
 * Plain data on purpose: no runtime dependencies, so the app can import it
 * without bundling a validator. The server builds strict Zod schemas from it.
 */

export const ANALYTICS_REGISTRY_VERSION = 1;

/** Stable analytics feature names (decoupled from UI page names). */
export const ANALYTICS_FEATURES = [
  'home',
  'trips',
  'create_trip',
  'overview',
  'itinerary',
  'transfers',
  'lodging',
  'car_rentals',
  'activities',
  'expenses',
  'ledger',
  'packing',
  'imports',
  'blog',
  'cost_report',
  'account',
  'follow',
  'chat',
  'collaboration',
] as const;
export type AnalyticsFeature = (typeof ANALYTICS_FEATURES)[number];

export const ANALYTICS_PLATFORMS = ['web', 'ios', 'android'] as const;
export type AnalyticsPlatform = (typeof ANALYTICS_PLATFORMS)[number];

export const ANALYTICS_TRIP_PHASES = ['pre_trip', 'during_trip', 'post_trip', 'unknown'] as const;
export type AnalyticsTripPhase = (typeof ANALYTICS_TRIP_PHASES)[number];

export type PropertySpec =
  | { type: 'enum'; values: readonly string[] }
  | { type: 'boolean' }
  | { type: 'int'; min: number; max: number };

export type EventFamily = 'session' | 'view' | 'task' | 'outcome' | 'utility';

export type EventDefinition = {
  family: EventFamily;
  /** Consent purpose; every product event requires a current product_analytics grant. */
  purpose: 'product_analytics';
  /** Who may emit it: the client, or the server after a committed business outcome. */
  source: 'client' | 'server';
  /** May the event carry a (pseudonymized, access-checked) trip reference? */
  tripScoped: boolean;
  owner: string;
  question: string;
  retentionDays: number;
  properties: Readonly<Record<string, PropertySpec>>;
};

const feature: PropertySpec = { type: 'enum', values: ANALYTICS_FEATURES };
const TASKS = ['create_trip', 'add_item', 'edit_item', 'import', 'invite', 'generate_itinerary', 'export_report', 'packing'] as const;
const task: PropertySpec = { type: 'enum', values: TASKS };
const ITEM_TYPES = ['transfer', 'lodging', 'activity', 'car_rental', 'expense', 'packing_item', 'note'] as const;
const RAW_EVENT_RETENTION_DAYS = 90;

export const ANALYTICS_EVENTS = {
  session_started: {
    family: 'session', purpose: 'product_analytics', source: 'client', tripScoped: false,
    owner: 'product', question: 'How often and on which platforms do people come back?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: { resumed: { type: 'boolean' } },
  },
  engaged_session_summary: {
    family: 'session', purpose: 'product_analytics', source: 'client', tripScoped: false,
    owner: 'product', question: 'How long are foreground sessions?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: {
      duration_bucket: { type: 'enum', values: ['lt_1m', '1_5m', '5_15m', '15_60m', 'gt_60m'] },
      features_viewed: { type: 'int', min: 0, max: 50 },
    },
  },
  feature_viewed: {
    family: 'view', purpose: 'product_analytics', source: 'client', tripScoped: true,
    owner: 'product', question: 'Which features do people find and open (reach)?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: {
      feature,
      entry_point: { type: 'enum', values: ['nav', 'deep_link', 'restore', 'other'] },
    },
  },
  task_started: {
    family: 'task', purpose: 'product_analytics', source: 'client', tripScoped: true,
    owner: 'product', question: 'Which workflows do people start?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: { task, feature },
  },
  task_cancelled: {
    family: 'task', purpose: 'product_analytics', source: 'client', tripScoped: true,
    owner: 'product', question: 'Where do people abandon workflows?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: { task, feature },
  },
  task_failed: {
    family: 'task', purpose: 'product_analytics', source: 'client', tripScoped: true,
    owner: 'product', question: 'Which workflows fail, and how?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: {
      task,
      feature,
      failure: { type: 'enum', values: ['validation', 'network', 'server', 'permission', 'quota', 'other'] },
    },
  },
  trip_created: {
    family: 'outcome', purpose: 'product_analytics', source: 'server', tripScoped: true,
    owner: 'product', question: 'How many trips are created, and from where?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: { via_wizard: { type: 'boolean' } },
  },
  item_saved: {
    family: 'outcome', purpose: 'product_analytics', source: 'server', tripScoped: true,
    owner: 'product', question: 'Which item types do people actually save (meaningful adoption)?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: { item_type: { type: 'enum', values: ITEM_TYPES }, created: { type: 'boolean' } },
  },
  invite_accepted: {
    family: 'outcome', purpose: 'product_analytics', source: 'server', tripScoped: false,
    owner: 'product', question: 'Do invitations turn into collaborators?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: { invite_type: { type: 'enum', values: ['group', 'trip_share', 'follow'] } },
  },
  map_link_opened: {
    family: 'utility', purpose: 'product_analytics', source: 'client', tripScoped: true,
    owner: 'product', question: 'Do people navigate from trip references (during-trip value)?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: { provider: { type: 'enum', values: ['google', 'apple', 'waze', 'other'] }, feature },
  },
  report_exported: {
    family: 'utility', purpose: 'product_analytics', source: 'client', tripScoped: true,
    owner: 'product', question: 'Are cost reports exported?',
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    properties: { report: { type: 'enum', values: ['cost_csv', 'activities_csv', 'lodging_csv', 'other'] } },
  },
} as const satisfies Record<string, EventDefinition>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

/** Ingest limits shared by client (batching) and server (validation). */
export const ANALYTICS_LIMITS = {
  maxBatchEvents: 20,
  maxPayloadBytes: 32 * 1024,
  maxQueuedEvents: 100,
  maxEventAgeMs: 24 * 60 * 60 * 1000,
  maxFutureSkewMs: 5 * 60 * 1000,
  flushIntervalMs: 30 * 1000,
  sessionIdleMs: 30 * 60 * 1000,
} as const;

/** Client-supplied envelope. Identity, consent epoch and trip pseudonym are server-derived. */
export type ClientAnalyticsEvent = {
  event_id: string;
  schema_version: number;
  event_name: AnalyticsEventName;
  occurred_at: string;
  session_id: string;
  platform: AnalyticsPlatform;
  app_version: string;
  /** IANA zone reported by the device, used only as the trip-phase fallback. */
  device_timezone?: string;
  /** Raw trip ID; the server verifies access and stores only a pseudonym. */
  trip_id?: string;
  properties: Record<string, string | number | boolean>;
};
