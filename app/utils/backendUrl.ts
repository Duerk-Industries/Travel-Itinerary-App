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

// Node's local server listens on IPv4 (0.0.0.0). Prefer the explicit IPv4
// loopback address in web development because some Windows browsers resolve
// `localhost` to ::1 first, where the server is not listening.
const getWebLoopbackHostname = (value: string): string =>
  /^(localhost|::1)$/i.test(value.trim()) ? '127.0.0.1' : value;

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
  parsed.hostname = getWebLoopbackHostname(browserHostname);
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
      return `${protocol}//${getWebLoopbackHostname(hostname)}:4000`;
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

  if (nodeEnv === 'development' && platformOs === 'web') {
    if (configuredBackend) {
      return normalizeBackendUrl(configuredBackend, 'http');
    }
    return 'http://127.0.0.1:4000';
  }

  // Native: if a loopback backend was configured (typical local dev setup
  // where app.config.ts injects http://localhost:4000), remap to 10.0.2.2
  // on the Android emulator so it can actually reach the host machine.
  // iOS simulator shares the host's network and can use loopback directly.
  if (configuredBackend && (platformOs === 'android' || platformOs === 'ios')) {
    const parsedConfigured = tryParseUrl(configuredBackend, 'http');
    if (parsedConfigured && isLoopbackHostname(parsedConfigured.hostname)) {
      if (platformOs === 'android') {
        parsedConfigured.hostname = '10.0.2.2';
      }
      return stripTrailingSlash(parsedConfigured.toString());
    }
  }

  return normalizeBackendUrl(configuredBackend ?? 'https://wander-bunnies.com', 'https');
};
