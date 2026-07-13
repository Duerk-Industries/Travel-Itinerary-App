import { Linking, Platform } from 'react-native';
import {
  evaluateGetYourGuideCandidate,
  type GetYourGuideCandidate,
  type GetYourGuideTravelerContext,
} from './getYourGuideEligibility';

export type GetYourGuideClientDescriptor = {
  provider: 'getyourguide';
  kind: string;
  token: string;
  disclosureRequired: true;
  expiresAt: string;
  rulesVersion: string;
};

export type GetYourGuideClientActivity = {
  id: string;
  name: string;
  activityType: string;
  date?: string | null;
  startTime?: string | null;
  duration?: string | null;
  alreadyBooked?: boolean;
};

const TOKEN_PATTERN = /^g1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const descriptorCache = new Map<string, GetYourGuideClientDescriptor>();
const descriptorRequests = new Map<string, Promise<GetYourGuideClientDescriptor | null>>();

export const clearGetYourGuideDescriptorCache = (): void => {
  descriptorCache.clear();
  descriptorRequests.clear();
};

const isBrowserOnline = (): boolean => {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
};

const parseDurationMinutes = (value?: string | null): number | null => {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const minuteMatch = text.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  const hours = hourMatch ? Number(hourMatch[1]) * 60 : 0;
  const minutes = minuteMatch ? Number(minuteMatch[1]) : hourMatch ? 0 : Number(text.match(/^\d+$/)?.[0] ?? NaN);
  const total = hours + minutes;
  return Number.isFinite(total) && total >= 0 && total <= 24 * 60 ? Math.round(total) : null;
};

export const isGetYourGuideDescriptor = (value: unknown): value is GetYourGuideClientDescriptor => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const descriptor = value as Record<string, unknown>;
  if (descriptor.provider !== 'getyourguide' || descriptor.disclosureRequired !== true) return false;
  if (typeof descriptor.kind !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(descriptor.kind)) return false;
  if (typeof descriptor.token !== 'string' || descriptor.token.length > 4096 || !TOKEN_PATTERN.test(descriptor.token)) return false;
  if (typeof descriptor.rulesVersion !== 'string' || descriptor.rulesVersion.length > 80) return false;
  const expiry = Date.parse(String(descriptor.expiresAt ?? ''));
  return Number.isFinite(expiry) && expiry > Date.now();
};

export const buildGetYourGuideCandidate = (
  activity: GetYourGuideClientActivity,
  destination?: string | null,
): GetYourGuideCandidate => ({
  id: String(activity.id ?? '').trim(),
  name: String(activity.name ?? '').trim(),
  activityType: String(activity.activityType ?? 'Tour'),
  date: activity.date ?? null,
  startTime: activity.startTime ?? null,
  durationMinutes: parseDurationMinutes(activity.duration),
  destination: { destination: String(destination ?? '').trim() },
  alreadyBooked: Boolean(activity.alreadyBooked),
});

export const isGetYourGuideActivityEligible = (
  activity: GetYourGuideClientActivity,
  destination?: string | null,
  context: GetYourGuideTravelerContext = {},
): boolean => evaluateGetYourGuideCandidate(buildGetYourGuideCandidate(activity, destination), context).eligible;

export const requestGetYourGuideDescriptor = async (params: {
  backendUrl: string;
  headers?: Record<string, string>;
  activity: GetYourGuideClientActivity;
  destination?: string | null;
  context?: GetYourGuideTravelerContext;
  signal?: AbortSignal;
  featureEnabled?: boolean;
}): Promise<GetYourGuideClientDescriptor | null> => {
  if (params.featureEnabled === false || !isBrowserOnline()) return null;
  const candidate = buildGetYourGuideCandidate(params.activity, params.destination);
  if (!evaluateGetYourGuideCandidate(candidate, params.context ?? {}).eligible) return null;
  const cacheKey = JSON.stringify({
    backendUrl: params.backendUrl,
    id: candidate.id,
    name: candidate.name,
    type: candidate.activityType,
    date: candidate.date,
    destination: candidate.destination,
  });
  const cached = descriptorCache.get(cacheKey);
  if (cached && Date.parse(cached.expiresAt) > Date.now()) return cached;
  descriptorCache.delete(cacheKey);
  const pending = descriptorRequests.get(cacheKey);
  if (pending) return pending;
  const request = (async (): Promise<GetYourGuideClientDescriptor | null> => {
    try {
      const response = await fetch(`${params.backendUrl}/api/affiliate/getyourguide/descriptor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(params.headers ?? {}) },
        body: JSON.stringify({ candidate, context: params.context ?? {} }),
        signal: params.signal,
      });
      if (!response.ok) return null;
      const value = await response.json().catch(() => null);
      const descriptor = isGetYourGuideDescriptor(value) ? value : null;
      if (descriptor) descriptorCache.set(cacheKey, descriptor);
      return descriptor;
    } catch {
      return null;
    }
  })();
  descriptorRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    descriptorRequests.delete(cacheKey);
  }
};

export const getGetYourGuideCtaLabel = (activityName: string, activityType?: string): string => {
  const normalized = String(activityName ?? '').toLowerCase();
  const iconic = ['eiffel tower', 'louvre', 'vatican museums', 'colosseum', 'sagrada familia', 'tower of london']
    .some((landmark) => normalized.includes(landmark));
  // The stronger ticket claim is limited to the explicitly ticketed type; a
  // name alone is not proof that skip-the-line inventory exists.
  return iconic && activityType === 'Ticketed Attraction'
    ? 'Get Skip-the-Line Tickets ↗'
    : 'Explore experiences on GetYourGuide ↗';
};

export const openGetYourGuideDescriptor = async (
  backendUrl: string,
  descriptor: GetYourGuideClientDescriptor,
): Promise<boolean> => {
  if (!isGetYourGuideDescriptor(descriptor)) return false;
  const url = `${backendUrl.replace(/\/$/, '')}/api/affiliate/getyourguide?token=${encodeURIComponent(descriptor.token)}`;
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return false;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    return Boolean(opened);
  }
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
};

export const GETYOURGUIDE_DISCLOSURE_TEXT = 'Affiliate link — we may earn a commission at no extra cost to you.';

export const formatGetYourGuideExportDisclosure = (descriptor?: GetYourGuideClientDescriptor | null): string =>
  descriptor && isGetYourGuideDescriptor(descriptor) ? GETYOURGUIDE_DISCLOSURE_TEXT : '';
