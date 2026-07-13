export const getMapsApiKey = (): string => {
  return (
    (typeof process !== 'undefined' && (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY)) ||
    ''
  );
};

/**
 * Build the server-proxied map URL used by authenticated app screens.  The
 * optional legacy apiKey form remains available for callers outside the app,
 * but normal UI traffic now goes through the server so quota and cost are
 * enforced by the shared provider limiter.
 */
export const buildStaticMapUrl = (address: string, backendUrl?: string, apiKey?: string): string => {
  if (!address) return '';
  const isBackendUrl = Boolean(backendUrl && /^https?:\/\//i.test(backendUrl));
  if (isBackendUrl) {
    return `${backendUrl!.replace(/\/+$/, '')}/api/maps/static?address=${encodeURIComponent(address)}`;
  }
  const key = apiKey ?? (backendUrl && !isBackendUrl ? backendUrl : getMapsApiKey());
  if (!key) return '';
  const encoded = encodeURIComponent(address);
  const base = `https://maps.googleapis.com/maps/api/staticmap?center=${encoded}&zoom=14&size=600x320&scale=2&maptype=roadmap&markers=color:red|${encoded}`;
  return `${base}&key=${key}`;
};
