import { getApiCacheSetting } from '../config/apiLimits';
import {
  GETYOURGUIDE_API_KEY_FALLBACK_ENV,
  GETYOURGUIDE_API_TOKEN_ENV,
  getGetYourGuidePartnerConfig,
  hasGetYourGuideApiConfiguration,
  isGetYourGuideFeatureEnabled,
} from '../config/getYourGuide';
import { getEnvValue } from '../env';
import { recordGetYourGuideApiRequest, recordGetYourGuideRetry } from '../services/getYourGuideObservability';
import { reserveApiUsageOrThrow } from './usageLimiter';
import { recordProviderRequestCost } from './providerBudgeting';

export const GETYOURGUIDE_PROVIDER = 'GETYOURGUIDE';

export type GetYourGuideActivityProduct = {
  productId: string;
  name: string;
  durationMinutes?: number;
  currency?: string;
  priceFrom?: number;
  locale?: string;
  meetingPoint?: string;
  cancellation?: string;
  accessibility?: string[];
  lastVerifiedAt: string;
};

export type GetYourGuideSearchResult = {
  products: GetYourGuideActivityProduct[];
  negative: boolean;
  fetchedAt: string;
};

export type GetYourGuideSearchRequest = {
  caller: string;
  query: string;
  destination?: string;
  country?: string;
  locationHint?: { lat: number; lon: number };
  date?: string;
  currency: string;
  language: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
};

export class GetYourGuideApiError extends Error {
  readonly code: 'disabled' | 'configuration' | 'invalid_request' | 'circuit_open' | 'timeout' | 'aborted' | 'http' | 'malformed_response' | 'budget';
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(code: GetYourGuideApiError['code'], message: string, extra: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'GetYourGuideApiError';
    this.code = code;
    this.status = extra.status;
    this.retryAfterMs = extra.retryAfterMs;
  }
}

type CircuitState = { failures: number; openedUntilMs: number };
const circuit: CircuitState = { failures: 0, openedUntilMs: 0 };

const normalizeText = (value: unknown, max = 240): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
};

const normalizeCode = (value: unknown, max = 32): string | undefined => {
  const normalized = normalizeText(value, max);
  return normalized ? normalized : undefined;
};

const finiteNonNegative = (value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : undefined;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const findItems = (payload: unknown): unknown[] | null => {
  if (Array.isArray(payload)) return payload;
  const root = asObject(payload);
  if (!root) return null;
  for (const key of ['products', 'activities', 'results', 'items']) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  const data = asObject(root.data);
  if (data) {
    for (const key of ['products', 'activities', 'results', 'items']) {
      if (Array.isArray(data[key])) return data[key] as unknown[];
    }
  }
  return null;
};

const normalizeProduct = (value: unknown, fetchedAt: string): GetYourGuideActivityProduct | null => {
  const item = asObject(value);
  if (!item) return null;
  const productId = normalizeText(item.productId ?? item.product_id ?? item.activityId ?? item.id, 128);
  const name = normalizeText(item.name ?? item.title, 240);
  if (!productId || !name) return null;
  const durationMinutes = finiteNonNegative(item.durationMinutes ?? item.duration_minutes, 24 * 60);
  const priceFrom = finiteNonNegative(item.priceFrom ?? item.price_from ?? item.fromPrice);
  const currency = normalizeCode(item.currency ?? item.currencyCode, 8)?.toUpperCase();
  const locale = normalizeCode(item.locale ?? item.language ?? item.cnt_language, 32);
  const meetingPoint = normalizeText(item.meetingPoint ?? item.meeting_point, 240);
  const cancellation = normalizeText(item.cancellation ?? item.cancellationPolicy ?? item.cancellation_policy, 500);
  const accessibilityRaw = item.accessibility ?? item.accessibilityFeatures ?? item.accessibility_features;
  const accessibility = Array.isArray(accessibilityRaw)
    ? accessibilityRaw.map((entry) => normalizeText(entry, 80)).filter((entry): entry is string => Boolean(entry)).slice(0, 16)
    : undefined;
  return {
    productId,
    name,
    ...(durationMinutes !== undefined ? { durationMinutes: Math.round(durationMinutes) } : {}),
    ...(currency ? { currency } : {}),
    ...(priceFrom !== undefined ? { priceFrom } : {}),
    ...(locale ? { locale } : {}),
    ...(meetingPoint ? { meetingPoint } : {}),
    ...(cancellation ? { cancellation } : {}),
    ...(accessibility?.length ? { accessibility } : {}),
    lastVerifiedAt: fetchedAt,
  };
};

export const normalizeGetYourGuideSearchResponse = (payload: unknown, fetchedAt = new Date().toISOString()): GetYourGuideSearchResult => {
  const items = findItems(payload);
  if (!items) throw new GetYourGuideApiError('malformed_response', 'GetYourGuide response did not contain a product list');
  const products: GetYourGuideActivityProduct[] = [];
  for (const item of items) {
    const product = normalizeProduct(item, fetchedAt);
    if (!product) throw new GetYourGuideApiError('malformed_response', 'GetYourGuide response contained an invalid product');
    products.push(product);
  }
  return { products, negative: products.length === 0, fetchedAt };
};

const parseRetryAfterMs = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, Math.min(dateMs - Date.now(), 60_000)) : undefined;
};

