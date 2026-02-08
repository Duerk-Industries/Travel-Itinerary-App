// c:\Git\Tristan\Travel-Itinerary-App\server\__tests__\image-service.test.ts

import axios from 'axios';
// Remove top-level import to avoid hoisting issues with mocks
// import { getGooglePlaceImage } from '../src/image-service';

// Define mocks before importing the module under test
const mockFile = {
  exists: jest.fn(),
  getMetadata: jest.fn(),
  getSignedUrl: jest.fn(),
  createWriteStream: jest.fn(),
};

const mockBucket = {
  file: jest.fn(() => mockFile),
};

const mockStorageInstance = {
  bucket: jest.fn(() => mockBucket),
};

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => mockStorageInstance),
}));

jest.mock('axios');

describe('image-service', () => {
  // Import the module here so that mock variables are initialized
  const { getGooglePlaceImage } = require('../src/image-service');

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset default behaviors
    mockBucket.file.mockReturnValue(mockFile);
    process.env.GOOGLE_PLACES_API_KEY = 'TEST_KEY';
    process.env.LOCATION_BUCKET = 'test-bucket';
  });

  it('should use placeId directly if provided and skip text search', async () => {
    // Mock cache miss
    mockFile.exists.mockResolvedValue([false]);
    
    // Mock axios.get for API calls
    (axios.get as jest.Mock).mockImplementation((url) => {
      if (url.includes('textsearch')) {
        return Promise.reject(new Error('Should not call textsearch'));
      }
      if (url.includes('details')) {
        return Promise.resolve({
          data: { result: { photos: [{ photo_reference: 'ref123' }] } }
        });
      }
      if (url.includes('photo')) {
         // Simulate redirect behavior
         return Promise.resolve({
           status: 302,
           headers: { location: 'http://final-image.url/img.jpg' }
         });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    // Mock axios default export for streaming the image
    (axios as unknown as jest.Mock).mockImplementation((config) => {
        if (config.url === 'http://final-image.url/img.jpg') {
            return Promise.resolve({
                data: {
                    pipe: (dest: any) => {
                        // Simulate piping data to the write stream asynchronously
                        // so the .on('finish') handler has time to be attached
                        setTimeout(() => dest.emit('finish'), 0);
                        return dest;
                    }
                },
                headers: { 'content-type': 'image/jpeg' }
            });
        }
        return Promise.reject(new Error('Unexpected axios stream call'));
    });
    
    // Mock write stream
    const mockWriteStream = {
        on: jest.fn().mockReturnThis(),
        emit: jest.fn()
    };
    mockFile.createWriteStream.mockReturnValue(mockWriteStream);
    mockFile.getSignedUrl.mockResolvedValue(['http://signed.url/img.jpg']);

    const result = await getGooglePlaceImage('Paris', 'place123');

    expect(result).toBe('http://signed.url/img.jpg');
    expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining('textsearch'));
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('place_id=place123'));
    expect(mockBucket.file).toHaveBeenCalledWith('google-places/place123.jpg');
  });
});
