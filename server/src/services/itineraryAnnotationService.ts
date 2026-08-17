import type { AttractionCatalogEntry, AttractionDurationMetadata } from '../types';
import type { ActivityBlock } from '../schemas/itineraryCacheSchemas';
import {
  AnnotatedItinerarySchema,
  type AnnotatedActivity,
  type AnnotatedItinerary,
  type ItineraryEvidence,
} from '../schemas/annotatedItinerarySchemas';

type RouteRationaleInput = {
  thesis?: string;
  organizingFactors?: string[];
  tradeoffs?: string[];
};

type AnnotationRouteInput = {
  eh: string;
  xh: string;
  rationale?: RouteRationaleInput;
  assumptions?: string[];
  bases: Array<{ location: string; checkIn: string; checkOut: string; dayTrips?: string[]; rationale?: string }>;
  transfers: Array<{ date: string; mode: string; from: string; to: string; durationHours?: number; note?: string }>;
};

type AnnotationDayInput = {
  day: number;
  date: string;
  base: string;
  logisticsNotes?: string[];
  activities: Array<{
    name: string;
    activityType: string;
    startTime?: string | null;
    duration?: string | null;
  }>;
};

export type BuildAnnotatedItineraryInput = {
  route: AnnotationRouteInput;
  days: AnnotationDayInput[];
  catalogEntries: AttractionCatalogEntry[];
  durationMetadataByName: Map<string, AttractionDurationMetadata>;
  whyFitsByName: Map<string, string>;
  activityBlocks?: ActivityBlock[];
  validationRepairs?: string[];
};

const normalize = (value: unknown): string =>
  String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const boundedText = (value: unknown, maxLength: number): string =>
  String(value ?? '').trim().slice(0, maxLength);

const unique = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));

const boundedUnique = (
  values: Array<string | null | undefined>,
  maxItems: number,
  maxLength: number,
): string[] => unique(values).map((value) => value.slice(0, maxLength)).slice(0, maxItems);

const daysBetween = (start: string, end: string): number => {
  const startMs = Date.parse(`${start}T12:00:00Z`);
  const endMs = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 86_400_000));
};

const confidenceRank = { unknown: 0, provisional: 1, verified: 2 } as const;

const strongestConfidence = (evidence: ItineraryEvidence[]): 'verified' | 'provisional' | 'unknown' =>
  evidence.reduce<'verified' | 'provisional' | 'unknown'>((best, item) =>
    confidenceRank[item.confidence] > confidenceRank[best] ? item.confidence : best, 'unknown');

const evidenceFor = (
  entry: AttractionCatalogEntry | undefined,
  metadata: AttractionDurationMetadata | undefined,
  block: ActivityBlock | undefined,
): ItineraryEvidence[] => {
  const evidence: ItineraryEvidence[] = [];
  if (block) {
    const blockConfidence = block.source === 'llm_draft'
      ? 'unknown'
      : block.last_verified
        ? 'verified'
        : 'provisional';
    evidence.push({
      sourceType: block.source,
      sourceLabel: block.source === 'curated' ? 'Curated itinerary corpus' : block.source === 'partner' ? 'Travel partner corpus' : 'LLM-authored draft corpus',
      sourceUrl: null,
      verifiedAt: block.last_verified ? boundedText(block.last_verified, 80) : null,
      confidence: blockConfidence,
    });
  }
  if (entry?.sourceUrl || entry?.sourceLabel) {
    evidence.push({
      sourceType: 'catalog',
      sourceLabel: boundedText(entry.sourceLabel ?? 'Attractions catalog', 200),
      sourceUrl: entry.sourceUrl ? boundedText(entry.sourceUrl, 2000) : null,
      verifiedAt: entry.updatedAt ? boundedText(entry.updatedAt, 80) : null,
      confidence: 'provisional',
    });
  }
  if (metadata?.description && metadata.descriptionSource === 'wikipedia') {
    evidence.push({
      sourceType: 'wikipedia',
      sourceLabel: boundedText(entry?.wikipediaTitle ?? 'Wikipedia', 200),
      sourceUrl: entry?.wikipediaTitle ? boundedText(`https://en.wikipedia.org/wiki/${encodeURIComponent(entry.wikipediaTitle.replace(/ /g, '_'))}`, 2000) : null,
      verifiedAt: metadata.updatedAt ? boundedText(metadata.updatedAt, 80) : null,
      confidence: 'verified',
    });
  }
  return evidence.slice(0, 8);
};

