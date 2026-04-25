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

  if (
    backend &&
    backend.protocol === 'https:' &&
    current.protocol === 'https:' &&
    !isLoopbackHostname(current.hostname) &&
    backend.origin !== current.origin
  ) {
    return `${backend.origin}${path}`;
  }

  return `${current.origin}${path}`;
};
