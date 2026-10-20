import { getPlanningDayPoints } from '../src/services/planningPointsService';
import * as db from '../src/db';
import { resolveCatalogCoordinates } from '../src/services/geocodingService';
jest.mock('../src/db', () => ({ listFlights: jest.fn(), listLodgings: jest.fn(), listActivities: jest.fn(), listCarRentals: jest.fn(), getTripById: jest.fn(), listAttractionCatalogEntries: jest.fn() }));
jest.mock('../src/services/geocodingService', () => ({ resolveCatalogCoordinates: jest.fn() }));
const activity = { id: 'activity', name: 'Museum', startLocation: 'Museum', date: '2027-04-05', status: 'Proposed', catalogId: 'catalog' };
const place = { id: 'catalog', name: 'Museum', destinationDisplayName: 'Paris', sourceUrl: 'https://en.wikipedia.org/wiki/Museum', lat: 48.86, lon: 2.34 };
beforeEach(() => {
  jest.clearAllMocks();
  (db.listFlights as jest.Mock).mockResolvedValue([]); (db.listLodgings as jest.Mock).mockResolvedValue([]); (db.listCarRentals as jest.Mock).mockResolvedValue([]);
  (db.listActivities as jest.Mock).mockResolvedValue([activity]); (db.getTripById as jest.Mock).mockResolvedValue({ destination: 'Paris' });
  (db.listAttractionCatalogEntries as jest.Mock).mockResolvedValue([place]);
  (resolveCatalogCoordinates as jest.Mock).mockResolvedValue({ lat: 48.86, lng: 2.34, geoCity: 'Paris' });
});
it('reuses permitted catalog coordinates without an external-geocoding prerequisite', async () => {
  expect((await getPlanningDayPoints('user', 'trip', activity.date))[0]).toMatchObject({ lat: 48.86, lng: 2.34, coordinateSource: 'catalog' });
  expect(resolveCatalogCoordinates).not.toHaveBeenCalled();
});
it('preserves manual coordinates and never enqueues that item', async () => {
  (db.listActivities as jest.Mock).mockResolvedValue([{ ...activity, lat: 40, lng: 10, coordinateSource: 'manual' }]);
  expect((await getPlanningDayPoints('user', 'trip', activity.date))[0].lat).toBe(40);
  expect(db.listAttractionCatalogEntries).not.toHaveBeenCalled();
});
it('uses only a current matching public POI and never writes an item in the background', async () => {
  (db.listAttractionCatalogEntries as jest.Mock).mockResolvedValue([{ ...place, lat: null, lon: null }]);
  expect((await getPlanningDayPoints('user', 'trip', activity.date))[0].coordinateSource).toBe('geocoder');
  expect(resolveCatalogCoordinates).toHaveBeenCalledWith(expect.objectContaining({ name: 'Museum' }));
});
it.each([{ name: 'New stop' }, { startLocation: 'My private address' }])('does not apply a stale catalog identity after an item edit: %j', async edit => {
  (db.listActivities as jest.Mock).mockResolvedValue([{ ...activity, ...edit }]);
  expect((await getPlanningDayPoints('user', 'trip', activity.date))[0].lat).toBeUndefined();
  expect(resolveCatalogCoordinates).not.toHaveBeenCalled();
});
