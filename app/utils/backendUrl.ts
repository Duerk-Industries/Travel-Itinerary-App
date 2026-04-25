type BrowserLocationLike = {
  hostname: string;
  protocol: string;
  port?: string;
  origin: string;
};

type ResolveBackendUrlParams = {
  appConfigured?: string | null;
  envConfigured?: string | null;
  nodeEnv?: string;
  platformOs: string;
  browserLocation?: BrowserLocationLike | null;
};

const isLoopbackHostname = (value: string): boolean => /^(localhost|127\.0\.0\.1|::1)$/i.test(value.trim());

const stripTrailingSlash = (value: string): string => value.replace(/\/$/, '');

const normalizeBackendUrl = (raw: string, defaultProtocol: 'http' | 'https'): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return stripTrailingSlash(trimmed);
  }
  return `${defaultProtocol}://${trimmed}`;
};

const tryParseUrl = (raw: string, defaultProtocol: 'http' | 'https'): URL | null => {
  try {
    return new URL(normalizeBackendUrl(raw, defaultProtocol));
  } catch {
    return null;
  }
};

const remapLoopbackHostname = (configuredBackend: string, browserHostname: string): string | null => {
  const parsed = tryParseUrl(configuredBackend, 'http');
  if (!parsed || !isLoopbackHostname(parsed.hostname) || !isLoopbackHostname(browserHostname)) {
    return null;
  }
  parsed.hostname = browserHostname;
  return stripTrailingSlash(parsed.toString());
};

export const resolveBackendUrl = ({
  appConfigured,
  envConfigured,
  nodeEnv,
  platformOs,
  browserLocation,
}: ResolveBackendUrlParams): string => {
  // Guard against `process.env.X = undefined` being coerced to the literal
  // string "undefined" (a Node.js quirk) and inlined into the bundle by Expo.
  const isUsable = (value: string | null | undefined): value is string => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed.length === 0) return false;
    const lower = trimmed.toLowerCase();
    return lower !== 'undefined' && lower !== 'null';
  };

  const configuredBackend = [envConfigured, appConfigured].find(isUsable);

  if (platformOs === 'web' && browserLocation) {
    const { hostname, protocol, port, origin } = browserLocation;
    const browserOrigin = stripTrailingSlash(origin);

    if (isLoopbackHostname(hostname)) {
      if (port === '4000') {
        return browserOrigin;
      }
      const remappedLoopbackBackend = configuredBackend
        ? remapLoopbackHostname(configuredBackend, hostname)
        : null;
      if (remappedLoopbackBackend) {
        return remappedLoopbackBackend;
      }
      return `${protocol}//${hostname}:4000`;
    }

    if (configuredBackend) {
      const parsedConfiguredBackend = tryParseUrl(configuredBackend, 'https');
      if (parsedConfiguredBackend && isLoopbackHostname(parsedConfiguredBackend.hostname)) {
        return browserOrigin;
      }
      return normalizeBackendUrl(configuredBackend, 'https');
    }

    return browserOrigin;
  }

  if (nodeEnv === 'development') {
    if (configuredBackend) {
      return normalizeBackendUrl(configuredBackend, 'http');
    }
    return 'http://localhost:4000';
  }

  return normalizeBackendUrl(configuredBackend ?? 'https://duerk.org', 'https');
};
