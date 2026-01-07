export type TripDetails = {
  name: string;
  description: string;
  destination: string;
};

export type TripDates = {
  startDate: string;
  endDate: string;
  startMonth: string;
  startYear: string;
  durationDays: string;
  mode: 'range' | 'month';
};

export type ParticipantInput = {
  firstName: string;
  lastName: string;
  email?: string;
};

export type ItineraryItemInput = {
  date: string;
  time: string;
  activity: string;
};

export type KnownInfoInput = {
  flights: string;
  lodging: string;
  tours: string;
  cars: string;
};

export const normalizeEmail = (value?: string | null): string => (value ?? '').trim().toLowerCase();

export const validateTripDetails = (details: TripDetails): string | null => {
  if (!details.name.trim()) return 'Trip name is required.';
  return null;
};

export const validateTripDates = (dates: TripDates): string | null => {
  if (dates.mode === 'range') {
    const { startDate, endDate } = dates;
    if (!startDate && !endDate) return null;
    if (!startDate || !endDate) return 'Enter both a start and end date.';
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
      return 'Invalid start or end date.';
    }
    if (end < start) return 'End date cannot be before start date.';
    return null;
  }
  const { startMonth, startYear, durationDays } = dates;
  if (!startMonth && !startYear && !durationDays) return null;
  if (!startMonth || !startYear || !durationDays) {
    return 'Enter month, year, and number of days.';
  }
  const monthNum = Number(startMonth);
  const yearNum = Number(startYear);
  const daysNum = Number(durationDays);
  if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) return 'Enter a valid month (1-12).';
  if (!Number.isFinite(yearNum) || yearNum < 1900) return 'Enter a valid year.';
  if (!Number.isFinite(daysNum) || daysNum <= 0) return 'Enter a valid number of days.';
  return null;
};

export const validateParticipants = (participants: ParticipantInput[]): string | null => {
  for (const p of participants) {
    if (!p.firstName.trim() || !p.lastName.trim()) {
      return 'Each participant needs a first and last name.';
    }
  }
  const emails = participants.map((p) => normalizeEmail(p.email)).filter(Boolean);
  const unique = new Set(emails);
  if (unique.size !== emails.length) {
    return 'Participant emails must be unique.';
  }
  return null;
};

export const computeTripDays = (startDate?: string | null, endDate?: string | null): number | null => {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return null;
  const diffMs = end.getTime() - start.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  return days > 0 ? days : null;
};

export const buildTripDescription = (details: TripDetails, knownInfo?: KnownInfoInput): string => {
  const base = details.description.trim();
  if (!knownInfo) return base;
  const sections: string[] = [];
  if (knownInfo.flights.trim()) sections.push(`- Flights: ${knownInfo.flights.trim()}`);
  if (knownInfo.lodging.trim()) sections.push(`- Accommodation: ${knownInfo.lodging.trim()}`);
  if (knownInfo.tours.trim()) sections.push(`- Tours & Activities: ${knownInfo.tours.trim()}`);
  if (knownInfo.cars.trim()) sections.push(`- Rental cars: ${knownInfo.cars.trim()}`);
  if (!sections.length) return base;
  const header = '## Known Info';
  const block = [header, ...sections].join('\n');
  return base ? `${base}\n\n${block}` : block;
};
