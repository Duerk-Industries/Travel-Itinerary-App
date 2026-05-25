type BuildFollowShareLinkOptions = {
  platformOs: string;
  webOrigin?: string | null;
  scheme?: string | string[] | null;
};

const DEFAULT_NATIVE_SCHEME = 'travelitineraryplanner';

const normalizeScheme = (scheme?: string | string[] | null): string => {
  const candidate = Array.isArray(scheme) ? scheme[0] : scheme;
  const trimmed = String(candidate ?? '').trim();
  return trimmed || DEFAULT_NATIVE_SCHEME;
};

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export const buildFollowShareLink = (
  followCode: string,
  { platformOs, webOrigin, scheme }: BuildFollowShareLinkOptions
): string => {
  const code = String(followCode ?? '').trim();
  if (!code) return '';
  const encodedCode = encodeURIComponent(code);

  if (platformOs === 'web' && webOrigin) {
    return `${stripTrailingSlash(webOrigin)}/app?followCode=${encodedCode}`;
  }

  return `${normalizeScheme(scheme)}://app?followCode=${encodedCode}`;
};
