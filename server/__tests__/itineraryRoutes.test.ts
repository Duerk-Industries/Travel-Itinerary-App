import request from 'supertest';
import { app } from '../src/app';
import * as auth from '../src/auth';
import * as imageService from '../src/image-service';

jest.mock('../src/auth');
jest.mock('../src/image-service');
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
    (imageService.getUnsplashImage as jest.Mock).mockResolvedValue('https://mock-service-url.com/img.jpg');
    
    const res = await request(app).get('/api/itinerary/images?location=paris').expect(200);
    
    expect(res.body.url).toBe('https://mock-service-url.com/img.jpg');
    expect(res.body.cached).toBe(true);
    expect(imageService.getUnsplashImage).toHaveBeenCalledWith('paris');
    expect(imageService.getGooglePlaceImage).not.toHaveBeenCalled();
  });

  it('uses google place image service when placeId is provided', async () => {
     (imageService.getGooglePlaceImage as jest.Mock).mockResolvedValue('https://google-place/img.jpg');
     
     const res = await request(app).get('/api/itinerary/images?location=paris&placeId=place123').expect(200);
     
     expect(res.body.url).toBe('https://google-place/img.jpg');
     expect(imageService.getGooglePlaceImage).toHaveBeenCalledWith('paris', 'place123');
     expect(imageService.getUnsplashImage).not.toHaveBeenCalled();
  });

  it('falls back to placeholder when service throws error', async () => {
    (imageService.getUnsplashImage as jest.Mock).mockRejectedValue(new Error('Service failed'));
    
    const res = await request(app).get('/api/itinerary/images?location=fail').expect(200);
    
    expect(res.body.url).toContain('images.unsplash.com/photo');
    expect(res.body.cached).toBe(false);
  });
});
