import { randomBytes } from 'crypto';
import { getEnvValue, isLocalEnv } from './env';

type RedirectTokenExchangePayload = {
  token: string;
  requirePasswordSetup: boolean;
};

type RedirectTokenExchangeRecord = RedirectTokenExchangePayload & {
  expiresAt: number;
};

const REDIRECT_EXCHANGE_CODE_BYTES = 24;
const REDIRECT_EXCHANGE_TTL_MS = 2 * 60 * 1000;
const redirectTokenExchangeStore = new Map<string, RedirectTokenExchangeRecord>();
const DEFAULT_NATIVE_AUTH_REDIRECT_URIS = ['travelitineraryplanner://login'];

const isHttpProtocol = (protocol: string): boolean => protocol === 'http:' || protocol === 'https:';

const parseHttpOrigin = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (!isHttpProtocol(url.protocol)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

const getWwwCompanionOrigin = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (!isHttpProtocol(url.protocol) || isLoopbackHostname(url.hostname)) {
      return null;
    }
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return url.origin;
    }
    url.hostname = `www.${url.hostname}`;
    return url.origin;
  } catch {
    return null;
  }
};

const getRedirectAllowlist = (webUrl: string): string[] => {
  const raw = getEnvValue('AUTH_REDIRECT_URI_ALLOWLIST', { defaultValue: '' }) ?? '';
  const entries = raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (webUrl) {
    entries.push(webUrl);
    const wwwCompanion = getWwwCompanionOrigin(webUrl);
    if (wwwCompanion) {
      entries.push(wwwCompanion);
    }
  }
  entries.push(...DEFAULT_NATIVE_AUTH_REDIRECT_URIS);
  return entries;
};

const matchesNonHttpRedirectEntry = (redirectUri: string, entry: string): boolean => {
  // A scheme-only entry intentionally allows all routes for that scheme.
  if (entry.endsWith('://')) {
    return redirectUri.startsWith(entry);
  }
  return redirectUri === entry || redirectUri.startsWith(`${entry}?`) || redirectUri.startsWith(`${entry}#`);
};

const normalizeRedirectUri = (raw: string, webUrl: string): string | null => {
  if (!raw) {
    return null;
  }
  if (raw.startsWith('/')) {
    try {
      return new URL(raw, webUrl).toString();
    } catch {
      return null;
    }
  }
  return raw;
};

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

const isForbiddenProductionLoopbackRedirect = (redirectUri: string): boolean => {
  if (isLocalEnv()) {
    return false;
  }
  try {
    const url = new URL(redirectUri);
    return isHttpProtocol(url.protocol) && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
};

export const isRedirectUriAllowed = (redirectUri: string, webUrl: string): boolean => {
  const allowlist = getRedirectAllowlist(webUrl);
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    return false;
  }

  if (isHttpProtocol(redirectUrl.protocol)) {
    const redirectOrigin = redirectUrl.origin;
    for (const entry of allowlist) {
      const allowedOrigin = parseHttpOrigin(entry);
      if (!allowedOrigin) {
        continue;
      }
      if (allowedOrigin === redirectOrigin) {
        return true;
      }
    }
    return false;
  }

  for (const entry of allowlist) {
    const allowedOrigin = parseHttpOrigin(entry);
    if (allowedOrigin) {
      continue;
    }
    if (matchesNonHttpRedirectEntry(redirectUri, entry)) {
      return true;
    }
  }

  return false;
};

export const resolveAndValidateRedirectUri = (
  raw: string | undefined,
  webUrl: string
): { redirectUri?: string; error?: string } => {
  if (!raw) {
    return {};
  }
  const normalized = normalizeRedirectUri(raw, webUrl);
  if (!normalized) {
    return { error: 'Invalid redirect_uri format.' };
  }
  if (isForbiddenProductionLoopbackRedirect(normalized)) {
    return { error: 'redirect_uri is not allowed.' };
  }
  if (!isRedirectUriAllowed(normalized, webUrl)) {
    return { error: 'redirect_uri is not allowed.' };
  }
  return { redirectUri: normalized };
};

const pruneExpiredRedirectTokenExchanges = (): void => {
  const now = Date.now();
  for (const [code, record] of redirectTokenExchangeStore.entries()) {
    if (record.expiresAt <= now) {
      redirectTokenExchangeStore.delete(code);
    }
  }
};

export const createRedirectTokenExchangeCode = (payload: RedirectTokenExchangePayload): string => {
  pruneExpiredRedirectTokenExchanges();
  const code = randomBytes(REDIRECT_EXCHANGE_CODE_BYTES).toString('base64url');
  redirectTokenExchangeStore.set(code, {
    ...payload,
    expiresAt: Date.now() + REDIRECT_EXCHANGE_TTL_MS,
  });
  return code;
};

export const consumeRedirectTokenExchangeCode = (code: string): RedirectTokenExchangePayload | null => {
  pruneExpiredRedirectTokenExchanges();
  const record = redirectTokenExchangeStore.get(code);
  if (!record) {
    return null;
  }
  redirectTokenExchangeStore.delete(code);
  if (record.expiresAt <= Date.now()) {
    return null;
  }
  return {
    token: record.token,
    requirePasswordSetup: record.requirePasswordSetup,
  };
};

export const appendAuthCodeToRedirect = (redirectUri: string, code: string): string => {
  const url = new URL(redirectUri);
  url.searchParams.set('auth_code', code);
  return url.toString();
};
