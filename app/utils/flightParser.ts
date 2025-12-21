export type ParsedFlight = {
  passengerName?: string;
  departureDate?: string;
  departureLocation?: string;
  departureAirportCode?: string;
  departureTime?: string;
  arrivalLocation?: string;
  arrivalAirportCode?: string;
  layoverLocation?: string;
  layoverLocationCode?: string;
  layoverDuration?: string;
  arrivalTime?: string;
  cost?: string;
  carrier?: string;
  flightNumber?: string;
  bookingReference?: string;
};

const normalizeDateString = (value: string): string => {
  if (!value) return value;
  if (value.includes('-') && value.length === 10) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
};

const airportCityLookup: Record<string, string> = {
  HAN: 'Hanoi',
  BOS: 'Boston',
  HKG: 'Hong Kong',
  JFK: 'New York',
  LAX: 'Los Angeles',
  ORD: 'Chicago',
  HND: 'Tokyo',
  LHR: 'London',
  CDG: 'Paris',
  FRA: 'Frankfurt',
  DXB: 'Dubai',
  SFO: 'San Francisco',
  EWR: 'Newark',
};

const toCityFromCode = (code?: string, fallback?: string): string => {
  if (!code) return fallback ?? '';
  const upper = code.toUpperCase();
  return airportCityLookup[upper] ?? fallback ?? upper;
};

const cleanName = (name: string): string => {
  return name
    .replace(/\bimportant flight information\b/i, '')
    .replace(/\s{2,}.*/, '')
    .trim();
};

