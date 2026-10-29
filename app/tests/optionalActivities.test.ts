import { optionalActivitiesForDay } from '../utils/optionalActivities';

const trip = { startDate: '2027-05-01', endDate: '2027-05-10' };
const hotel = { id: 'hotel', checkInDate: '2027-05-04', checkOutDate: '2027-05-06' };
const activities = [
  { id: 'anywhere', date: '', nearLodgingId: null },
  { id: 'nearby', date: '', nearLodgingId: 'hotel' },
  { id: 'scheduled', date: '2027-05-04', nearLodgingId: null },
  { id: 'cancelled', date: '', status: 'Cancelled', nearLodgingId: null },
];

describe('optional activity availability', () => {
  it.each(['2027-05-03', '2027-05-04', '2027-05-05', '2027-05-06', '2027-05-07'])(
    'includes the hotel stay and each adjacent day: %s', (date) => {
      expect(optionalActivitiesForDay(activities, [hotel], date, trip).map((row) => row.id)).toEqual(['anywhere', 'nearby']);
    },
  );
  it.each(['2027-05-01', '2027-05-02', '2027-05-08', '2027-05-10'])(
    'only offers unlinked activities outside the hotel window: %s', (date) => {
      expect(optionalActivitiesForDay(activities, [hotel], date, trip).map((row) => row.id)).toEqual(['anywhere']);
    },
  );
  it('limits availability to trip days and handles invalid dates', () => {
    for (const date of ['2027-04-30', '2027-05-11', '', '2027-02-30']) {
      expect(optionalActivitiesForDay(activities, [hotel], date, trip)).toEqual([]);
    }
  });
  it('offers unlinked activities without hotels and excludes missing or cancelled hotels', () => {
    expect(optionalActivitiesForDay(activities, [], '2027-05-04', trip).map((row) => row.id)).toEqual(['anywhere']);
    expect(optionalActivitiesForDay(activities, [{ ...hotel, status: 'Cancelled' }], '2027-05-04', trip).map((row) => row.id)).toEqual(['anywhere']);
  });
});
