import { ITINERARY_STATUSES } from '../utils/itineraryStatus';
import type { ItineraryDocumentCandidate } from './itineraryDocumentImportService';

/**
 * Reads the itinerary WanderBunnies itself prints (app/utils/printableItinerary.ts) back into
 * import candidates. That layout is machine-regular, so this needs no model call: every day
 * section is split into its flights, trains, lodging, activities, car rentals and notes, and the
 * same booking repeated on several days is merged into one record.
 *
 * Text extraction glues each label to its value ("Departure12:00 · BOSArrival16:10 · NRT"), so
 * fields are split by walking the known labels in their printed order, never by punctuation.
 */

export type PrintedDetail = {
  kind: 'activity' | 'place' | 'note' | 'checklist';
  day: number;
  date: string;
  title: string;
  time: string | null;
  cost: number | null;
  /** Note body, or a place's description, with the printout's quote bars removed. */
  body: string | null;
  /** A place's printed address. */
  address: string | null;
  lat?: number | null;
  lng?: number | null;
  coordinateSource?: ItineraryDocumentCandidate['coordinateSource'];
  checklist: Array<{ label: string; checked: boolean }>;
  /** Position within the day, from the order of appearance. */
  order: number;
};

export type ParsedWanderBunniesPrint = {
  candidates: ItineraryDocumentCandidate[];
  details: PrintedDetail[];
  /** Trip.notes, printed under TRIP NOTES (format v2). */
  tripNotes: string | null;
  /** The AI narrative, printed under TRIP GUIDE (format v2). */
  tripGuide: string | null;
  /** 2 when the footer carries "Format v2"; 1 for earlier printouts. */
  version: 1 | 2;
  /** The currency printed on the cover, when there is one (items carry no currency of their own). */
  currency: string | null;
};

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};
const LONG_DATE = /([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/;
const DAY_HEADING = /^DAY\s+(\d{1,3})\s*(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\s*$/;
const TRANSFER_KINDS: Record<string, { type: ItineraryDocumentCandidate['type']; transferType: string }> = {
  'PUBLIC TRANSIT': { type: 'ferry_bus_transfer', transferType: 'Public Transit' },
  'PRIVATE TRANSFER': { type: 'ferry_bus_transfer', transferType: 'Private Transfer' },
  FLIGHT: { type: 'flight', transferType: 'Flight' },
  TRAIN: { type: 'rail', transferType: 'Public Transit' },
  BUS: { type: 'ferry_bus_transfer', transferType: 'Public Transit' },
  FERRY: { type: 'ferry_bus_transfer', transferType: 'Public Transit' },
  PRIVATE: { type: 'ferry_bus_transfer', transferType: 'Private Transfer' },
  OTHER: { type: 'ferry_bus_transfer', transferType: 'Other' },
  TRANSFER: { type: 'ferry_bus_transfer', transferType: 'Other' },
};
const DETAIL_KINDS = ['ACTIVITY', 'PLACE', 'NOTE', 'CHECKLIST'] as const;
// Extractors either glue the kind to its title ("FLIGHTBOS → NRT") or separate them ("FLIGHT BOS → NRT").
const ITEM_START = new RegExp(`^(${[...Object.keys(TRANSFER_KINDS), 'ACCOMMODATION', 'CAR RENTAL', ...DETAIL_KINDS].join('|')})(.*)$`);

// Labels are additive between format versions: v2 appends to the end of each list (and puts Status
// before Notes on rentals), so a v1 printout still walks the same labels in the same order.
const TRANSFER_LABELS = ['Carrier', 'Number', 'Departure', 'Arrival', 'Travelers', 'Booking reference', 'Layover', 'Layover duration', 'Cost', 'Status', 'Departure date', 'Arrival date'];
const LODGING_LABELS = ['Check-in', 'Check-out', 'Address', 'Rooms', 'Status', 'Refund by', 'Total', 'Per night', 'Coordinates', 'Coordinate source', 'Features', 'Notes'];
const TOUR_LABELS = ['Time', 'Location', 'Duration', 'Status', 'Category', 'Booking reference', 'Cost', 'Free cancellation by', 'Coordinates', 'Coordinate source', 'Booked on', 'Notes'];
const RENTAL_LABELS = ['Vehicle', 'Pick up', 'Drop off', 'Reference', 'Prepaid', 'Cost', 'Pick-up coordinates', 'Drop-off coordinates', 'Coordinate source', 'Status', 'Notes'];
const PLACE_LABELS = ['Address', 'Coordinates', 'Coordinate source'];
const STATUSES: readonly string[] = ITINERARY_STATUSES;
const ACTIVITY_TYPES = [
  'Class', 'Concert/Show', 'Day Trip', 'Event', 'Food & Drink', 'Fun & Games', 'Hike', 'Nightlife', 'Other',
  'Open Access', 'Outdoor Activity', 'Reservation', 'Shopping', 'Sights & Landmarks', 'Spa/Wellness',
  'Ticketed Attraction', 'Tour',
];
const COORDINATE_SOURCES = ['catalog', 'airport', 'manual', 'geocoder'] as const;

/** True for text produced by this app's own printable itinerary. */
export const isWanderBunniesPrint = (text: string): boolean =>
  /TRAVEL ITINERARY/.test(text)
  && /(Printed from WanderBunnies|saved in WanderBunnies)/.test(text)
  && /^DAY\s+\d{1,3}\s*\w+day,/m.test(text);

const isoFromLongDate = (value: string | undefined): string | null => {
  const match = LONG_DATE.exec(value ?? '');
  const month = match ? MONTHS[match[1].slice(0, 3).toLowerCase()] : undefined;
  return match && month ? `${match[3]}-${month}-${match[2].padStart(2, '0')}` : null;
};

const addDays = (iso: string, days: number): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const amount = (value: string | undefined): number | null => {
  const match = /(-?\d[\d,]*(?:\.\d+)?)/.exec(value ?? '');
  const parsed = match ? Number(match[1].replace(/,/g, '')) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** Splits "12:00 · BOS" into a time and a place; "Time TBD" and "Location TBD" are blanks. */
const timeAndPlace = (value: string | undefined): { time: string | null; place: string | null } => {
  const [first = '', ...rest] = (value ?? '').split(' · ');
  const time = /^\d{1,2}:\d{2}/.test(first.trim()) ? first.trim() : null;
  const place = (time ? rest : [first, ...rest]).join(' · ').trim();
  return { time, place: place && !/TBD$/.test(place) ? place : null };
};

/** Walks the labels in printed order; a label counts only after the previous one ended. */
const splitFields = (text: string, labels: string[]): Record<string, string> => {
  const found: Array<{ label: string; start: number; end: number }> = [];
  let position = 0;
  for (const label of labels) {
    let from = position;
    let index = text.indexOf(label, from);
    // "Layover" also begins "Layover duration"; the location label is never followed by " duration".
    while (index >= 0 && label === 'Layover' && text.startsWith(' duration', index + label.length)) {
      from = index + 1;
      index = text.indexOf(label, from);
    }
    if (index < 0) continue;
    found.push({ label, start: index, end: index + label.length });
    position = index + label.length;
  }
  const fields: Record<string, string> = {};
  found.forEach((entry, i) => {
    fields[entry.label] = text.slice(entry.end, found[i + 1]?.start ?? text.length).trim();
  });
  return fields;
};

type RawItem = { kind: string; heading: string; fieldText: string; lines: string[]; day: number; date: string | null; quote: string | null; order: number };

const isQuoteLine = (line: string): boolean => line.startsWith('>');
/** Removes the one leading "> " (or ">") per line that the printout adds, and nothing else. */
const unquote = (quoted: string[]): string => quoted.map((line) => line.replace(/^>\s?/, '')).join('\n').trim();

/** Splits quoted lines out of an item, dropping a bare "Notes" label line that introduced them. */
const takeQuote = (lines: string[]): { rest: string[]; quote: string | null } => {
  const rest: string[] = [];
  const quoted: string[] = [];
  for (const line of lines) {
    if (isQuoteLine(line)) {
      quoted.push(line);
      if (rest[rest.length - 1] === 'Notes') rest.pop();
    } else rest.push(line);
  }
  return { rest, quote: quoted.length ? unquote(quoted) : null };
};

const startsWithLabel = (line: string, labels: string[]): boolean => labels.some((label) => line.startsWith(label));

const labelsFor = (kind: string, lines: string[]): string[] | null => {
  if (kind in TRANSFER_KINDS) return TRANSFER_LABELS;
  if (kind === 'ACCOMMODATION') return LODGING_LABELS;
  if (kind === 'CAR RENTAL') return RENTAL_LABELS;
  // A tour activity prints Time/Location/Duration/Status; a day-plan item does not.
  // Any field may be empty (an activity with no start time begins at "Location"), but Status is always printed.
  return kind === 'ACTIVITY' && /Status\s*(?:Needed|Proposed|Needs Booking|Booked|Cancelled|Completed)/.test(lines.join(' ')) && lines.some((line) => startsWithLabel(line, TOUR_LABELS)) ? TOUR_LABELS : null;
};

const toItems = (dayLines: Array<{ day: number; date: string | null; lines: string[] }>): RawItem[] => {
  const items: RawItem[] = [];
  for (const day of dayLines) {
    let order = 0;
    const blocks: Array<{ kind: string; lines: string[] }> = [];
    for (const line of day.lines) {
      const start = ITEM_START.exec(line);
      if (start) blocks.push({ kind: start[1], lines: [start[2].trim()] });
      else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
    }
    for (const original of blocks) {
      const { rest, quote } = takeQuote(original.lines);
      const block = { kind: original.kind, lines: rest };
      const labels = labelsFor(block.kind, block.lines.slice(1));
      let split = block.lines.length;
      if (labels) {
        const found = block.lines.findIndex((line, index) => index > 0 && startsWithLabel(line, labels));
        if (found >= 0) split = found;
      }
      items.push({
        kind: labels === TOUR_LABELS ? 'TOUR' : block.kind,
        heading: block.lines.slice(0, split).join(' ').replace(/\s+/g, ' ').trim(),
        fieldText: block.lines.slice(split).join(' ').replace(/\s+/g, ' ').trim(),
        lines: block.lines,
        day: day.day,
        date: day.date,
        quote,
        order: order++,
      });
    }
  }
  return items;
};

/** "41.40363, 2.17436" becomes a point; anything missing or out of range becomes null. */
const point = (value: string | undefined): { lat: number; lng: number } | null => {
  const match = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec((value ?? '').trim());
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};
/** Coordinates need a recorded origin; an unrecognised one is treated as entered by hand. */
const coordinateSource = (value: string | undefined): ItineraryDocumentCandidate['coordinateSource'] =>
  COORDINATE_SOURCES.find((source) => source === (value ?? '').trim()) ?? 'manual';
const activityType = (value: string | undefined): string | null => ACTIVITY_TYPES.find((type) => type === (value ?? '').trim()) ?? null;

const status = (value: string | undefined): string | null => (value && STATUSES.includes(value) ? value : null);

/** Browser print headers/footers and blank page-break lines carry no itinerary content. */
const isPageNoise = (line: string): boolean =>
  !line
  || /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/.test(line)
  || /^about:blank$/i.test(line)
  || /^\d+\s*\/\s*\d+$/.test(line);

export const parseWanderBunniesPrint = (text: string): ParsedWanderBunniesPrint => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter((line) => !isPageNoise(line));
  const version: 1 | 2 = /WanderBunnies[^\n]*Format v2/.test(text) ? 2 : 1;
  const days: Array<{ day: number; date: string | null; lines: string[] }> = [];
  const tripNotesLines: string[] = [];
  const tripGuideLines: string[] = [];
  type Section = 'cover' | 'tripNotes' | 'tripGuide' | 'days';
  let section: Section = 'cover';
  // A browser's print header can repeat the trip title between pages; it is never itinerary content.
  const coverAt = lines.findIndex((line) => line === 'TRAVEL ITINERARY');
  const tripTitle = coverAt >= 0 ? lines[coverAt + 1] : undefined;
  for (const line of lines) {
    if (days.length && tripTitle && line === tripTitle) continue;
    const heading = DAY_HEADING.exec(line);
    const date = heading ? isoFromLongDate(heading[2]) : null;
    if (heading && date) { days.push({ day: Number(heading[1]), date, lines: [] }); section = 'days'; continue; }
    // The trip-level sections precede the first day; UNSCHEDULED follows the last one.
    if (version === 2 && line === 'TRIP NOTES' && section !== 'days') { section = 'tripNotes'; continue; }
    if (version === 2 && line === 'TRIP GUIDE' && section !== 'days') { section = 'tripGuide'; continue; }
    if (version === 2 && line === 'UNSCHEDULED') { days.push({ day: 0, date: null, lines: [] }); section = 'days'; continue; }
    // The closing boilerplate ("Trip notes" in v1, "Travel tips" in v2) is not itinerary content.
    if (/^(Trip notes|Travel tips)$/.test(line)) break;
    if (section === 'tripNotes') { if (isQuoteLine(line)) tripNotesLines.push(line); continue; }
    if (section === 'tripGuide') { if (isQuoteLine(line)) tripGuideLines.push(line); continue; }
    if (days.length) days[days.length - 1].lines.push(line);
  }

  const currencyAt = lines.findIndex((line) => line === 'CURRENCY');
  const printedCurrency = currencyAt >= 0 && /^[A-Z]{3}$/.test(lines[currencyAt + 1] ?? '') ? lines[currencyAt + 1] : null;

  const items = toItems(days);
  const candidates: ItineraryDocumentCandidate[] = [];
  const details: PrintedDetail[] = [];

  // Transfers: the printout lists a booking on its departure and arrival days (and lodging on
  // each night), so identical entries on consecutive days are one booking, not several.
  const transferGroups = new Map<string, ItineraryDocumentCandidate[]>();
  const seen = new Set<string>();

  for (const item of items) {
    // Only the UNSCHEDULED section has no date, and it holds activities alone.
    const itemDate = item.date as string;
    if (item.kind in TRANSFER_KINDS) {
      const fields = splitFields(item.fieldText, TRANSFER_LABELS);
      const [from = '', to = ''] = item.heading.split(' → ').map((part) => part.trim());
      const departure = timeAndPlace(fields.Departure);
      const arrival = timeAndPlace(fields.Arrival);
      const kind = TRANSFER_KINDS[item.kind];
      // v2 prints the real dates, which settle a layover or overnight leg without relying on adjacency.
      const explicitDeparture = isoFromLongDate(fields['Departure date']);
      const explicitArrival = isoFromLongDate(fields['Arrival date']);
      const key = [item.kind, from, to, departure.time, arrival.time, fields['Booking reference'], fields.Cost, fields.Carrier, fields.Number].join('|');
      const candidate: ItineraryDocumentCandidate = {
        type: kind.type,
        name: item.heading,
        departureDate: explicitDeparture ?? itemDate,
        arrivalDate: explicitArrival ?? explicitDeparture ?? itemDate,
        departureLocation: from || null,
        arrivalLocation: to || null,
        departureTime: departure.time,
        arrivalTime: arrival.time,
        carrier: fields.Carrier || null,
        flightNumber: fields.Number || null,
        confirmationNumber: fields['Booking reference'] || null,
        totalCost: amount(fields.Cost),
        status: status(fields.Status),
        travelerNames: fields.Travelers || null,
        layoverLocation: fields.Layover || null,
        layoverDuration: fields['Layover duration'] || null,
        flight: { departureLocation: from || null, arrivalLocation: to || null, carrier: fields.Carrier || null, transferType: kind.transferType },
        day: item.day,
        date: explicitDeparture ?? itemDate,
        sourceExcerpt: item.lines.join('\n').slice(0, 500),
      };
      const groups = transferGroups.get(key) ?? [];
      if (explicitDeparture) {
        if (!groups.some((group) => group.departureDate === candidate.departureDate && group.arrivalDate === candidate.arrivalDate)) {
          groups.push(candidate);
          candidates.push(candidate);
        }
      } else {
        const last = groups[groups.length - 1];
        const maxGap = kind.transferType === 'Flight' ? 2 : 1;
        const lastDate = last?.arrivalDate ?? null;
        if (last && lastDate && lastDate !== itemDate && itemDate > lastDate && itemDate <= addDays(lastDate, maxGap)) {
          last.arrivalDate = itemDate;
        } else if (!(last && lastDate === itemDate)) {
          groups.push(candidate);
          candidates.push(candidate);
        }
      }
      transferGroups.set(key, groups);
    } else if (item.kind === 'ACCOMMODATION') {
      const fields = splitFields(item.fieldText, LODGING_LABELS);
      const checkIn = isoFromLongDate(fields['Check-in']);
      const checkOut = isoFromLongDate(fields['Check-out']);
      const key = `hotel|${item.heading}|${checkIn}|${checkOut}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const located = point(fields.Coordinates);
      const features = (fields.Features ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
      candidates.push({
        type: 'hotel',
        name: item.heading,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        address: fields.Address || null,
        rooms: amount(fields.Rooms),
        status: status(fields.Status),
        refundBy: isoFromLongDate(fields['Refund by']),
        totalCost: amount(fields.Total),
        costPerNight: amount(fields['Per night']),
        features: features.length ? [...new Set(features)] : undefined,
        notes: item.quote ?? (fields.Notes || null),
        ...(located ? { lat: located.lat, lng: located.lng, coordinateSource: coordinateSource(fields['Coordinate source']) } : {}),
        day: item.day,
        date: checkIn ?? itemDate,
        sourceExcerpt: item.lines.join('\n').slice(0, 500),
      });
    } else if (item.kind === 'TOUR') {
      const fields = splitFields(item.fieldText, TOUR_LABELS);
      const key = `tour|${item.heading}|${item.date}|${fields.Time}|${fields.Location}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const located = point(fields.Coordinates);
      candidates.push({
        type: 'tour_activity',
        name: item.heading,
        activityDate: item.date,
        activityTime: fields.Time || null,
        location: fields.Location || null,
        duration: fields.Duration || null,
        status: status(fields.Status),
        confirmationNumber: fields['Booking reference'] || null,
        totalCost: amount(fields.Cost),
        freeCancelBy: isoFromLongDate(fields['Free cancellation by']),
        bookedOn: fields['Booked on'] || null,
        notes: item.quote ?? (fields.Notes || null),
        order: item.order,
        ...(item.date === null ? { unscheduled: true } : {}),
        ...(located ? { lat: located.lat, lng: located.lng, coordinateSource: coordinateSource(fields['Coordinate source']) } : {}),
        activity: { activityType: activityType(fields.Category), startLocation: fields.Location || null },
        day: item.day,
        date: item.date,
        sourceExcerpt: item.lines.join('\n').slice(0, 500),
      });
    } else if (item.kind === 'CAR RENTAL') {
      const fields = splitFields(item.fieldText, RENTAL_LABELS);
      const pickup = fields['Pick up'] ?? '';
      const dropoff = fields['Drop off'] ?? '';
      const pickupDate = isoFromLongDate(pickup);
      const dropoffDate = isoFromLongDate(dropoff);
      const pickupPlace = timeAndPlace(pickup.slice(pickup.indexOf(' · ') >= 0 ? pickup.indexOf(' · ') + 3 : pickup.length)).place;
      const dropoffPlace = timeAndPlace(dropoff.slice(dropoff.indexOf(' · ') >= 0 ? dropoff.indexOf(' · ') + 3 : dropoff.length)).place;
      const key = `rental|${item.heading}|${pickupDate}|${dropoffDate}|${fields.Reference}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Newer printouts label the note; older ones leave it after the cost figure.
      const costMatch = /^([A-Z]{3}\s+-?\d[\d,]*(?:\.\d+)?)\s*(.*)$/.exec(fields.Cost ?? '');
      const pickupPoint = point(fields['Pick-up coordinates']);
      const dropoffPoint = point(fields['Drop-off coordinates']);
      candidates.push({
        type: 'car_rental',
        name: item.heading,
        providerVendor: item.heading !== fields.Vehicle && item.heading !== 'Rental car' ? item.heading : null,
        vehicleType: fields.Vehicle || null,
        pickupDate,
        pickupLocation: pickupPlace,
        dropoffDate,
        dropoffLocation: dropoffPlace,
        confirmationNumber: fields.Reference || null,
        prepaid: fields.Prepaid || null,
        totalCost: amount(costMatch ? costMatch[1] : fields.Cost),
        status: status(fields.Status),
        notes: item.quote ?? (fields.Notes || costMatch?.[2]?.trim() || null),
        ...(pickupPoint || dropoffPoint ? {
          lat: pickupPoint?.lat ?? null, lng: pickupPoint?.lng ?? null,
          dropoffLat: dropoffPoint?.lat ?? null, dropoffLng: dropoffPoint?.lng ?? null,
          coordinateSource: coordinateSource(fields['Coordinate source']),
        } : {}),
        day: item.day,
        date: pickupDate ?? itemDate,
        sourceExcerpt: item.lines.join('\n').slice(0, 500),
      });
    } else {
      // Day-plan items: a title, an optional time and cost, a quoted body, a place's address, and for
      // checklists their entries with their checked state.
      const kind = item.kind.toLowerCase() as PrintedDetail['kind'];
      const titleLines = [item.lines[0]];
      let time: string | null = null;
      let cost: number | null = null;
      const checklist: PrintedDetail['checklist'] = [];
      const placeLines: string[] = [];
      for (const line of item.lines.slice(1)) {
        if (/^\d{1,2}:\d{2}(\s?[AaPp][Mm])?$/.test(line) || /^\d{1,2}\s?[AaPp][Mm]$/.test(line)) time = line;
        else if (/^Cost:/.test(line)) cost = amount(line.slice(5));
        else if (/^[✓☑✔□☐]/.test(line)) checklist.push({ label: line.replace(/^[✓☑✔□☐]\s*/, '').trim(), checked: /^[✓☑✔]/.test(line) });
        else if (kind === 'place' && (placeLines.length || startsWithLabel(line, PLACE_LABELS))) placeLines.push(line);
        else if (!time && cost === null && !checklist.length) titleLines.push(line);
      }
      const title = titleLines.join(' ').replace(/\s+/g, ' ').trim();
      if (!title) continue;
      const key = `detail|${kind}|${item.date}|${title}|${time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const placeFields = placeLines.length ? splitFields(placeLines.join(' ').replace(/\s+/g, ' ').trim(), PLACE_LABELS) : {};
      const located = point(placeFields.Coordinates);
      details.push({
        kind, day: item.day, date: itemDate, title, time, cost,
        body: item.quote,
        address: placeFields.Address || null,
        ...(located ? { lat: located.lat, lng: located.lng, coordinateSource: coordinateSource(placeFields['Coordinate source']) } : {}),
        checklist,
        order: item.order,
      });
    }
  }
  return {
    candidates,
    details,
    currency: printedCurrency,
    tripNotes: tripNotesLines.length ? unquote(tripNotesLines) : null,
    tripGuide: tripGuideLines.length ? unquote(tripGuideLines) : null,
    version,
  };
};
