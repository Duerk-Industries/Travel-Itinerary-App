import type { AxiosResponse } from 'axios';
import { lookup } from 'dns/promises';
import { getEnvValue } from './env';
import { logError, logInfo } from './logger';
import { getApiCacheSetting } from './config/apiLimits';
import { requestUnsplashHealthCheck } from './apis/unsplashCallers';

type UnsplashHealthResult = {
  ok: boolean;
  status?: number;
  statusText?: string;
  error?: string;
};

const UNSPLASH_HOST = 'api.unsplash.com';
const UNSPLASH_URL =
  'https://api.unsplash.com/photos/random?orientation=landscape&content_filter=high&query=travel';
const DNS_LOG_TTL_MS = Number(getApiCacheSetting('unsplash', 'dnsLogTtlMs')) || 5 * 60 * 1000;
let lastDnsLogAt = 0;
let networkEnvLogged = false;
const isTestEnv = () => process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

const getUnsplashKey = (): string | null => {
  // Prefer correctly-spelled var, but fall back to historical typo for backward compatibility.
  const primaryKey = getEnvValue('UNSPLASH_ACCESS_KEY');
  const legacyKey = getEnvValue('UNSPLASE_ACCESS_KEY');
  return primaryKey ?? legacyKey ?? null;
};

const getHeaderValue = (headers: AxiosResponse['headers'], key: string): string | undefined => {
  if (!headers) return undefined;
  const value = (headers as Record<string, unknown>)[key];
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value.join(',') : String(value);
};

const logUnsplashResponseInfo = (
  context: string,
  res: Pick<AxiosResponse, 'status' | 'statusText' | 'data' | 'headers'>
): void => {
  let bodySnippet = '';
  if (res.data !== undefined) {
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    bodySnippet = raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
  }
  const rateLimit = {
    limit: getHeaderValue(res.headers, 'x-ratelimit-limit'),
    remaining: getHeaderValue(res.headers, 'x-ratelimit-remaining'),
    reset: getHeaderValue(res.headers, 'x-ratelimit-reset'),
  };
  if (!isTestEnv()) {
    logInfo(
      `[itinerary] Unsplash health ${context}: status=${res.status} ${res.statusText} bodySnippet=${bodySnippet} rateLimit=${JSON.stringify(rateLimit)}`
    );
  }
};

const logNetworkEnvOnce = (): void => {
  if (isTestEnv()) return;
  if (networkEnvLogged) return;
  networkEnvLogged = true;
  const proxyInfo = {
    HTTP_PROXY: Boolean(process.env.HTTP_PROXY || process.env.http_proxy),
    HTTPS_PROXY: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy),
    NO_PROXY: Boolean(process.env.NO_PROXY || process.env.no_proxy),
  };
  const runInfo = {
    K_SERVICE: process.env.K_SERVICE,
    K_REVISION: process.env.K_REVISION,
    K_CONFIGURATION: process.env.K_CONFIGURATION,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  };
  logInfo(
    `[itinerary] Unsplash network env: proxy=${JSON.stringify(proxyInfo)} run=${JSON.stringify(runInfo)}`
  );
};

const logDnsOnce = async (context: string): Promise<void> => {
  if (isTestEnv()) return;
  const now = Date.now();
  if (now - lastDnsLogAt < DNS_LOG_TTL_MS) return;
  lastDnsLogAt = now;
  try {
    const results = await lookup(UNSPLASH_HOST, { all: true });
    logInfo(
      `[itinerary] Unsplash DNS ${context}: host=${UNSPLASH_HOST} results=${JSON.stringify(
        results
      )}`
    );
  } catch (err) {
    logError(`[itinerary] Unsplash DNS ${context} failed for host=${UNSPLASH_HOST}`, err);
  }
};

export const runUnsplashHealthCheck = async (context: string): Promise<UnsplashHealthResult> => {
  logNetworkEnvOnce();
  const key = getUnsplashKey();
  if (!key) {
    logError('[itinerary] Unsplash health check failed: key missing');
    return { ok: false, error: 'UNSPLASH_ACCESS_KEY missing' };
  }

  const url = UNSPLASH_URL;
  const timeoutMs = Number(getEnvValue('UNSPLASH_HEALTH_TIMEOUT_MS') ?? 20000);
  const retries = Math.max(1, Number(getEnvValue('UNSPLASH_HEALTH_RETRIES') ?? 2));
  const shouldRetryStatus = (status?: number) => status === 429 || (status !== undefined && status >= 500);
  
  void logDnsOnce(context);
  if (!isTestEnv()) {
    logInfo(`[itinerary] Unsplash health check starting: url=${url} timeout=${timeoutMs}ms retries=${retries}`);
  }


  for (let attempt = 0; attempt < retries; attempt++) {
    if (!isTestEnv()) {
      logInfo(
        `[itinerary] Unsplash health check attempting (attempt ${attempt + 1}) to ${url} with timeout ${timeoutMs}ms`
      );
    }
    try {
      const startedAt = Date.now();
      const response = await requestUnsplashHealthCheck({
        accessKey: key,
        timeoutMs,
        validateStatus: () => true,
      });
      const elapsedMs = Date.now() - startedAt;
      logUnsplashResponseInfo(`${context} elapsedMs=${elapsedMs}`, response);
      if (response.status < 200 || response.status >= 300) {
        if (shouldRetryStatus(response.status) && attempt < retries - 1) {
          await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
          continue;
        }
        return { ok: false, status: response.status, statusText: response.statusText };
      }
      return { ok: true, status: response.status };
    } catch (err: any) {
      const code = err?.code ? ` code=${err.code}` : '';
      const details = JSON.stringify({
        timeoutMs,
        errno: err?.errno,
        syscall: err?.syscall,
        address: err?.address,
        port: err?.port,
      });
      logError(
        `[itinerary] Unsplash health check failed (attempt ${attempt + 1})${code} details=${details}`,
        err
      );
      if (attempt < retries - 1) {
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
        continue;
      }
      return { ok: false, error: 'Unsplash request failed' };
    }
  }

  return { ok: false, error: 'Unsplash request failed' };
};