const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (ms <= 0) return;
  if (signal?.aborted) throw new GetYourGuideApiError('aborted', 'GetYourGuide request aborted');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => { clearTimeout(timer); reject(new GetYourGuideApiError('aborted', 'GetYourGuide request aborted')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
};

const timeoutMs = (): number => Math.max(100, Math.min(15_000, Math.floor(getApiCacheSetting('getYourGuide', 'apiTimeoutMs') ?? 4_000)));
const maxRetries = (): number => Math.max(0, Math.min(2, Math.floor(getApiCacheSetting('getYourGuide', 'apiMaxRetries') ?? 1)));
const circuitThreshold = (): number => Math.max(1, Math.min(20, Math.floor(getApiCacheSetting('getYourGuide', 'circuitFailureThreshold') ?? 3)));
const circuitOpenMs = (): number => Math.max(1_000, Math.min(10 * 60_000, Math.floor(getApiCacheSetting('getYourGuide', 'circuitOpenSeconds') ?? 30) * 1000));

export const resetGetYourGuideApiCircuitForTests = (): void => { circuit.failures = 0; circuit.openedUntilMs = 0; };

export const getGetYourGuideApiCircuitStatus = (): { open: boolean; consecutiveFailures: number; openedUntil: string | null } => ({
  open: circuit.openedUntilMs > Date.now(),
  consecutiveFailures: circuit.failures,
  openedUntil: circuit.openedUntilMs > Date.now() ? new Date(circuit.openedUntilMs).toISOString() : null,
});

const assertCircuitClosed = (): void => {
  if (circuit.openedUntilMs > Date.now()) throw new GetYourGuideApiError('circuit_open', 'GetYourGuide circuit is open');
  if (circuit.openedUntilMs) { circuit.openedUntilMs = 0; circuit.failures = 0; }
};

const recordSuccess = (): void => { circuit.failures = 0; circuit.openedUntilMs = 0; };
const recordFailure = (): void => {
  circuit.failures += 1;
  if (circuit.failures >= circuitThreshold()) circuit.openedUntilMs = Date.now() + circuitOpenMs();
};

const validateRequest = (params: GetYourGuideSearchRequest): { query: string; currency: string; language: string } => {
  const query = normalizeText(params.query, 240);
  const currency = normalizeCode(params.currency, 8)?.toUpperCase();
  const language = normalizeCode(params.language, 32);
  if (!query || !currency || !language) throw new GetYourGuideApiError('invalid_request', 'GetYourGuide search requires query, currency, and language');
  return { query, currency, language };
};

const buildUrl = (baseUrl: string, params: GetYourGuideSearchRequest, normalized: { query: string; currency: string; language: string }): string => {
  const url = new URL(baseUrl);
  const search = url.searchParams;
  search.set('query', normalized.query);
  search.set('currency', normalized.currency);
  search.set('cnt_language', normalized.language);
  if (params.destination) search.set('destination', String(params.destination).trim().slice(0, 120));
  if (params.country) search.set('country', String(params.country).trim().slice(0, 80));
  if (params.date) search.set('date', String(params.date).trim().slice(0, 32));
  if (params.locationHint && Number.isFinite(params.locationHint.lat) && Number.isFinite(params.locationHint.lon)) {
    search.set('lat', String(params.locationHint.lat));
    search.set('lon', String(params.locationHint.lon));
  }
  return url.toString();
};

const fetchAttempt = async (params: GetYourGuideSearchRequest, url: string, token: string): Promise<Response> => {
  if (params.signal?.aborted) throw new GetYourGuideApiError('aborted', 'GetYourGuide request aborted');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(100, Math.floor(params.timeoutMs ?? timeoutMs())));
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { method: 'GET', headers: { Accept: 'application/json', 'X-ACCESS-TOKEN': token }, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new GetYourGuideApiError('timeout', 'GetYourGuide request timed out');
    if (params.signal?.aborted) throw new GetYourGuideApiError('aborted', 'GetYourGuide request aborted');
    throw err;
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onAbort);
  }
};

