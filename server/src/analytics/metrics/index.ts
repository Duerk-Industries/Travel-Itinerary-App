import type { AnalyticsEventRecord } from '../../types';

/**
 * Product analytics metric definitions (docs/implementation-plans/analytics-upgrade.md
 * Phase 5). Pure functions over stored events, shared by the admin API and CSV export so
 * the two can never disagree. Aggregate-only: nothing returned identifies a person, and
 * every count of distinct people below MIN_COHORT is suppressed (value null).
 *
 * Population: consenting accounts with at least one non-excluded event in the window
 * ("consenting active"). Accounts that never opted in are invisible here by design, so
 * every rate describes consenting users only — reports must say so.
 */

export const METRIC_VERSION = 'v1';
export const MIN_COHORT = 10;
export const REPORT_WINDOWS_DAYS = [7, 30, 90] as const;
export type ReportWindowDays = (typeof REPORT_WINDOWS_DAYS)[number];

export type Suppressible = { value: number | null; suppressed: boolean };

/** Distinct-people counts below MIN_COHORT are withheld; zero is shown (it reveals no one). */
export const cohort = (count: number): Suppressible =>
  count > 0 && count < MIN_COHORT ? { value: null, suppressed: true } : { value: count, suppressed: false };

/** A rate whose numerator or denominator is a suppressed cohort is suppressed too. */
export const rate = (numerator: Suppressible, denominator: Suppressible): number | null =>
  numerator.value === null || denominator.value === null || denominator.value === 0 ? null : numerator.value / denominator.value;

const day = (iso: string): string => iso.slice(0, 10);

const ITEM_TYPE_FEATURE: Record<string, string> = {
  transfer: 'transfers',
  lodging: 'lodging',
  activity: 'activities',
  car_rental: 'car_rentals',
  expense: 'expenses',
  packing_item: 'packing',
  note: 'itinerary',
};

/** Only events eligible for product reports: admin and internal-canary traffic is excluded. */
export const reportable = (events: AnalyticsEventRecord[]): AnalyticsEventRecord[] =>
  events.filter((e) => !e.excludedReason);

const distinct = <T>(values: Iterable<T>): number => new Set(values).size;

export const DEFINITIONS = {
  population: 'Consenting active accounts: accounts that opted in to product analytics and produced at least one event in the window. Admin and internal canary traffic excluded.',
  reach: 'Consenting active accounts that viewed the feature ÷ consenting active accounts.',
  meaningfulAdoption: 'Consenting active accounts with a confirmed outcome in the feature (server-recorded save or creation) ÷ consenting active accounts.',
  repeatUse: 'Accounts that viewed the feature on two or more different days ÷ accounts that viewed it.',
  taskFailureRate: 'Failed task attempts ÷ started task attempts, per task.',
  platformCohorts: 'Consenting active accounts seen only on web, only on native apps (iOS/Android), or on both.',
  tripPhase: 'Trip-scoped events classified by the trip\'s inclusive local dates: before, during or after the trip, or unknown when no usable dates or time zone.',
  duringTripEngagement: 'Traveler–trip pairs with any event during the trip\'s dates ÷ traveler–trip pairs with any classified (non-unknown) event in the window. Measures app use during scheduled dates, not physical presence; trips nobody opened are not in the denominator.',
} as const;

