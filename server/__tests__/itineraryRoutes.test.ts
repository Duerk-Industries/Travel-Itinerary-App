import request from 'supertest';
import { app } from '../src/app';
import * as auth from '../src/auth';
import * as imageService from '../src/image-service';

jest.mock('../src/auth');
jest.mock('../src/image-service', () => ({
  getItineraryImage: jest.fn(),
}));
jest.mock('../src/db.firebase');

describe('/api/itinerary/images', () => {
  beforeEach(() => {
    (auth.authenticate as jest.Mock).mockImplementation((req, _res, next) => {
      (req as any).user = { userId: 'test-user' };
      next();
    });
    jest.clearAllMocks();
  });

  it('returns image url from unsplash service when no placeId provided', async () => {
    (imageService.getItineraryImage as jest.Mock).mockResolvedValue({
      url: 'https://mock-service-url.com/img.jpg',
      cached: true,
      provider: 'unsplash',
      fallbackUsed: false,
    });
    
    const res = await request(app).get('/api/itinerary/images?location=paris').expect(200);
    
    expect(res.body.url).toBe('https://mock-service-url.com/img.jpg');
    expect(res.body.cached).toBe(true);
    expect(imageService.getItineraryImage).toHaveBeenCalledWith({
      locationName: 'paris',
      placeId: undefined,
      day: undefined,
      contextText: undefined,
    });
  });

  it('uses google place image service when placeId is provided', async () => {
     (imageService.getItineraryImage as jest.Mock).mockResolvedValue({
       url: 'https://google-place/img.jpg',
       cached: false,
       provider: 'google',
       fallbackUsed: false,
     });
     
     const res = await request(app).get('/api/itinerary/images?location=paris&placeId=place123').expect(200);
     
     expect(res.body.url).toBe('https://google-place/img.jpg');
     expect(imageService.getItineraryImage).toHaveBeenCalledWith({
       locationName: 'paris',
       placeId: 'place123',
       day: undefined,
       contextText: undefined,
     });
  });

  it('falls back to placeholder when service returns no url', async () => {
    (imageService.getItineraryImage as jest.Mock).mockResolvedValue({
      url: '',
      cached: false,
      provider: 'placeholder',
      fallbackUsed: true,
    });
    
    const res = await request(app).get('/api/itinerary/images?location=fail').expect(200);
    
    expect(res.body.url).toContain('data:image/svg+xml');
    expect(res.body.cached).toBe(false);
    expect(res.body.provider).toBe('placeholder');
    expect(res.body.fallbackUsed).toBe(true);
  });
});