const isWeatherDependent = (name: string, type: string, block?: ActivityBlock): boolean => {
  const text = `${name} ${type} ${block?.category ?? ''}`.toLowerCase();
  return /\b(hike|trail|mountain|beach|outdoor|park|garden|viewpoint|boat|kayak|cycling|walk)\b/.test(text);
};

const isIndoorBlock = (block: ActivityBlock): boolean =>
  /\b(museum|gallery|market|food|library|spa|wellness|theat(?:er|re)|temple interior)\b/i.test(`${block.category} ${block.title}`);

const actionTiming = (leadDays: number | undefined, risk: 'low' | 'medium' | 'high' | undefined): 'now' | 'soon' | 'before_trip' => {
  if ((leadDays ?? 0) >= 30 || risk === 'high') return 'now';
  if ((leadDays ?? 0) >= 7 || risk === 'medium') return 'soon';
  return 'before_trip';
};

const slug = (value: string): string => normalize(value).replace(/\s+/g, '-').slice(0, 100) || 'item';

export const buildAnnotatedItinerary = (input: BuildAnnotatedItineraryInput): AnnotatedItinerary => {
  const entryByName = new Map(input.catalogEntries.map((entry) => [normalize(entry.name), entry]));
  const blockByName = new Map((input.activityBlocks ?? []).map((block) => [normalize(block.title), block]));
  const blockById = new Map((input.activityBlocks ?? []).map((block) => [block.block_id, block]));
  const metadataByName = new Map(Array.from(input.durationMetadataByName.entries()).map(([name, metadata]) => [normalize(name), metadata]));
  const whyFitsByName = new Map(Array.from(input.whyFitsByName.entries()).map(([name, reason]) => [normalize(name), reason]));
  const actions: AnnotatedItinerary['actions'] = [];
  const operationalWarnings: string[] = [];
  const unsupportedActivities: string[] = [];
  const seenActionIds = new Set<string>();

  const addAction = (action: AnnotatedItinerary['actions'][number]) => {
    const boundedAction = {
      ...action,
      id: boundedText(action.id, 160),
      label: boundedText(action.label, 500),
      reason: boundedText(action.reason, 700),
    };
    if (seenActionIds.has(boundedAction.id)) return;
    seenActionIds.add(boundedAction.id);
    actions.push(boundedAction);
  };

  for (const base of input.route.bases) {
    addAction({
      id: `book-lodging-${slug(base.location)}-${base.checkIn}`,
      type: 'book',
      timing: 'soon',
      date: base.checkIn,
      label: `Book lodging in ${base.location} for ${base.checkIn} to ${base.checkOut}`,
      reason: 'The generated lodging is a planning placeholder until a real reservation is attached.',
      confidence: 'verified',
    });
  }

  for (const transfer of input.route.transfers) {
    if (transfer.mode === 'Flight') {
      addAction({
        id: `book-transfer-${slug(transfer.from)}-${slug(transfer.to)}-${transfer.date}`,
        type: 'book',
        timing: 'soon',
        date: transfer.date,
        label: `Book flight from ${transfer.from} to ${transfer.to}`,
        reason: 'The itinerary includes a required flight leg but no carrier or reservation is attached.',
        confidence: 'verified',
      });
    }
    if (transfer.note && /\b(verify|confirm|limited|fragile|reservation|book)\b/i.test(transfer.note)) {
      addAction({
        id: `verify-transfer-${slug(transfer.from)}-${slug(transfer.to)}-${transfer.date}`,
        type: 'verify',
        timing: 'one_week_before',
        date: transfer.date,
        label: `Verify ${transfer.mode.toLowerCase()} logistics from ${transfer.from} to ${transfer.to}`,
        reason: transfer.note,
        confidence: 'unknown',
      });
    }
  }

  const annotatedDays = input.days.map((day) => {
    const dayBlocks: ActivityBlock[] = [];
    const activities = day.activities.map((activity): AnnotatedActivity => {
      const key = normalize(activity.name);
      const entry = entryByName.get(key);
      const metadata = metadataByName.get(key);
      const block = blockByName.get(key);
      if (block) dayBlocks.push(block);
      const evidence = evidenceFor(entry, metadata, block);
      const blockAvailability = block?.availability;
      const bookingRequired = blockAvailability?.ticket_required ?? metadata?.requiresPreOrderTickets ?? null;
      const scheduleConfidence = blockAvailability?.operating_schedule?.confidence ?? 'unknown';
      const verificationRequired = bookingRequired === true && scheduleConfidence !== 'verified';
      const alternatives = boundedUnique(block?.relations?.substitutes_for.map((id) => blockById.get(id)?.title ?? id) ?? [], 8, 300);
      const confidence = strongestConfidence(evidence);
      if (!evidence.length) unsupportedActivities.push(boundedText(activity.name, 300));
      if (verificationRequired) {
        operationalWarnings.push(boundedText(`${activity.name}: ticket or operating details need confirmation.`, 700));
      }
      if (bookingRequired) {
        addAction({
          id: `book-activity-${slug(activity.name)}-${day.date}`,
          type: 'book',
          timing: actionTiming(blockAvailability?.booking_lead_days, blockAvailability?.sells_out_risk),
          date: day.date,
          label: `Reserve ${activity.name}`,
          reason: blockAvailability?.sells_out_risk
            ? `Ticket required; sell-out risk is ${blockAvailability.sells_out_risk}.`
            : 'This activity is marked as requiring advance tickets or pre-ordering.',
          confidence,
        });
      }
      if (verificationRequired) {
        addAction({
          id: `verify-activity-${slug(activity.name)}-${day.date}`,
          type: 'verify',
          timing: 'one_week_before',
          date: day.date,
          label: `Confirm hours and ticket availability for ${activity.name}`,
          reason: 'The activity may require booking, but no currently verified operating schedule is attached.',
          confidence: 'unknown',
        });
      }

      return {
        name: boundedText(activity.name, 300),
        activityType: boundedText(activity.activityType, 80),
        names: {
          display: boundedText(activity.name, 300),
          native: block?.name_local ? boundedText(block.name_local, 300) : null,
          romanized: block?.name_script ? boundedText(block.name_script, 300) : null,
          travelerLanguage: null,
        },
        whatItIs: block?.copy.body || metadata?.description ? boundedText(block?.copy.body || metadata?.description, 1600) : null,
        whyIncluded: whyFitsByName.get(key) ? boundedText(whyFitsByName.get(key), 600) : null,
        insiderTip: block?.copy.insider_tip ? boundedText(block.copy.insider_tip, 600) : null,
        etiquette: block?.copy.etiquette ? boundedText(block.copy.etiquette, 600) : null,
        priority: block?.copy.priority_signal ?? null,
        timing: {
          startTime: activity.startTime ? boundedText(activity.startTime, 20) : null,
          duration: activity.duration ? boundedText(activity.duration, 40) : (metadata ? `${metadata.estimatedDurationMinutes} min` : null),
          optimalArrival: block?.timing.optimal_arrival ? boundedText(block.timing.optimal_arrival, 200) : null,
          hardDeadline: block?.timing.hard_deadline ? boundedText(block.timing.hard_deadline, 200) : null,
          afterDarkValue: block?.timing.after_dark_value ?? false,
        },
        booking: {
          required: bookingRequired,
          leadDays: blockAvailability?.booking_lead_days ?? null,
          sellsOutRisk: blockAvailability?.sells_out_risk ?? null,
          verificationRequired,
        },
        effort: {
          energyCost: block?.energy_cost ?? (/\b(hike|trail|summit|mountain)\b/i.test(activity.name) ? 4 : null),
          weatherDependent: isWeatherDependent(activity.name, activity.activityType, block),
        },
        alternatives,
        evidence,
        confidence,
      };
    });

    for (const note of day.logisticsNotes ?? []) {
      if (!/\b(verify|confirm|book|ticket|passport|required|hours|closed|weather|luggage|bag)\b/i.test(note)) continue;
      addAction({
        id: `prepare-${slug(note)}-${day.date}`,
        type: /\b(book|ticket|reservation)\b/i.test(note) ? 'book' : /\b(verify|confirm|hours|closed)\b/i.test(note) ? 'verify' : 'prepare',
        timing: /\b(day of|passport)\b/i.test(note) ? 'day_of' : 'one_week_before',
        date: day.date,
        label: note,
        reason: 'This operational note affects the feasibility of the scheduled day.',
        confidence: 'unknown',
      });
    }

    const contingencies: AnnotatedItinerary['days'][number]['contingencies'] = [];
    const weatherDependent = activities.some((activity) => activity.effort.weatherDependent);
    if (weatherDependent) {
      const indoorAlternative = (input.activityBlocks ?? []).find((block) =>
        block.location_id === dayBlocks[0]?.location_id && block.role === 'contingency' && isIndoorBlock(block)
      );
      if (indoorAlternative) {
        contingencies.push({
          condition: 'rain',
          recommendation: `Use ${indoorAlternative.title} as the poor-weather replacement.`,
          confidence: indoorAlternative.last_verified ? 'verified' : indoorAlternative.source === 'llm_draft' ? 'unknown' : 'provisional',
        });
      }
    }
    const highEnergyActivities = activities.filter((activity) => (activity.effort.energyCost ?? 0) >= 4);
    if (highEnergyActivities.length >= 2) {
      contingencies.push({
        condition: 'fatigue',
        recommendation: `Treat ${highEnergyActivities[highEnergyActivities.length - 1].name} as optional if the group needs recovery time.`,
        confidence: 'provisional',
      });
    }

    const intensity = highEnergyActivities.length || activities.length >= 5
      ? 'high'
      : activities.length <= 2
        ? 'light'
        : 'balanced';
    const anchorNames = activities.slice(0, 2).map((activity) => activity.name);
    return {
      day: day.day,
      date: day.date,
      base: boundedText(day.base, 200),
      theme: boundedText(anchorNames.length ? `${day.base}: ${anchorNames.join(' and ')}` : `Flexible day in ${day.base}`, 400),
      intensity,
      logisticsNotes: boundedUnique(day.logisticsNotes ?? [], 12, 600),
      activities,
      contingencies,
    };
  });

  const baseNames = input.route.bases.map((base) => base.location);
  const hotelChanges = Math.max(0, input.route.bases.length - 1);
  const routeThesis = boundedText(
    boundedText(input.route.rationale?.thesis, 1200)
      || `Travel from ${input.route.eh} through ${baseNames.join(' → ')} and depart via ${input.route.xh}, using ${input.route.bases.length} bases and ${hotelChanges} hotel changes.`,
    1200,
  );
  const fragileConnections = input.route.transfers
    .filter((transfer) => (transfer.durationHours ?? 0) >= 4 || /\b(verify|confirm|limited|fragile|connection)\b/i.test(transfer.note ?? ''))
    .map((transfer) => ({
      date: transfer.date,
      from: boundedText(transfer.from, 200),
      to: boundedText(transfer.to, 200),
      reason: boundedText(transfer.note, 500) || `Long transfer estimated at about ${transfer.durationHours} hours; protect the arrival window with additional slack.`,
      confidence: transfer.note ? 'unknown' as const : 'estimated' as const,
    }));
  const allActivities = annotatedDays.flatMap((day) => day.activities);
  const hikes = annotatedDays.flatMap((day) => day.activities
    .filter((activity) => /\b(hike|trail|summit|mountain|peak)\b/i.test(`${activity.name} ${activity.activityType}`))
    .map((activity) => ({
      date: day.date,
      name: activity.name,
      distance: null,
      elevationGain: null,
      verificationRequired: true,
    })));
  const evidenceBacked = allActivities.filter((activity) => activity.evidence.length > 0).length;
  const evidenceCoverage = allActivities.length ? evidenceBacked / allActivities.length : 0;
  const sortedActions = actions.sort((a, b) => {
    const timingRank = { now: 0, soon: 1, before_trip: 2, one_week_before: 3, day_of: 4 } as const;
    return timingRank[a.timing] - timingRank[b.timing] || String(a.date ?? '').localeCompare(String(b.date ?? '')) || a.label.localeCompare(b.label);
  }).slice(0, 200);

  return AnnotatedItinerarySchema.parse({
    schemaVersion: 'annotated-itinerary-v1',
    route: {
      thesis: routeThesis,
      organizingFactors: boundedUnique([
        ...(input.route.rationale?.organizingFactors ?? []),
        ...(input.route.assumptions ?? []),
      ], 12, 500),
      tradeoffs: boundedUnique(input.route.rationale?.tradeoffs ?? [], 8, 500),
      hotelChanges,
      bases: input.route.bases.map((base) => ({
        location: boundedText(base.location, 200),
        checkIn: base.checkIn,
        checkOut: base.checkOut,
        nights: daysBetween(base.checkIn, base.checkOut),
        rationale: boundedText(
          boundedText(base.rationale, 700)
            || `${daysBetween(base.checkIn, base.checkOut)}-night base${base.dayTrips?.length ? ` with access to ${base.dayTrips.join(', ')}` : ''}.`,
          700,
        ),
        dayTrips: boundedUnique(base.dayTrips ?? [], 12, 200),
      })),
      fragileConnections,
    },
    days: annotatedDays,
    actions: sortedActions,
    summary: {
      dayCount: Math.max(1, annotatedDays.length),
      baseCount: Math.max(1, input.route.bases.length),
      hotelChanges,
      transferDays: new Set(input.route.transfers.map((transfer) => transfer.date)).size,
      bookingActionCount: sortedActions.filter((action) => action.type === 'book').length,
      hikes,
    },
    validation: {
      evidenceCoverage,
      unsupportedActivities: unique(unsupportedActivities).slice(0, 100),
      unverifiedOperationalFacts: unique(operationalWarnings).slice(0, 100),
      bookingActionsCovered: allActivities.every((activity) => activity.booking.required !== true
        || sortedActions.some((action) => action.type === 'book' && normalize(action.label).includes(normalize(activity.name)))),
      repairs: boundedUnique(input.validationRepairs ?? [], 100, 700),
    },
  });
};