export const buildFeatureAdoption = (events: AnalyticsEventRecord[]) => {
  const active = cohort(distinct(events.map((e) => e.subjectId)));
  const viewers = new Map<string, Set<string>>();
  const viewDays = new Map<string, Map<string, Set<string>>>();
  const outcomes = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.eventName === 'feature_viewed' && e.feature) {
      (viewers.get(e.feature) ?? viewers.set(e.feature, new Set()).get(e.feature)!).add(e.subjectId);
      const bySubject = viewDays.get(e.feature) ?? viewDays.set(e.feature, new Map()).get(e.feature)!;
      (bySubject.get(e.subjectId) ?? bySubject.set(e.subjectId, new Set()).get(e.subjectId)!).add(day(e.occurredAt));
    }
    const outcomeFeature = e.eventName === 'trip_created' ? 'create_trip'
      : e.eventName === 'item_saved' ? ITEM_TYPE_FEATURE[String(e.properties.item_type)] : undefined;
    if (outcomeFeature) (outcomes.get(outcomeFeature) ?? outcomes.set(outcomeFeature, new Set()).get(outcomeFeature)!).add(e.subjectId);
  }
  const features = Array.from(new Set([...viewers.keys(), ...outcomes.keys()])).sort();
  return {
    activeAccounts: active,
    features: features.map((feature) => {
      const reached = cohort(viewers.get(feature)?.size ?? 0);
      const adopted = cohort(outcomes.get(feature)?.size ?? 0);
      const repeat = cohort(Array.from(viewDays.get(feature)?.values() ?? []).filter((days) => days.size >= 2).length);
      return {
        feature,
        reachAccounts: reached,
        reach: rate(reached, active),
        adoptedAccounts: adopted,
        meaningfulAdoption: rate(adopted, active),
        repeatAccounts: repeat,
        repeatUse: rate(repeat, reached),
      };
    }),
    tasks: buildTaskOutcomes(events),
  };
};

const buildTaskOutcomes = (events: AnalyticsEventRecord[]) => {
  const counts = new Map<string, { started: number; failed: number; cancelled: number; accounts: Set<string> }>();
  for (const e of events) {
    if (!e.eventName.startsWith('task_')) continue;
    const task = String(e.properties.task ?? 'unknown');
    const row = counts.get(task) ?? counts.set(task, { started: 0, failed: 0, cancelled: 0, accounts: new Set() }).get(task)!;
    row.accounts.add(e.subjectId);
    if (e.eventName === 'task_started') row.started += 1;
    if (e.eventName === 'task_failed') row.failed += 1;
    if (e.eventName === 'task_cancelled') row.cancelled += 1;
  }
  return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([task, row]) => {
    // Attempt counts are only shown when enough distinct people contributed.
    const accounts = cohort(row.accounts.size);
    const shown = accounts.value !== null;
    return {
      task,
      accounts,
      started: shown ? row.started : null,
      failureRate: shown && row.started ? row.failed / row.started : null,
      cancelRate: shown && row.started ? row.cancelled / row.started : null,
    };
  });
};

export const buildPlatformMix = (events: AnalyticsEventRecord[]) => {
  const platformsBySubject = new Map<string, Set<string>>();
  const sessions = new Map<string, number>();
  const versionAccounts = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.source !== 'client') continue;
    (platformsBySubject.get(e.subjectId) ?? platformsBySubject.set(e.subjectId, new Set()).get(e.subjectId)!).add(e.platform);
    if (e.eventName === 'session_started') sessions.set(e.platform, (sessions.get(e.platform) ?? 0) + 1);
    const key = `${e.platform} ${e.appVersion}`;
    (versionAccounts.get(key) ?? versionAccounts.set(key, new Set()).get(key)!).add(e.subjectId);
  }
  let webOnly = 0;
  let nativeOnly = 0;
  let both = 0;
  const byPlatform = new Map<string, number>();
  for (const platforms of platformsBySubject.values()) {
    const web = platforms.has('web');
    const native = platforms.has('ios') || platforms.has('android');
    if (web && native) both += 1;
    else if (web) webOnly += 1;
    else if (native) nativeOnly += 1;
    for (const p of platforms) byPlatform.set(p, (byPlatform.get(p) ?? 0) + 1);
  }
  const accounts = cohort(platformsBySubject.size);
  return {
    activeAccounts: accounts,
    cohorts: { webOnly: cohort(webOnly), nativeOnly: cohort(nativeOnly), both: cohort(both) },
    platforms: ['web', 'ios', 'android'].map((platform) => {
      const platformAccounts = cohort(byPlatform.get(platform) ?? 0);
      return {
        platform,
        accounts: platformAccounts,
        // Session counts are shown only when the platform's account cohort is.
        sessions: platformAccounts.value === null ? null : sessions.get(platform) ?? 0,
      };
    }),
    appVersions: Array.from(versionAccounts.entries())
      .map(([key, subjects]) => ({ platformVersion: key, accounts: cohort(subjects.size) }))
      .filter((row) => row.accounts.value !== null && row.accounts.value > 0)
      .sort((a, b) => (b.accounts.value ?? 0) - (a.accounts.value ?? 0))
      .slice(0, 20),
  };
};

