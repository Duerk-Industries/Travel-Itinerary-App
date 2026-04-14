import { createHash, randomUUID } from 'crypto';

export type ParserTrainingItemType = 'flight' | 'hotel' | 'rail' | 'generic_note';

export type ParserTrainingLabelItem = {
  providerVendor: string | null;
  confirmationNumber: string | null;
  travelers: string[];
  totalCost: number | null;
  currency: string | null;
  name: string | null;
  guestName: string | null;
  address: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  rooms: number | null;
  breakfastIncluded: boolean | null;
  freeCancelBy: string | null;
  paid: boolean | null;
  airline: string | null;
  flightNumber: string | null;
  departureAirportCode: string | null;
  arrivalAirportCode: string | null;
  departureDate: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  duration: string | null;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  vehicleType: string | null;
  activityDate: string | null;
  activityTime: string | null;
  eventVenue: string | null;
  partySize: number | null;
  mealType: string | null;
  departureLocation: string | null;
  arrivalLocation: string | null;
};

export type ParserTrainingExample = {
  id: string;
  split: 'train' | 'validation';
  origin: 'public_markup' | 'synthetic' | 'oss_raw_email';
  source: {
    title: string;
    provider: string;
    sourceType: 'official_docs' | 'synthetic' | 'oss_corpus';
    url: string | null;
    harvestedAt: string;
    licenseHint: string | null;
  };
  email: {
    from: string;
    to: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    rawEmail: string;
  };
  label: {
    itemType: ParserTrainingItemType;
    items: ParserTrainingLabelItem[];
  };
  artifacts?: {
    jsonLd?: unknown;
  };
};

const normalizeSpace = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const toIsoDate = (value: unknown): string | null => {
  const normalized = normalizeSpace(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const toDisplayTime = (value: unknown): string | null => {
  const normalized = normalizeSpace(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    const directMatch = normalized.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!directMatch) return null;
    const hours = Number(directMatch[1]);
    const minutes = directMatch[2];
    const suffix = directMatch[3]?.toUpperCase();
    if (suffix) return `${String(hours).padStart(2, '0')}:${minutes} ${suffix}`;
    if (hours === 0) return `12:${minutes} AM`;
    if (hours < 12) return `${String(hours).padStart(2, '0')}:${minutes} AM`;
    if (hours === 12) return `12:${minutes} PM`;
    return `${String(hours - 12).padStart(2, '0')}:${minutes} PM`;
  }
  const hours = parsed.getUTCHours();
  const minutes = String(parsed.getUTCMinutes()).padStart(2, '0');
  if (hours === 0) return `12:${minutes} AM`;
  if (hours < 12) return `${String(hours).padStart(2, '0')}:${minutes} AM`;
  if (hours === 12) return `12:${minutes} PM`;
  return `${String(hours - 12).padStart(2, '0')}:${minutes} PM`;
};

const stableHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const toSplit = (seed: string): 'train' | 'validation' =>
  parseInt(stableHash(seed).slice(0, 8), 16) % 5 === 0 ? 'validation' : 'train';

const reservationArray = (value: unknown): any[] => Array.isArray(value) ? value : [value].filter(Boolean);

const decodeQuotedPrintable = (value: string): string =>
  value
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const normalizeRawText = (value: string): string =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

export const parseRawEmailBasic = (rawEmail: string): {
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  headers: Record<string, string>;
} => {
  const normalized = normalizeRawText(rawEmail);
  const splitIndex = normalized.indexOf('\n\n');
  const headerText = splitIndex >= 0 ? normalized.slice(0, splitIndex) : normalized;
  let bodyText = splitIndex >= 0 ? normalized.slice(splitIndex + 2) : '';
  const unfolded = headerText.replace(/\n[ \t]+/g, ' ');
  const headers: Record<string, string> = {};
  for (const line of unfolded.split('\n')) {
    const delimiter = line.indexOf(':');
    if (delimiter <= 0) continue;
    headers[line.slice(0, delimiter).trim().toLowerCase()] = line.slice(delimiter + 1).trim();
  }

  if (/quoted-printable/i.test(headers['content-transfer-encoding'] ?? '')) {
    bodyText = decodeQuotedPrintable(bodyText);
  }

  const contentType = headers['content-type'] ?? '';
  const textBody = /text\/html/i.test(contentType) ? '' : bodyText.trim();
  const htmlBody = /text\/html/i.test(contentType) ? bodyText.trim() : '';
  return {
    from: headers.from ?? '',
    to: headers.to ?? '',
    subject: headers.subject ?? '',
    textBody,
    htmlBody,
    headers,
  };
};

const flattenJsonLdReservations = (value: unknown, targetType: string): any[] => {
  const reservations: any[] = [];
  for (const entry of reservationArray(value)) {
    if (!entry || typeof entry !== 'object') continue;
    const type = normalizeSpace((entry as any)['@type']);
    if (type === targetType) {
      reservations.push(entry);
    } else if (Array.isArray(entry)) {
      reservations.push(...flattenJsonLdReservations(entry, targetType));
    }
  }
  return reservations;
};

const personName = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return normalizeSpace(value) || null;
  if (typeof value === 'object') return normalizeSpace((value as any).name) || null;
  return null;
};

const asNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const joinAddress = (address: any): string | null => {
  if (!address || typeof address !== 'object') return null;
  const parts = [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
    address.addressCountry,
  ].map(normalizeSpace).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
};

export const extractJsonLdBlocks = (html: string): unknown[] => {
  const blocks: unknown[] = [];
  const seen = new Set<string>();
  const tryPush = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) return;
    try {
      const parsed = JSON.parse(normalized);
      const key = JSON.stringify(parsed);
      if (seen.has(key)) return;
      seen.add(key);
      blocks.push(parsed);
    } catch {
      return;
    }
  };
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    tryPush(match[1]);
  }

  const codePattern = /<pre[^>]*syntax=["']JSON-LD["'][^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi;
  while ((match = codePattern.exec(html)) !== null) {
    const withoutTags = match[1].replace(/<[^>]+>/g, '');
    const decoded = decodeHtmlEntities(withoutTags);
    const scriptMatch = decoded.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch) {
      tryPush(scriptMatch[1]);
    }
  }
  return blocks;
};

const emptyLabelItem = (): ParserTrainingLabelItem => ({
  providerVendor: null,
  confirmationNumber: null,
  travelers: [],
  totalCost: null,
  currency: null,
  name: null,
  guestName: null,
  address: null,
  checkInDate: null,
  checkOutDate: null,
  rooms: null,
  breakfastIncluded: null,
  freeCancelBy: null,
  paid: null,
  airline: null,
  flightNumber: null,
  departureAirportCode: null,
  arrivalAirportCode: null,
  departureDate: null,
  departureTime: null,
  arrivalTime: null,
  duration: null,
  pickupLocation: null,
  dropoffLocation: null,
  vehicleType: null,
  activityDate: null,
  activityTime: null,
  eventVenue: null,
  partySize: null,
  mealType: null,
  departureLocation: null,
  arrivalLocation: null,
});

export const flightReservationToLabelItem = (reservation: any): ParserTrainingLabelItem => {
  const flight = reservation?.reservationFor ?? {};
  const traveler = personName(reservation?.underName);
  return {
    ...emptyLabelItem(),
    providerVendor: normalizeSpace(flight?.airline?.name) || null,
    confirmationNumber: normalizeSpace(reservation?.reservationNumber) || null,
    travelers: traveler ? [traveler] : [],
    airline: normalizeSpace(flight?.airline?.name) || null,
    flightNumber: normalizeSpace(flight?.flightNumber) || null,
    departureAirportCode: normalizeSpace(flight?.departureAirport?.iataCode).toUpperCase() || null,
    arrivalAirportCode: normalizeSpace(flight?.arrivalAirport?.iataCode).toUpperCase() || null,
    departureDate: toIsoDate(flight?.departureTime),
    departureTime: toDisplayTime(flight?.departureTime),
    arrivalTime: toDisplayTime(flight?.arrivalTime),
    departureLocation: normalizeSpace(flight?.departureAirport?.name) || null,
    arrivalLocation: normalizeSpace(flight?.arrivalAirport?.name) || null,
  };
};

