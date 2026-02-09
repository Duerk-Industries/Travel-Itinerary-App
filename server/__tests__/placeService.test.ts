import axios from 'axios';
import { autocompletePlaces, getPlaceDetailsFromGoogle } from '../src/services/placeService';

jest.mock('axios');
jest.mock('../src/env', () => ({
  getEnvValue: jest.fn().mockReturnValue('TEST_KEY'),
}));

describe('placeService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('autocompletePlaces', () => {
    it('should return predictions on success', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: {
          status: 'OK',
          predictions: [{ description: 'Paris, France', place_id: '123' }],
        },
      });

      const result = await autocompletePlaces('Paris');
      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('Paris, France');
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/autocomplete/json'), expect.any(Object));
    });

    it('should return empty array on error', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: { status: 'REQUEST_DENIED' },
      });

      const result = await autocompletePlaces('Paris');
      expect(result).toEqual([]);
    });
  });

  describe('getPlaceDetailsFromGoogle', () => {
    it('should return details on success', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: {
          status: 'OK',
          result: { name: 'Eiffel Tower', place_id: '456' },
        },
      });

      const result = await getPlaceDetailsFromGoogle('456');
      expect(result.name).toBe('Eiffel Tower');
    });

    it('should return null on error', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: { status: 'INVALID_REQUEST' },
      });

      const result = await getPlaceDetailsFromGoogle('456');
      expect(result).toBeNull();
    });
  });
});
