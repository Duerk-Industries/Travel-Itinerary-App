export type BlogPrivacyChoice = { optOut?: boolean; optIn?: boolean };
export type BlogVisibilityMember = {
  userId: string;
  firstName: string;
  dateOfBirth: string | null;
  publicByDefault: boolean;
  optOut: boolean;
  optIn: boolean;
};
export type BlogVisibilityContext = {
  tripId: string;
  startDate: string | null;
  timezone: string | null;
  organizerTimezone: string | null;
  destination: { lat: number; lng: number } | null;
  earlyRelease: boolean;
  members: BlogVisibilityMember[];
};
export type BlogVisibilityReason = 'SHARING_DISABLED' | 'START_DATE_NOT_SET' | 'TRIP_NOT_STARTED' | 'ACCOUNT_AGE_UNKNOWN' | 'ACCOUNT_UNDER_16' | 'TRAVELER_OPT_OUT';
export type BlogVisibilityResult = {
  isPublic: boolean;
  reasons: BlogVisibilityReason[];
  goesPublicOn: string | null;
  startDate: string | null;
  localDate: string;
  timezone: string;
  tripStarted: boolean;
  earlyRelease: boolean;
  missingBirthDate: number;
  underAge: number;
  optedOutTravelers: Array<{ userId: string; firstName: string }>;
};

export const blogDateOnly = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  const converted = typeof (value as { toDate?: () => Date }).toDate === 'function'
    ? (value as { toDate: () => Date }).toDate() : value;
  if (converted instanceof Date && !Number.isFinite(converted.getTime())) return null;
  const text = converted instanceof Date ? converted.toISOString().slice(0, 10) : String(converted).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
};

export const blogDestinationCoordinates = (payload: unknown): BlogVisibilityContext['destination'] => {
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return null; } }
  const p = (payload ?? {}) as Record<string, unknown>;
  const lat = Number(p.lat ?? p.latitude), lng = Number(p.lon ?? p.lng ?? p.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;
};