export const lodgingReservationToLabelItem = (reservation: any): ParserTrainingLabelItem => {
  const lodging = reservation?.reservationFor ?? {};
  const traveler = personName(reservation?.underName);
  return {
    ...emptyLabelItem(),
    providerVendor: normalizeSpace(lodging?.name) || null,
    confirmationNumber: normalizeSpace(reservation?.reservationNumber) || null,
    travelers: traveler ? [traveler] : [],
    name: normalizeSpace(lodging?.name) || null,
    guestName: traveler,
    address: joinAddress(lodging?.address),
    checkInDate: toIsoDate(reservation?.checkinDate),
    checkOutDate: toIsoDate(reservation?.checkoutDate),
  };
};

export const trainReservationToLabelItem = (reservation: any): ParserTrainingLabelItem => {
  const trip = reservation?.reservationFor ?? {};
  const traveler = personName(reservation?.underName) ?? personName(reservation?.reservedTicket?.underName);
  return {
    ...emptyLabelItem(),
    providerVendor: normalizeSpace(reservation?.bookingAgent?.name) || 'Train Reservation',
    confirmationNumber: normalizeSpace(reservation?.reservationNumber) || null,
    travelers: traveler ? [traveler] : [],
    flightNumber: normalizeSpace(reservation?.reservedTicket?.ticketNumber) || null,
    departureDate: toIsoDate(trip?.departureTime),
    departureTime: toDisplayTime(trip?.departureTime),
    arrivalTime: toDisplayTime(trip?.arrivalTime),
    departureLocation: normalizeSpace(trip?.departureStation?.name) || null,
    arrivalLocation: normalizeSpace(trip?.arrivalStation?.name) || null,
  };
};

const makeRawEmail = (from: string, to: string, subject: string, textBody: string, htmlBody: string): string => [
  `From: ${from}`,
  `To: ${to}`,
  `Subject: ${subject}`,
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="boundary42"',
  '',
  '--boundary42',
  'Content-Type: text/plain; charset="UTF-8"',
  '',
  textBody,
  '',
  '--boundary42',
  'Content-Type: text/html; charset="UTF-8"',
  '',
  htmlBody,
  '',
  '--boundary42--',
].join('\n');

const flightSubject = (items: ParserTrainingLabelItem[]): string => {
  const first = items[0];
  return `Your flight reservation ${first.confirmationNumber ?? 'confirmed'} is confirmed`;
};

const hotelSubject = (items: ParserTrainingLabelItem[]): string => {
  const first = items[0];
  return `Your hotel stay at ${first.name ?? 'your hotel'} is confirmed`;
};

const railSubject = (items: ParserTrainingLabelItem[]): string => {
  const first = items[0];
  return `Your rail reservation ${first.confirmationNumber ?? 'confirmed'} is confirmed`;
};

const renderEmailBodies = (itemType: ParserTrainingItemType, items: ParserTrainingLabelItem[]) => {
  const first = items[0];
  if (itemType === 'hotel') {
    const lines = [
      `Reservation: ${first.confirmationNumber ?? 'N/A'}`,
      `Guest: ${first.guestName ?? first.travelers[0] ?? 'Traveler'}`,
      `Property: ${first.name ?? 'Hotel'}`,
      `Address: ${first.address ?? 'See property details'}`,
      `Check-in: ${first.checkInDate ?? 'TBD'}`,
      `Check-out: ${first.checkOutDate ?? 'TBD'}`,
    ];
    return {
      subject: hotelSubject(items),
      textBody: lines.join('\n'),
      htmlBody: `<p>${lines.map(escapeHtml).join('<br/>')}</p>`,
    };
  }

  const lines = items.map((item, index) => {
    const prefix = items.length > 1 ? `Leg ${index + 1}: ` : '';
    return `${prefix}${item.departureLocation ?? 'Unknown'} ${item.departureTime ?? ''} -> ${item.arrivalLocation ?? 'Unknown'} ${item.arrivalTime ?? ''}`.trim();
  });
  const header = itemType === 'flight'
    ? [
        `Reservation: ${first.confirmationNumber ?? 'N/A'}`,
        `Traveler: ${first.travelers[0] ?? 'Traveler'}`,
        `Airline: ${first.airline ?? first.providerVendor ?? 'Carrier'}`,
      ]
    : [
        `Reservation: ${first.confirmationNumber ?? 'N/A'}`,
        `Traveler: ${first.travelers[0] ?? 'Traveler'}`,
        'Rail itinerary details:',
      ];
  const allLines = [...header, ...lines];
  return {
    subject: itemType === 'flight' ? flightSubject(items) : railSubject(items),
    textBody: allLines.join('\n'),
    htmlBody: `<p>${allLines.map(escapeHtml).join('<br/>')}</p>`,
  };
};