type AvailabilityItem = [string, string, string];
type AvailabilityDay = { dt: string; it: AvailabilityItem[] };

const weekdayKeys = (date: string): string[] => {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`))
    .toLowerCase();
  return [weekday, weekday.slice(0, 3)];
};

const clockMinutes = (value: string | undefined): number | null => {
  const match = String(value ?? '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
};

const bucketMinutes: Record<string, number> = { M: 9 * 60, D: 13 * 60, E: 18 * 60 };

/**
 * Applies only explicit, verified ActivityBlock availability. Draft or
 * provisional schedules never remove or move an activity. This is deliberately
 * deterministic: the LLM selects the stop, while code enforces the calendar.
 */
export const repairActivitiesForVerifiedAvailability = <T extends { dy: AvailabilityDay[] }>(
  itinerary: T,
  blocks: ActivityBlock[],
): { itinerary: T; repairs: string[] } => {
  const output = JSON.parse(JSON.stringify(itinerary)) as T;
  const blockByName = new Map(blocks.map((block) => [normalize(block.title), block]));
  const repairs: string[] = [];

  for (const day of output.dy) {
    const keys = weekdayKeys(day.dt);
    day.it = day.it.flatMap((item): AvailabilityItem[] => {
      const block = blockByName.get(normalize(item[2]));
      const availability = block?.availability;
      const schedule = availability?.operating_schedule;
      if (!block || !availability || block.source === 'llm_draft' || schedule?.confidence !== 'verified') return [item];

      const exception = schedule.exceptions.find((candidate) => candidate.date === day.dt);
      const seasonal = schedule.seasonal_overrides.find((candidate) => day.dt >= candidate.from && day.dt <= candidate.through);
      const closedByWeekday = availability.closed_days.some((value) => keys.includes(String(value).trim().toLowerCase()));
      if (exception?.status === 'closed' || seasonal?.status === 'closed' || (closedByWeekday && exception?.status !== 'open')) {
        repairs.push(`${day.dt}: removed ${block.title} because verified availability marks it closed.`);
        return [];
      }

      const seasonalPeriod = seasonal?.opens && seasonal?.closes
        ? [{ opens: seasonal.opens, closes: seasonal.closes, last_entry: undefined }]
        : null;
      const weeklyPeriods = Object.entries(schedule.weekly).flatMap(([key, periods]) =>
        keys.includes(key.trim().toLowerCase()) ? periods : []
      );
      const periods = seasonalPeriod ?? weeklyPeriods;
      if (!periods.length) return [item];

      const currentMinutes = bucketMinutes[item[0]] ?? bucketMinutes.D;
      const fits = (minutes: number, period: { opens: string; closes: string; last_entry?: string }) => {
        const opens = clockMinutes(period.opens);
        const closes = clockMinutes(period.last_entry ?? period.closes);
        return opens !== null && closes !== null && minutes >= opens && minutes < closes;
      };
      if (periods.some((period) => fits(currentMinutes, period))) return [item];

      const replacement = (['M', 'D', 'E'] as const).find((bucket) => periods.some((period) => fits(bucketMinutes[bucket], period)));
      if (!replacement) return [item];
      repairs.push(`${day.dt}: moved ${block.title} from ${item[0]} to ${replacement} to fit its verified operating window.`);
      return [[replacement, item[1], item[2]]];
    });
  }

  return { itinerary: output, repairs };
};

export const renderAnnotatedItineraryMarkdown = (annotation: AnnotatedItinerary): string => {
  const lines: string[] = [];
  lines.push('## Route Strategy', '', annotation.route.thesis);
  if (annotation.route.organizingFactors.length) {
    lines.push('', '**Organizing factors**');
    annotation.route.organizingFactors.forEach((factor) => lines.push(`- ${factor}`));
  }
  if (annotation.route.tradeoffs.length) {
    lines.push('', '**Tradeoffs considered**');
    annotation.route.tradeoffs.forEach((tradeoff) => lines.push(`- ${tradeoff}`));
  }
  lines.push('', '### Base rationale');
  annotation.route.bases.forEach((base) => {
    lines.push(`- **${base.location} (${base.nights} night${base.nights === 1 ? '' : 's'})**: ${base.rationale}`);
  });
  if (annotation.route.fragileConnections.length) {
    lines.push('', '### Connections to verify');
    annotation.route.fragileConnections.forEach((connection) => {
      lines.push(`- **${connection.date}: ${connection.from} → ${connection.to}** — ${connection.reason}`);
    });
  }

  if (annotation.actions.length) {
    lines.push('', '## Booking & Verification Checklist');
    const labels: Record<AnnotatedItinerary['actions'][number]['timing'], string> = {
      now: 'Now',
      soon: 'Soon',
      before_trip: 'Before the trip',
      one_week_before: 'One week before',
      day_of: 'Day of',
    };
    for (const timing of ['now', 'soon', 'before_trip', 'one_week_before', 'day_of'] as const) {
      const group = annotation.actions.filter((action) => action.timing === timing);
      if (!group.length) continue;
      lines.push('', `### ${labels[timing]}`);
      group.forEach((action) => lines.push(`- [ ] ${action.label}${action.date ? ` (${action.date})` : ''} — ${action.reason}`));
    }
  }

  const noteworthyDays = annotation.days.filter((day) => day.contingencies.length || day.intensity === 'high');
  if (noteworthyDays.length) {
    lines.push('', '## Pace & Contingencies');
    noteworthyDays.forEach((day) => {
      const notes = day.contingencies.map((item) => `${item.condition}: ${item.recommendation}`);
      lines.push(`- **${day.date} — ${day.theme}**: ${day.intensity} intensity${notes.length ? `; ${notes.join('; ')}` : ''}.`);
    });
  }

  if (annotation.summary.hikes.length) {
    lines.push('', '## Physical Activity Summary');
    annotation.summary.hikes.forEach((hike) => {
      lines.push(`- **${hike.date}: ${hike.name}** — confirm current distance, elevation gain, conditions, and access before departure.`);
    });
  }

  if (annotation.validation.unsupportedActivities.length || annotation.validation.unverifiedOperationalFacts.length) {
    lines.push('', '> Operational details without current evidence are presented as verification tasks, not confirmed facts.');
  }
  if (annotation.validation.repairs.length) {
    lines.push('', '## Automated Validation Repairs');
    annotation.validation.repairs.forEach((repair) => lines.push(`- ${repair}`));
  }
  return lines.join('\n').trim();
};
