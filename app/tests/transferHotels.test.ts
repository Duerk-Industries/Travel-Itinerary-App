import { hotelsForTransferDate, type TransferHotel } from '../utils/transferHotels';

const hotel = (id: string, checkInDate: string, checkOutDate: string, address = '123 Hotel Road'): TransferHotel => ({ id, name: id, checkInDate, checkOutDate, address, status: 'Booked' });

describe('transfer hotel address choices', () => {
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