export const buildPublicMarkupExample = (params: {
  itemType: ParserTrainingItemType;
  title: string;
  provider: string;
  url: string;
  harvestedAt: string;
  jsonLd: unknown;
}): ParserTrainingExample | null => {
  const reservations =
    params.itemType === 'flight'
      ? flattenJsonLdReservations(params.jsonLd, 'FlightReservation').map(flightReservationToLabelItem)
      : params.itemType === 'hotel'
        ? flattenJsonLdReservations(params.jsonLd, 'LodgingReservation').map(lodgingReservationToLabelItem)
        : flattenJsonLdReservations(params.jsonLd, 'TrainReservation').map(trainReservationToLabelItem);
  if (!reservations.length) return null;

  const rendered = renderEmailBodies(params.itemType, reservations);
  const from =
    params.itemType === 'flight' ? 'reservations@example-airline.com'
      : params.itemType === 'hotel' ? 'stays@example-hotel.com'
        : 'tickets@example-rail.com';
  const to = normalizeSpace(reservations[0]?.travelers?.[0]).toLowerCase().replace(/\s+/g, '.') || 'traveler@example.com';
  const rawEmail = makeRawEmail(from, to.includes('@') ? to : `${to}@example.com`, rendered.subject, rendered.textBody, rendered.htmlBody);
  const idSeed = `${params.url}|${JSON.stringify(params.jsonLd)}`;
  return {
    id: randomUUID(),
    split: toSplit(idSeed),
    origin: 'public_markup',
    source: {
      title: params.title,
      provider: params.provider,
      sourceType: 'official_docs',
      url: params.url,
      harvestedAt: params.harvestedAt,
      licenseHint: 'Public documentation example',
    },
    email: {
      from,
      to: to.includes('@') ? to : `${to}@example.com`,
      subject: rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
      rawEmail,
    },
    label: {
      itemType: params.itemType,
      items: reservations,
    },
    artifacts: {
      jsonLd: params.jsonLd,
    },
  };
};

type SyntheticSeed = {
  travelers: string[];
  confirmationNumber: string;
  providerVendor: string;
  departureLocation?: string;
  departureAirportCode?: string;
  arrivalLocation?: string;
  arrivalAirportCode?: string;
  departureDate?: string;
  departureTime?: string;
  arrivalTime?: string;
  flightNumber?: string;
  hotelName?: string;
  address?: string;
  checkInDate?: string;
  checkOutDate?: string;
};

const syntheticRawEmail = (
  from: string,
  to: string,
  subject: string,
  lead: string,
  details: string[],
  footer: string
) => {
  const textBody = [lead, '', ...details, '', footer].join('\n');
  const htmlBody = `<p>${escapeHtml(lead)}</p><ul>${details.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul><p>${escapeHtml(footer)}</p>`;
  return {
    textBody,
    htmlBody,
    rawEmail: makeRawEmail(from, to, subject, textBody, htmlBody),
  };
};

