import crypto from 'node:crypto';
import { getAuthSecret } from '../authConfig';
import {
  getGetYourGuideAllowedHosts,
  getGetYourGuideAllowedPathPrefixes,
  getGetYourGuideDeepLinkBaseUrl,
  getGetYourGuidePartnerConfig,
  isGetYourGuideFeatureEnabled,
} from '../config/getYourGuide';
import { getApiCacheSetting } from '../config/apiLimits';
import {
  evaluateGetYourGuideCandidate,
  getGetYourGuideCanonicalKey,
  GETYOURGUIDE_RULES_VERSION,
  normalizeGetYourGuideText,
  type GetYourGuideCandidate,
  type GetYourGuideTravelerContext,
} from '../utils/getYourGuideEligibility';

export const GETYOURGUIDE_DESCRIPTOR_VERSION = 'getyourguide-descriptor-v1';
export const GETYOURGUIDE_PROVIDER = 'getyourguide';
export const GETYOURGUIDE_DEFAULT_LINK_KIND = 'activity';

const TOKEN_PREFIX = 'g1';
const MAX_TOKEN_LENGTH = 4096;
const MAX_ACTIVITY_ID_LENGTH = 128;
const MAX_ACTIVITY_NAME_LENGTH = 240;
const MAX_PART_LENGTH = 120;
const MAX_LIST_ITEMS = 24;
const MAX_URL_LENGTH = 2048;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

type DescriptorPayload = {
  v: typeof GETYOURGUIDE_DESCRIPTOR_VERSION;
  provider: typeof GETYOURGUIDE_PROVIDER;
  kind: string;
  exp: number;
  iat: number;
  jti: string;
  activityKeyHash: string;
  targetHost: string;
  targetPath: string;
};

export type GetYourGuideDescriptorRequest = {
  candidate: GetYourGuideCandidate;
  context?: GetYourGuideTravelerContext | null;
  targetUrl?: string | null;
  kind?: string | null;
};

export type GetYourGuideDescriptor = {
  provider: typeof GETYOURGUIDE_PROVIDER;
  kind: string;
  token: string;
  disclosureRequired: true;
  expiresAt: string;
  rulesVersion: typeof GETYOURGUIDE_RULES_VERSION;
};

const base64UrlEncode = (value: Buffer): string => value.toString('base64url');
const base64UrlDecode = (value: string): Buffer => Buffer.from(value, 'base64url');

const tokenKey = (): Buffer => crypto.createHash('sha256').update(getAuthSecret()).digest();

const safeString = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || CONTROL_CHARACTERS.test(trimmed)) return null;
  return trimmed;
};

const safeOptionalString = (value: unknown, maxLength: number): string | null | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  return safeString(value, maxLength);
};

const validFiniteNumber = (value: unknown, min: number, max: number): boolean =>
  value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);

const validateCandidateShape = (candidate: unknown): candidate is GetYourGuideCandidate => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const value = candidate as Record<string, unknown>;
  if (!safeString(value.id, MAX_ACTIVITY_ID_LENGTH) || !safeString(value.name, MAX_ACTIVITY_NAME_LENGTH)) return false;
  if (!safeString(value.activityType, MAX_PART_LENGTH)) return false;
  if (!value.destination || typeof value.destination !== 'object' || Array.isArray(value.destination)) return false;
  const destination = value.destination as Record<string, unknown>;
  for (const part of ['destination', 'city', 'country']) {
    const result = safeOptionalString(destination[part], MAX_PART_LENGTH);
    if (destination[part] !== undefined && destination[part] !== null && result === null) return false;
  }
  const coordinates = destination.coordinates;
  if (coordinates !== undefined && coordinates !== null) {
    if (typeof coordinates !== 'object' || Array.isArray(coordinates)) return false;
    const point = coordinates as Record<string, unknown>;
    if (!validFiniteNumber(point.lat, -90, 90) || !validFiniteNumber(point.lon, -180, 180)) return false;
  }
  for (const field of [
    'durationMinutes', 'availableMinutes', 'previousTravelMinutes', 'nextTravelMinutes',
    'bufferMinutes', 'walkingMinutes', 'maxWalkingMinutes',
  ]) {
    if (!validFiniteNumber(value[field], 0, 24 * 60)) return false;
  }
  for (const field of ['date', 'startTime']) {
    const result = safeOptionalString(value[field], MAX_PART_LENGTH);
    if (value[field] !== undefined && value[field] !== null && result === null) return false;
  }
  if (value.timeWindow !== undefined && value.timeWindow !== null) {
    if (typeof value.timeWindow !== 'object' || Array.isArray(value.timeWindow)) return false;
    const window = value.timeWindow as Record<string, unknown>;
    if (safeOptionalString(window.start, MAX_PART_LENGTH) === null || safeOptionalString(window.end, MAX_PART_LENGTH) === null) return false;
  }
  for (const field of ['languages', 'interestTags']) {
    if (value[field] !== undefined && value[field] !== null) {
      if (!Array.isArray(value[field]) || value[field].length > MAX_LIST_ITEMS || value[field].some((item) => safeString(item, MAX_PART_LENGTH) === null)) return false;
    }
  }
  if (value.budgetTier !== undefined && value.budgetTier !== null && !['free', 'paid', 'premium'].includes(String(value.budgetTier))) return false;
  for (const field of ['mobilityAccessible', 'mustSee', 'alreadyBooked']) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== 'boolean') return false;
  }
  return true;
};