export const searchGetYourGuideActivities = async (params: GetYourGuideSearchRequest): Promise<GetYourGuideSearchResult> => {
  const normalized = validateRequest(params);
  if (!(await isGetYourGuideFeatureEnabled())) throw new GetYourGuideApiError('disabled', 'GetYourGuide feature is disabled');
  if (!hasGetYourGuideApiConfiguration()) throw new GetYourGuideApiError('configuration', 'GetYourGuide Partner API is not configured');
  assertCircuitClosed();
  const config = getGetYourGuidePartnerConfig();
  const token = getGetYourGuideApiTokenForRequest();
  const url = buildUrl(config.apiBaseUrl!, params, normalized);
  const retries = Math.max(0, Math.min(2, Math.floor(params.maxRetries ?? maxRetries())));
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (params.signal?.aborted) throw new GetYourGuideApiError('aborted', 'GetYourGuide request aborted');
    await reserveApiUsageOrThrow({ provider: GETYOURGUIDE_PROVIDER, caller: params.caller });
    await recordProviderRequestCost({ provider: GETYOURGUIDE_PROVIDER });
    const attemptStartedAt = Date.now();
    let attemptRecorded = false;
    try {
      const response = await fetchAttempt(params, url, token);
      if (response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new GetYourGuideApiError('malformed_response', 'GetYourGuide response was not valid JSON');
        }
        const result = normalizeGetYourGuideSearchResponse(body);
        recordGetYourGuideApiRequest({ success: true, status: response.status, durationMs: Date.now() - attemptStartedAt });
        recordSuccess();
        return result;
      }
      recordGetYourGuideApiRequest({ success: false, status: response.status, durationMs: Date.now() - attemptStartedAt });
      attemptRecorded = true;
      const retryable = response.status === 429 || response.status >= 500;
      const error = new GetYourGuideApiError('http', `GetYourGuide request failed with status ${response.status}`, {
        status: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      });
      if (!retryable || attempt >= retries) throw error;
      recordGetYourGuideRetry();
      await sleep(error.retryAfterMs ?? Math.max(0, Math.min(5_000, Number(params.retryDelayMs ?? 100) * (attempt + 1))), params.signal);
    } catch (err) {
      if (!attemptRecorded) {
        recordGetYourGuideApiRequest({
          success: false,
          status: err instanceof GetYourGuideApiError ? err.status : undefined,
          code: err instanceof GetYourGuideApiError ? err.code : 'network_error',
          durationMs: Date.now() - attemptStartedAt,
        });
      }
      if (err instanceof GetYourGuideApiError && ['aborted', 'timeout', 'disabled', 'configuration', 'invalid_request', 'circuit_open'].includes(err.code)) throw err;
      if (err instanceof GetYourGuideApiError && err.code === 'malformed_response') { recordFailure(); throw err; }
      if (err instanceof GetYourGuideApiError && err.code === 'http' && err.status !== 429 && (err.status ?? 0) < 500) { recordFailure(); throw err; }
      if (attempt >= retries) { recordFailure(); throw err; }
      recordGetYourGuideRetry();
      await sleep(Math.max(0, Math.min(5_000, Number(params.retryDelayMs ?? 100) * (attempt + 1))), params.signal);
    }
  }
  throw new GetYourGuideApiError('http', 'GetYourGuide request failed');
};

// Kept in one function so tests can assert that the credential never enters
// URL construction or logs. The environment helper also supports *_FILE.
const getGetYourGuideApiTokenForRequest = (): string => {
  const config = getGetYourGuidePartnerConfig();
  const token = getEnvValue(GETYOURGUIDE_API_TOKEN_ENV) ?? getEnvValue(GETYOURGUIDE_API_KEY_FALLBACK_ENV);
  if (!config.hasApiToken || !token) throw new GetYourGuideApiError('configuration', 'GetYourGuide API token is not configured');
  return token;
};