export const buildSyntheticExamples = (counts: {
  flight: number;
  hotel: number;
  rail: number;
}): ParserTrainingExample[] => {
  const travelerPool = [
    'Eva Green',
    'John Green',
    'Bryan Duerk',
    'Vicky Duerk',
    'Jasmine Duerk',
    'Marleen Doerk',
  ];
  const flightSeeds = [
    ['United', 'JFK', 'John F. Kennedy International Airport', 'ORD', "O'Hare International Airport"],
    ['Delta Air Lines', 'BOS', 'Boston Logan International Airport', 'SEA', 'Seattle-Tacoma International Airport'],
    ['Ryanair', 'BGY', 'Milan Bergamo Airport', 'OTP', 'Henri Coanda International Airport'],
  ] as const;
  const hotelSeeds = [
    ['Hilton San Francisco Union Square', "333 O'Farrell St, San Francisco, CA 94102, US"],
    ['MOOONS Vienna', 'Wiedner Gürtel 16, 1040 Vienna, AT'],
    ['Scandic Voss', 'Evangervegen 1A, 5704 Voss, NO'],
  ] as const;
  const railSeeds = [
    ['Munich Central', 'Paris Gare De Lyon'],
    ['London St Pancras International', 'Paris Gare Du Nord'],
    ['Roma Termini', 'Firenze Santa Maria Novella'],
  ] as const;

  const examples: ParserTrainingExample[] = [];
  let counter = 1;
  const nextConfirmation = () => `PX${String(counter++).padStart(5, '0')}`;

  for (let i = 0; i < counts.flight; i += 1) {
    const traveler = travelerPool[i % travelerPool.length];
    const [providerVendor, departureAirportCode, departureLocation, arrivalAirportCode, arrivalLocation] = flightSeeds[i % flightSeeds.length];
    const item: ParserTrainingLabelItem = {
      ...emptyLabelItem(),
      providerVendor,
      confirmationNumber: nextConfirmation(),
      travelers: [traveler],
      airline: providerVendor,
      flightNumber: `${providerVendor.slice(0, 2).toUpperCase().replace(/[^A-Z]/g, 'X')}${200 + i}`,
      departureAirportCode,
      arrivalAirportCode,
      departureDate: `2027-0${(i % 8) + 1}-${String((i % 20) + 5).padStart(2, '0')}`,
      departureTime: '09:15 AM',
      arrivalTime: '12:05 PM',
      departureLocation,
      arrivalLocation,
    };
    const subject = `Trip confirmation ${item.confirmationNumber} - ${departureAirportCode} to ${arrivalAirportCode}`;
    const rendered = syntheticRawEmail(
      'reservations@synthetic-air.example',
      'traveler@example.com',
      subject,
      `Hi ${traveler}, your itinerary is confirmed.`,
      [
        `Confirmation code: ${item.confirmationNumber}`,
        `Carrier: ${providerVendor}`,
        `Flight: ${item.flightNumber}`,
        `Departure: ${departureLocation} (${departureAirportCode}) on ${item.departureDate} at ${item.departureTime}`,
        `Arrival: ${arrivalLocation} (${arrivalAirportCode}) at ${item.arrivalTime}`,
      ],
      'This is a synthetic training email generated for parser validation.',
    );
    examples.push({
      id: randomUUID(),
      split: toSplit(subject),
      origin: 'synthetic',
      source: {
        title: 'Synthetic flight reservation',
        provider: providerVendor,
        sourceType: 'synthetic',
        url: null,
        harvestedAt: new Date().toISOString(),
        licenseHint: null,
      },
      email: {
        from: 'reservations@synthetic-air.example',
        to: 'traveler@example.com',
        subject,
        ...rendered,
      },
      label: {
        itemType: 'flight',
        items: [item],
      },
    });
  }

  for (let i = 0; i < counts.hotel; i += 1) {
    const traveler = travelerPool[i % travelerPool.length];
    const [hotelName, address] = hotelSeeds[i % hotelSeeds.length];
    const item: ParserTrainingLabelItem = {
      ...emptyLabelItem(),
      providerVendor: hotelName,
      confirmationNumber: nextConfirmation(),
      travelers: [traveler],
      name: hotelName,
      guestName: traveler,
      address,
      checkInDate: `2027-0${(i % 8) + 1}-${String((i % 20) + 10).padStart(2, '0')}`,
      checkOutDate: `2027-0${(i % 8) + 1}-${String((i % 20) + 12).padStart(2, '0')}`,
      paid: i % 2 === 0,
    };
    const subject = `Stay confirmed: ${hotelName} (${item.confirmationNumber})`;
    const rendered = syntheticRawEmail(
      'stays@synthetic-hotel.example',
      'traveler@example.com',
      subject,
      `Hello ${traveler}, your hotel stay is booked.`,
      [
        `Confirmation number: ${item.confirmationNumber}`,
        `Property: ${hotelName}`,
        `Address: ${address}`,
        `Check-in: ${item.checkInDate}`,
        `Check-out: ${item.checkOutDate}`,
      ],
      'Synthetic training example for lodging extraction.',
    );
    examples.push({
      id: randomUUID(),
      split: toSplit(subject),
      origin: 'synthetic',
      source: {
        title: 'Synthetic hotel reservation',
        provider: hotelName,
        sourceType: 'synthetic',
        url: null,
        harvestedAt: new Date().toISOString(),
        licenseHint: null,
      },
      email: {
        from: 'stays@synthetic-hotel.example',
        to: 'traveler@example.com',
        subject,
        ...rendered,
      },
      label: {
        itemType: 'hotel',
        items: [item],
      },
    });
  }

  for (let i = 0; i < counts.rail; i += 1) {
    const traveler = travelerPool[i % travelerPool.length];
    const [departureLocation, arrivalLocation] = railSeeds[i % railSeeds.length];
    const item: ParserTrainingLabelItem = {
      ...emptyLabelItem(),
      providerVendor: 'Rail Europe',
      confirmationNumber: nextConfirmation(),
      travelers: [traveler],
      flightNumber: `TKT${8000 + i}`,
      departureDate: `2027-0${(i % 8) + 1}-${String((i % 20) + 3).padStart(2, '0')}`,
      departureTime: '10:30 AM',
      arrivalTime: '03:10 PM',
      departureLocation,
      arrivalLocation,
    };
    const subject = `Rail ticket ${item.confirmationNumber} from ${departureLocation} to ${arrivalLocation}`;
    const rendered = syntheticRawEmail(
      'tickets@synthetic-rail.example',
      'traveler@example.com',
      subject,
      `Dear ${traveler}, your rail booking is confirmed.`,
      [
        `Reservation: ${item.confirmationNumber}`,
        `Ticket number: ${item.flightNumber}`,
        `Depart: ${departureLocation} on ${item.departureDate} at ${item.departureTime}`,
        `Arrive: ${arrivalLocation} at ${item.arrivalTime}`,
      ],
      'Synthetic training example for rail extraction.',
    );
    examples.push({
      id: randomUUID(),
      split: toSplit(subject),
      origin: 'synthetic',
      source: {
        title: 'Synthetic rail reservation',
        provider: 'Rail Europe',
        sourceType: 'synthetic',
        url: null,
        harvestedAt: new Date().toISOString(),
        licenseHint: null,
      },
      email: {
        from: 'tickets@synthetic-rail.example',
        to: 'traveler@example.com',
        subject,
        ...rendered,
      },
      label: {
        itemType: 'rail',
        items: [item],
      },
    });
  }

  return examples;
};

export const buildOssRawEmailExample = (params: {
  rawEmail: string;
  title: string;
  provider: string;
  url: string;
  harvestedAt: string;
  licenseHint: string | null;
}): ParserTrainingExample => {
  const parsed = parseRawEmailBasic(params.rawEmail);
  const idSeed = `${params.url}|${params.rawEmail.slice(0, 200)}`;
  return {
    id: randomUUID(),
    split: toSplit(idSeed),
    origin: 'oss_raw_email',
    source: {
      title: params.title,
      provider: params.provider,
      sourceType: 'oss_corpus',
      url: params.url,
      harvestedAt: params.harvestedAt,
      licenseHint: params.licenseHint,
    },
    email: {
      from: parsed.from || 'unknown@example.com',
      to: parsed.to || 'unknown@example.com',
      subject: parsed.subject || 'Untitled message',
      textBody: parsed.textBody,
      htmlBody: parsed.htmlBody,
      rawEmail: params.rawEmail,
    },
    label: {
      itemType: 'generic_note',
      items: [],
    },
  };
};
