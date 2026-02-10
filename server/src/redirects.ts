import { getEnvValue } from './env';

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

const getRedirectAllowlist = (webUrl: string): string[] => {
  const raw = getEnvValue('AUTH_REDIRECT_URI_ALLOWLIST', { defaultValue: '' }) ?? '';
  const entries = raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (webUrl) {
    entries.push(webUrl);
  }
  return entries;
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
    if (redirectUri.startsWith(entry)) {
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
  if (!isRedirectUriAllowed(normalized, webUrl)) {
    return { error: 'redirect_uri is not allowed.' };
  }
  return { redirectUri: normalized };
};

export const appendTokenToRedirect = (redirectUri: string, token: string): string => {
  const url = new URL(redirectUri);
  url.searchParams.set('token', token);
  return url.toString();
};
