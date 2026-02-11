import axios from 'axios';
import { getGooglePlaceImage } from '../src/image-service';

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({ bucket: jest.fn() })),
}));
jest.mock('axios');

describe('image-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.UNSPLASH_ACCESS_KEY = 'test-unsplash-key';
  });

  it('getGooglePlaceImage falls back to Unsplash', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: {
        results: [{ urls: { regular: 'https://images.example.com/unsplash-paris.jpg' } }],
      },
    });

    const result = await getGooglePlaceImage('Paris', 'place123');

    expect(result).toBe('https://images.example.com/unsplash-paris.jpg');
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('api.unsplash.com/search/photos?query=Paris'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining('Client-ID') }),
      })
    );
  });
});
