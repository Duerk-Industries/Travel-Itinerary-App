import { hotelsForTransferDate, activitiesForTransferDate, transferLocationLabel, type TransferHotel } from '../utils/transferHotels';

const hotel = (id: string, checkInDate: string, checkOutDate: string, address = '123 Hotel Road'): TransferHotel => ({ id, name: id, checkInDate, checkOutDate, address, status: 'Booked' });

describe('transfer hotel address choices', () => {
  it('resolves hotel names from stored addresses while leaving other locations unchanged', () => {
    const hotels = [hotel('Hotel A', '2027-03-01', '2027-03-04')];
    expect(transferLocationLabel(' 123 HOTEL  Road ', hotels, '2027-03-02')).toBe('Hotel A');
    expect(transferLocationLabel('Station', hotels, '2027-03-02')).toBe('Station');
    expect(transferLocationLabel('', hotels, '2027-03-02')).toBe('');
  });

  it('uses the stay dates to distinguish shared addresses, keeping ambiguous locations as addresses', () => {
    const hotels = [hotel('Hotel A', '2027-03-01', '2027-03-04'), hotel('Hotel B', '2027-04-01', '2027-04-04')];
    expect(transferLocationLabel('123 Hotel Road', hotels, '2027-04-02')).toBe('Hotel B');
    expect(transferLocationLabel('123 Hotel Road', hotels, '')).toBe('123 Hotel Road');
  });
  it('offers current stays, checkout-day stays, and next-day check-ins only when they have addresses', () => {
    const hotels = [hotel('current', '2027-03-01', '2027-03-04'), hotel('checkout', '2027-03-01', '2027-03-02'),
      hotel('tomorrow', '2027-03-03', '2027-03-04'), hotel('old', '2027-02-25', '2027-03-01'), hotel('future', '2027-03-04', '2027-03-06'),
      hotel('no-address', '2027-03-01', '2027-03-04', '  '), { ...hotel('cancelled', '2027-03-01', '2027-03-04'), status: 'Cancelled' as const }];
    expect(hotelsForTransferDate(hotels, '2027-03-02').map(item => item.id)).toEqual(['current', 'checkout', 'tomorrow']);
  });

  it('handles month and year boundaries and has no choices without a date', () => {
    expect(hotelsForTransferDate([hotel('new-year', '2028-01-01', '2028-01-02')], '2027-12-31')).toHaveLength(1);
    expect(hotelsForTransferDate([hotel('march', '2028-03-01', '2028-03-02')], '2028-02-29')).toHaveLength(1);
    expect(hotelsForTransferDate([hotel('hotel', '2027-03-01', '2027-03-04')], '')).toEqual([]);
  });
});

it('offers only activities on the selected day with a nonblank location and active status', () => {
  const activity = { id: 'a', name: 'Museum', date: '2027-03-02', startLocation: 'Museum Road', status: 'Booked' as const };
  const activities = [activity, { ...activity, id: 'yesterday', date: '2027-03-01' }, { ...activity, id: 'tomorrow', date: '2027-03-03' },
    { ...activity, id: 'blank', startLocation: '   ' }, { ...activity, id: 'cancelled', status: 'Cancelled' as const }];
  expect(activitiesForTransferDate(activities, '2027-03-02').map(row => row.id)).toEqual(['a']);
  expect(activitiesForTransferDate(activities, '2027-03-03').map(row => row.id)).toEqual(['tomorrow']);
  expect(activitiesForTransferDate(activities, '')).toEqual([]);
});