const validateContextShape = (context: unknown): context is GetYourGuideTravelerContext => {
  if (context === undefined || context === null) return true;
  if (typeof context !== 'object' || Array.isArray(context)) return false;
  const value = context as Record<string, unknown>;
  if (value.comfort !== undefined && value.comfort !== null && !['Budget', 'Midrange', 'Luxury'].includes(String(value.comfort))) return false;
  if (value.mobility !== undefined && value.mobility !== null && !['Low', 'Medium', 'High'].includes(String(value.mobility))) return false;
  if (safeOptionalString(value.language, 64) === null) return false;
  if (value.avoid !== undefined && value.avoid !== null && (!Array.isArray(value.avoid) || value.avoid.length > MAX_LIST_ITEMS || value.avoid.some((item) => safeString(item, MAX_PART_LENGTH) === null))) return false;
  if (value.interestWeights !== undefined && value.interestWeights !== null) {
    if (typeof value.interestWeights !== 'object' || Array.isArray(value.interestWeights)) return false;
    const entries = Object.entries(value.interestWeights as Record<string, unknown>);
    if (entries.length > MAX_LIST_ITEMS || entries.some(([key, weight]) => safeString(key, MAX_PART_LENGTH) === null || typeof weight !== 'number' || !validFiniteNumber(weight, -100, 100))) return false;
  }
  if (value.requireDisambiguatedDestination !== undefined && typeof value.requireDisambiguatedDestination !== 'boolean') return false;
  if (value.maxCandidates !== undefined && (!validFiniteNumber(value.maxCandidates, 0, 4) || !Number.isInteger(value.maxCandidates))) return false;
  return true;
};

const normalizeKind = (kind: unknown): string | null => {
  const value = safeOptionalString(kind, 32) ?? GETYOURGUIDE_DEFAULT_LINK_KIND;
  if (!value || !/^[a-z0-9][a-z0-9_-]*$/i.test(value)) return null;
  return value.toLowerCase();
};

const normalizeTargetUrl = (input: string | null | undefined): { host: string; pathname: string } | null => {
  const raw = input || getGetYourGuideDeepLinkBaseUrl();
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH || CONTROL_CHARACTERS.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const allowedHosts = getGetYourGuideAllowedHosts();
  if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname.toLowerCase())) return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  const pathname = parsed.pathname || '/';
  if (CONTROL_CHARACTERS.test(pathname) || pathname.length > 1024 || !pathname.startsWith('/')) return null;
  const allowedPath = pathname === '/' || getGetYourGuideAllowedPathPrefixes().some((prefix) => {
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return pathname === prefix || pathname.startsWith(normalizedPrefix);
  });
  if (!allowedPath) return null;
  return { host: parsed.hostname.toLowerCase(), pathname };
};

const expirySeconds = (): number => {
  const configured = getApiCacheSetting('getYourGuide', 'redirectTokenTtlMinutes');
  const minutes = Number.isFinite(configured) ? Math.min(Math.max(Math.floor(configured!), 1), 24 * 60) : 10;
  return minutes * 60;
};

