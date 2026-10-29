/**
 * A hotel that came from an itinerary template is a placeholder ("Hotel in Kyoto"). It carries this
 * feature tag until the traveler edits the stay, and the lodging list nudges them to choose their own.
 * Keep the text in step with CHOOSE_HOTEL_FEATURE in server/src/services/tripTemplateService.ts.
 */
export const CHOOSE_HOTEL_FEATURE = 'Choose your hotel';

export const needsHotelChoice = (lodging: { features?: string[] | null } | null | undefined): boolean =>
  Boolean(lodging?.features?.includes(CHOOSE_HOTEL_FEATURE));

/** Saving an edit means the traveler has looked at the stay, so the placeholder tag goes. */
export const withoutHotelPlaceholder = <T extends { features?: unknown }>(payload: T): T => {
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features) || !features.includes(CHOOSE_HOTEL_FEATURE)) return payload;
  return { ...payload, features: features.filter((feature) => feature !== CHOOSE_HOTEL_FEATURE) };
};
