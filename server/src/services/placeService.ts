// Google Places integration is intentionally disabled for now.

export const autocompletePlaces = async (input: string): Promise<any[]> => {
  void input;
  return [];
};

export const getPlaceDetailsFromGoogle = async (placeId: string): Promise<any | null> => {
  void placeId;
  return null;
};
