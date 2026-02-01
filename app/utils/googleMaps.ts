export const getMapsApiKey = (): string => {
  return (
    (typeof process !== 'undefined' && (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY)) ||
    ''
  );
};

export const buildStaticMapUrl = (address: string, apiKey?: string): string => {
  if (!address) return '';
  const key = apiKey ?? getMapsApiKey();
  const encoded = encodeURIComponent(address);
  const base = `https://maps.googleapis.com/maps/api/staticmap?center=${encoded}&zoom=14&size=600x320&scale=2&maptype=roadmap&markers=color:red|${encoded}`;
  return key ? `${base}&key=${key}` : base;
};