const parseTravelerNames = (text: string): string[] => {
  const patterns = [
    /(?:traveler|passenger)\s*\d*[:\-]\s*([A-Za-z][A-Za-z .'-]+)/gi,
    /Traveler\s*\d*\s*\(\w+\)\s*([A-Za-z][A-Za-z .'-]+)/gi,
    /Passengers?:\s*([A-Za-z ,.'-]{5,100})/gi,
  ];
  const results: string[] = [];
  patterns.forEach((regex) => {
    for (const match of text.matchAll(regex)) {
      results.push(cleanName(match[1].trim()));
    }
  });
  const expanded: string[] = [];
  results.forEach((entry) => {
    if (entry.includes(',')) {
      entry
        .split(',')
        .map((s) => cleanName(s))
        .filter(Boolean)
        .forEach((n) => expanded.push(n));
    } else if (entry.toLowerCase().includes(' and ')) {
      entry
        .split(/and/gi)
        .map((s) => cleanName(s))
        .filter(Boolean)
        .forEach((n) => expanded.push(n));
    } else {
      expanded.push(entry);
    }
  });
  const finalList = expanded.length ? expanded : results;
  const unique = Array.from(new Set(finalList.map((m) => m.replace(/\s+/g, ' ').trim()))).filter(Boolean);
  return unique.length ? unique : finalList;
};

const parseFlightSegments = (
  text: string
): { departure: string; arrival: string; departTime?: string; arriveTime?: string; flightNumber?: string }[] => {
  const segments: { departure: string; arrival: string; departTime?: string; arriveTime?: string; flightNumber?: string }[] =
    [];
  const segmentRegex =
    /([A-Z]{3})\s*(?:to|->|→|—|–|-)\s*([A-Z]{3})[^\n]*?(\d{1,2}:\d{2}\s*(?:AM|PM)?)?[^\n]*?(\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi;
  for (const match of text.matchAll(segmentRegex)) {
    const [, dep, arr, depTime, arrTime] = match;
    segments.push({
      departure: dep.toUpperCase(),
      arrival: arr.toUpperCase(),
      departTime: depTime ? depTime.toUpperCase() : undefined,
      arriveTime: arrTime ? arrTime.toUpperCase() : undefined,
    });
  }
  if (!segments.length) {
    const codes = filterAirportCodes(Array.from(text.matchAll(/\b([A-Z]{3})\b/g)).map((m) => m[1].toUpperCase()));
    for (let i = 0; i + 1 < codes.length; i += 2) {
      segments.push({ departure: codes[i], arrival: codes[i + 1] });
    }
  }
  return segments;
};

const parseFlightNumbers = (text: string): string[] => {
  const matches = Array.from(text.matchAll(/\b([A-Z]{2,3}\s?\d{3,4})\b/g)).map((m) => m[1].replace(/\s+/g, '').toUpperCase());
  return Array.from(new Set(matches));
};

const filterAirportCodes = (codes: string[]): string[] => {
  const banned = new Set(['UTC', 'GMT', 'PST', 'EST', 'CST', 'MST', 'EDT', 'PDT', 'CDT', 'MDT']);
  return codes.filter((c) => !banned.has(c));
};

const pickEarliestDate = (candidates: string[]): string | undefined => {
  let earliest: { iso: string; time: number } | undefined;
  candidates.forEach((raw) => {
    const norm = normalizeDateString(raw);
    const t = new Date(norm).getTime();
    if (!Number.isNaN(t) && (!earliest || t < earliest.time)) {
      earliest = { iso: norm, time: t };
    }
  });
  return earliest ? earliest.iso : undefined;
};

export const parseFlightText = (text: string): { primary: Partial<ParsedFlight>; bulk: ParsedFlight[] } => {
  const parsed: Partial<ParsedFlight> = {};
  const bookingMatch = text.match(/booking\s*(?:reference|ref|code)?[:\s]+([A-Z0-9]{5,8})/i);
  if (bookingMatch) parsed.bookingReference = bookingMatch[1].toUpperCase();
  if (!parsed.bookingReference) {
    const airlineConfMatch = text.match(/airline\s+confirmation[:\s]+([A-Z0-9]{4,8})/i);
    if (airlineConfMatch) parsed.bookingReference = airlineConfMatch[1].toUpperCase();
  }

  const travelerNames = parseTravelerNames(text);
  const passengerMatch = text.match(/passenger(?:\s*name)?[:\s]+([A-Za-z][A-Za-z ,.'-]{2,60})/i);
  const candidatePassenger = passengerMatch ? cleanName(passengerMatch[1].trim()) : '';
  if (travelerNames[0]) {
    parsed.passengerName = travelerNames[0];
  } else if (candidatePassenger && !candidatePassenger.toLowerCase().includes('such as full name')) {
    parsed.passengerName = candidatePassenger;
  }

  const flightMatch = text.match(/flight\s*(?:no\.?|number)?[:\s]*([A-Z]{2,3}\s*\d{2,4})/i);
  if (flightMatch) parsed.flightNumber = flightMatch[1].replace(/\s+/g, '').toUpperCase();
  const allFlightNumbers = parseFlightNumbers(text);
  if (!parsed.flightNumber && allFlightNumbers[0]) {
    parsed.flightNumber = allFlightNumbers[0];
  }

  const cathay = text.match(/cathay pacific airways/i);
  const airlineMatch = text.match(/airline[:\s]+([A-Za-z][A-Za-z\s]{2,40})/i);
  if (cathay) {
    parsed.carrier = cathay[0].trim();
  } else if (airlineMatch && airlineMatch[1] && !/confirmation/i.test(airlineMatch[1])) {
    parsed.carrier = airlineMatch[1].trim();
  }
  if (!parsed.carrier && parsed.flightNumber?.length) {
    parsed.carrier = parsed.flightNumber.slice(0, 2).toUpperCase();
  }

  const labeledLocations = Array.from(text.matchAll(/([A-Za-z][A-Za-z .'-]+)\s*\(([A-Z]{3})\)/g)).slice(0, 2);
  if (labeledLocations[0]) {
    const code = labeledLocations[0][2].toUpperCase();
    parsed.departureLocation = code;
    parsed.departureAirportCode = code;
  }
  if (labeledLocations[1]) {
    const code = labeledLocations[1][2].toUpperCase();
    parsed.arrivalLocation = code;
    parsed.arrivalAirportCode = code;
  }

  const routeMatch = text.match(/\b([A-Z]{3})\s*(?:to|->|→|—|–|-)\s*([A-Z]{3})\b/);
  if (routeMatch) {
    parsed.departureLocation = routeMatch[1].toUpperCase();
    parsed.departureAirportCode = routeMatch[1].toUpperCase();
    parsed.arrivalLocation = routeMatch[2].toUpperCase();
    parsed.arrivalAirportCode = routeMatch[2].toUpperCase();
  } else {
    const airportCodes = filterAirportCodes(Array.from(text.matchAll(/\b([A-Z]{3})\b/g)).map((m) => m[1].toUpperCase()));
    if (airportCodes[0]) {
      parsed.departureLocation = airportCodes[0];
      parsed.departureAirportCode = airportCodes[0];
    }
    if (airportCodes[1]) {
      parsed.arrivalLocation = airportCodes[1];
      parsed.arrivalAirportCode = airportCodes[1];
    }
  }

  const isoDates = Array.from(text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)).map((m) => m[1]);
  const namedDateRegex =
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi;
  const namedDates = Array.from(text.matchAll(namedDateRegex)).map((m) => m[0]);
  const bestDate = pickEarliestDate([...isoDates, ...namedDates]);
  if (bestDate) parsed.departureDate = bestDate;

  const layoverDetail = text.match(/\(([A-Z]{3})\s*[—-]\s*(\d{1,2})h\s*(\d{1,2})m\)/i);
  const layoverMatch =
    layoverDetail ||
    text.match(/(?:layover|stop)\s*(?:in\s*[A-Z]{3}\s*)?(?:for\s*)?(\d{1,2})\s*h\s*(\d{1,2})\s*m/i);
  if (layoverDetail) {
    parsed.layoverLocation = layoverDetail[1].toUpperCase();
    parsed.layoverLocationCode = layoverDetail[1].toUpperCase();
    parsed.layoverDuration = `${layoverDetail[2]}h ${layoverDetail[3]}m`;
  } else if (layoverMatch) {
    parsed.layoverDuration = `${layoverMatch[1]}h ${layoverMatch[2]}m`;
  }

  const timeRoute = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s+([A-Z]{3})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+([A-Z]{3})/i);
  if (timeRoute) {
    parsed.departureTime = timeRoute[1].toUpperCase();
    parsed.departureAirportCode = parsed.departureAirportCode ?? timeRoute[2].toUpperCase();
    parsed.arrivalTime = timeRoute[3].toUpperCase();
    parsed.arrivalAirportCode = parsed.arrivalAirportCode ?? timeRoute[4].toUpperCase();
  }

  const timeMatches = Array.from(text.matchAll(/(\d{1,2}:\d{2}\s?(?:AM|PM)?)/gi)).map((m) => m[1]);
  if (!parsed.departureTime && timeMatches[0]) parsed.departureTime = timeMatches[0].toUpperCase();
  if (!parsed.arrivalTime && timeMatches[1]) parsed.arrivalTime = timeMatches[1].toUpperCase();

  const currencyMatches = Array.from(text.matchAll(/\$?\s?(\d{1,3}(?:,\d{3})*\.\d{2})/g)).map((m) => m[1]);
  if (currencyMatches[0]) {
    parsed.cost = currencyMatches[0].replace(/,/g, '');
  }

  // Normalize locations to city names when possible
  parsed.departureLocation = toCityFromCode(parsed.departureAirportCode ?? parsed.departureLocation, parsed.departureLocation);
  parsed.arrivalLocation = toCityFromCode(parsed.arrivalAirportCode ?? parsed.arrivalLocation, parsed.arrivalLocation);
  if (parsed.layoverLocationCode) {
    parsed.layoverLocation = toCityFromCode(parsed.layoverLocationCode, parsed.layoverLocation);
  }

  const travelersForBulk = travelerNames.length ? travelerNames : parseTravelerNames(text);
  const segments = parseFlightSegments(text);
  const bulk: ParsedFlight[] = [];
  if (travelersForBulk.length && segments.length && parsed.departureDate) {
    const totalCost = parsed.cost ? Number(parsed.cost) || 0 : 0;
    const perFlightCost =
      totalCost && travelersForBulk.length && segments.length
        ? (totalCost / (travelersForBulk.length * segments.length)).toFixed(2)
        : '';
    travelersForBulk.forEach((traveler, travelerIdx) => {
      segments.forEach((segment, segIdx) => {
        const fn = allFlightNumbers[(travelerIdx + segIdx) % (allFlightNumbers.length || 1)] ?? parsed.flightNumber ?? '';
        bulk.push({
          passengerName: traveler,
          departureDate: parsed.departureDate ?? '',
          departureLocation: toCityFromCode(segment.departure, parsed.departureLocation),
          departureAirportCode: segment.departure ?? '',
          departureTime: segment.departTime ?? parsed.departureTime ?? '',
          arrivalLocation: toCityFromCode(segment.arrival, parsed.arrivalLocation),
          arrivalAirportCode: segment.arrival ?? '',
          layoverLocation:
            parsed.layoverLocation ??
            (parsed.layoverLocationCode ? toCityFromCode(parsed.layoverLocationCode) : ''),
          layoverLocationCode: parsed.layoverLocationCode ?? '',
          layoverDuration: parsed.layoverDuration ?? '',
          arrivalTime: segment.arriveTime ?? parsed.arrivalTime ?? '',
          cost: perFlightCost,
          carrier: parsed.carrier ?? '',
          flightNumber: fn,
          bookingReference: parsed.bookingReference ?? '',
        });
      });
    });
  }

  return { primary: parsed, bulk };
};