const encryptPayload = (payload: DescriptorPayload): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return [TOKEN_PREFIX, base64UrlEncode(iv), base64UrlEncode(cipher.getAuthTag()), base64UrlEncode(ciphertext)].join('.');
};

const decryptPayload = (token: string): DescriptorPayload | null => {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  try {
    const iv = base64UrlDecode(parts[1]);
    const tag = base64UrlDecode(parts[2]);
    const ciphertext = base64UrlDecode(parts[3]);
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
    decipher.setAuthTag(tag);
    const raw = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = JSON.parse(raw) as Partial<DescriptorPayload>;
    if (
      payload.v !== GETYOURGUIDE_DESCRIPTOR_VERSION || payload.provider !== GETYOURGUIDE_PROVIDER ||
      typeof payload.kind !== 'string' || typeof payload.exp !== 'number' || typeof payload.iat !== 'number' ||
      typeof payload.jti !== 'string' || !/^[a-f0-9]{32}$/.test(payload.activityKeyHash ?? '') ||
      typeof payload.targetHost !== 'string' || typeof payload.targetPath !== 'string'
    ) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000) || payload.iat > Math.floor(Date.now() / 1000) + 60) return null;
    if (!getGetYourGuideAllowedHosts().includes(payload.targetHost.toLowerCase())) return null;
    const targetPath = payload.targetPath;
    if (!targetPath.startsWith('/') || CONTROL_CHARACTERS.test(targetPath)) return null;
    const allowedPath = targetPath === '/' || getGetYourGuideAllowedPathPrefixes().some((prefix) => {
      const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
      return targetPath === prefix || targetPath.startsWith(normalizedPrefix);
    });
    if (!allowedPath) return null;
    return payload as DescriptorPayload;
  } catch {
    return null;
  }
};

export const buildGetYourGuideRedirectUrl = (payload: DescriptorPayload, partnerId: string): string | null => {
  if (!safeString(partnerId, 128) || !getGetYourGuideAllowedHosts().includes(payload.targetHost.toLowerCase())) return null;
  try {
    const url = new URL(`https://${payload.targetHost}${payload.targetPath}`);
    url.search = '';
    url.hash = '';
    // The partner id is the only query parameter added by this server. Search
    // terms/campaign parameters are deliberately not guessed or client-owned.
    url.searchParams.set('partner_id', partnerId);
    return url.toString();
  } catch {
    return null;
  }
};

export const createGetYourGuideDescriptor = async (
  input: GetYourGuideDescriptorRequest,
): Promise<GetYourGuideDescriptor | null> => {
  if (!(await isGetYourGuideFeatureEnabled()) || !validateCandidateShape(input?.candidate) || !validateContextShape(input?.context)) return null;
  const kind = normalizeKind(input.kind);
  if (!kind) return null;
  const candidate = input.candidate;
  const context = input.context ?? {};
  const decision = evaluateGetYourGuideCandidate(candidate, { ...context, maxCandidates: 1 });
  if (!decision.eligible) return null;
  const target = normalizeTargetUrl(input.targetUrl);
  if (!target) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload: DescriptorPayload = {
    v: GETYOURGUIDE_DESCRIPTOR_VERSION,
    provider: GETYOURGUIDE_PROVIDER,
    kind,
    exp: now + expirySeconds(),
    iat: now,
    jti: crypto.randomBytes(16).toString('hex'),
    activityKeyHash: crypto.createHash('sha256').update(getGetYourGuideCanonicalKey(candidate)).digest('hex').slice(0, 32),
    targetHost: target.host,
    targetPath: target.pathname,
  };
  return {
    provider: GETYOURGUIDE_PROVIDER,
    kind,
    token: encryptPayload(payload),
    disclosureRequired: true,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    rulesVersion: GETYOURGUIDE_RULES_VERSION,
  };
};

export const resolveGetYourGuideRedirect = async (token: string): Promise<string | null> => {
  if (!(await isGetYourGuideFeatureEnabled())) return null;
  const payload = decryptPayload(token);
  if (!payload) return null;
  const partnerId = getGetYourGuidePartnerConfig().partnerId;
  if (!partnerId) return null;
  return buildGetYourGuideRedirectUrl(payload, partnerId);
};

export const getGetYourGuideTokenPayloadForTests = (token: string): DescriptorPayload | null => decryptPayload(token);
