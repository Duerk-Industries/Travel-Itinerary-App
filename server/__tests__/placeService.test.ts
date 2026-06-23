/// <reference types="jest" />
/// <reference types="node" />
import { autocompletePlaces, getPlaceDetailsFromGoogle } from '../src/services/placeService';

describe('placeService', () => {
  describe('autocompletePlaces', () => {
    it('returns an empty array while Google Places is disabled', async () => {
      const result = await autocompletePlaces('Paris');
      expect(result).toEqual([]);
    });
  });

  describe('getPlaceDetailsFromGoogle', () => {
    it('returns null while Google Places is disabled', async () => {
      const result = await getPlaceDetailsFromGoogle('456');
      expect(result).toBeNull();
    });
  });
});
