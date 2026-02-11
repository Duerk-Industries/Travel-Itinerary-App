// Google Places integration is intentionally disabled for now.

export const autocompletePlaces = async (_input: string): Promise<any[]> => {
  return [];
};

export const getPlaceDetailsFromGoogle = async (_placeId: string): Promise<any | null> => {
  return null;
};