export const buildTripPhaseEngagement = (events: AnalyticsEventRecord[]) => {
  const tripEvents = events.filter((e) => e.tripRef);
  const phaseAccounts = new Map<string, Set<string>>();
  const phaseEvents = new Map<string, number>();
  const pairs = new Map<string, Set<string>>(); // subject|trip → phases seen
  const timezoneSources = new Map<string, number>();
  for (const e of tripEvents) {
    (phaseAccounts.get(e.tripPhase) ?? phaseAccounts.set(e.tripPhase, new Set()).get(e.tripPhase)!).add(e.subjectId);
    phaseEvents.set(e.tripPhase, (phaseEvents.get(e.tripPhase) ?? 0) + 1);
    timezoneSources.set(e.timezoneSource, (timezoneSources.get(e.timezoneSource) ?? 0) + 1);
    const pair = `${e.subjectId}|${e.tripRef}`;
    (pairs.get(pair) ?? pairs.set(pair, new Set()).get(pair)!).add(e.tripPhase);
  }
  const classifiedPairs = Array.from(pairs.values()).filter((phases) => Array.from(phases).some((p) => p !== 'unknown'));
  const classified = cohort(classifiedPairs.length);
  const during = cohort(classifiedPairs.filter((phases) => phases.has('during_trip')).length);
  const totalTripEvents = tripEvents.length;
  return {
    phases: ['pre_trip', 'during_trip', 'post_trip', 'unknown'].map((phase) => {
      const accounts = cohort(phaseAccounts.get(phase)?.size ?? 0);
      return { phase, accounts, events: accounts.value === null ? null : phaseEvents.get(phase) ?? 0 };
    }),
    travelerTripPairs: classified,
    duringTripPairs: during,
    duringTripEngagement: rate(during, classified),
    // Coverage of the timezone fallback chain (decision 5): device = unverified proxy.
    timezoneCoverage: totalTripEvents
      ? Object.fromEntries(Array.from(timezoneSources.entries()).map(([source, n]) => [source, n / totalTripEvents]))
      : {},
  };
};

/** Flattens a view into CSV rows (header first). Suppressed values export as empty cells. */
export const toCsvRows = (view: 'adoption' | 'platform' | 'trip_phase', report: ReturnType<typeof buildAll>): string[][] => {
  const n = (s: Suppressible) => (s.value === null ? '' : String(s.value));
  const r = (x: number | null) => (x === null ? '' : x.toFixed(4));
  if (view === 'adoption') {
    return [
      ['feature', 'reach_accounts', 'reach', 'adopted_accounts', 'meaningful_adoption', 'repeat_accounts', 'repeat_use'],
      ...report.adoption.features.map((f) => [f.feature, n(f.reachAccounts), r(f.reach), n(f.adoptedAccounts), r(f.meaningfulAdoption), n(f.repeatAccounts), r(f.repeatUse)]),
    ];
  }
  if (view === 'platform') {
    return [
      ['segment', 'accounts', 'sessions'],
      ['web_only', n(report.platform.cohorts.webOnly), ''],
      ['native_only', n(report.platform.cohorts.nativeOnly), ''],
      ['both', n(report.platform.cohorts.both), ''],
      ...report.platform.platforms.map((p) => [`platform:${p.platform}`, n(p.accounts), p.sessions === null ? '' : String(p.sessions)]),
    ];
  }
  return [
    ['phase', 'accounts', 'events'],
    ...report.tripPhase.phases.map((p) => [p.phase, n(p.accounts), p.events === null ? '' : String(p.events)]),
    ['during_trip_engagement', '', r(report.tripPhase.duringTripEngagement)],
  ];
};

export const buildAll = (allEvents: AnalyticsEventRecord[]) => {
  const events = reportable(allEvents);
  return {
    adoption: buildFeatureAdoption(events),
    platform: buildPlatformMix(events),
    tripPhase: buildTripPhaseEngagement(events),
  };
};
