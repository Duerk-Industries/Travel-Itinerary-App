type WebOAuthRedirectParams = {
  currentOrigin: string;
  backendUrl: string;
  path?: string;
};

const stripTrailingSlash = (value: string): string => value.replace(/\/$/, '');

const parseUrl = (raw: string): URL | null => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

const isLoopbackHostname = (hostname: string): boolean =>
  /^(localhost|127\.0\.0\.1|::1)$/i.test(hostname.trim());

export const buildWebOAuthRedirectUrl = ({
  currentOrigin,
  backendUrl,
  path = '/login',
}: WebOAuthRedirectParams): string => {
  const current = parseUrl(stripTrailingSlash(currentOrigin));
  const backend = parseUrl(stripTrailingSlash(backendUrl));

  if (!current) {
    return `${stripTrailingSlash(currentOrigin)}${path}`;
  }

  // Local development: always stay on the current origin (e.g. localhost:8081).
  if (isLoopbackHostname(current.hostname)) {
    return `${current.origin}${path}`;
  }

  // Production/Staging:
  // If the current origin is a secure HTTPS host, we prefer it over forcing
  // a redirect to the canonical backend origin. This allows the app to be
  // hosted on multiple domains (e.g. wander-bunnies.com and duerk.org)
  // while preserving the user's active domain.
  if (current.protocol === 'https:') {
    return `${current.origin}${path}`;
  }

  // Fallback: if we are on a non-secure origin (rare in production) but have
  // a valid secure backend origin, we use the backend origin as a safe
  // canonical return path.
  if (backend && backend.protocol === 'https:') {
    return `${backend.origin}${path}`;
  }

  return `${current.origin}${path}`;
};
