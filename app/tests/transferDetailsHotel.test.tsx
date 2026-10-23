import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { GroundTransferDetailsDialog } from '../components/TransferDetailsDialog';
import type { Flight } from '../tabs/transfers';

const flight: Flight = {
  id: 'transfer-1', trip_id: 'trip-1', transfer_type: 'Private', passenger_name: 'Traveler',
  departure_date: '2027-03-02', departure_time: '09:00', arrival_time: '10:00',
  departure_location: '123 Hotel Road, Tokyo, Japan', arrival_location: '456 Station Road, Tokyo, Japan',
  cost: 0, carrier: '', flight_number: '', booking_reference: '',
};

it('shows hotel names at both endpoints but sends the full addresses to maps', () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const { getAllByText, getByTestId } = render(<GroundTransferDetailsDialog flight={flight}
    backendUrl="http://localhost:4000" headers={{}} styles={{}} mapApp="google"
    lodgings={[
      { id: 'hotel-1', name: 'Hotel A', address: flight.departure_location!, checkInDate: '2027-03-01', checkOutDate: '2027-03-02', status: 'Booked' },
      { id: 'hotel-2', name: 'Hotel B', address: flight.arrival_location!, checkInDate: '2027-03-02', checkOutDate: '2027-03-04', status: 'Booked' },
    ]} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} />);
  expect(getAllByText('Hotel A').length).toBeGreaterThan(0);
  expect(getAllByText('Hotel B').length).toBeGreaterThan(0);
  expect(getAllByText('Hotel A → Hotel B').length).toBeGreaterThan(0);
  fireEvent.press(getByTestId('transfer-directions'));
  const url = new URL(open.mock.calls[0][0]);
  expect(url.searchParams.get('origin')).toBe(flight.departure_location);
  expect(url.searchParams.get('destination')).toBe(flight.arrival_location);
  open.mockRestore();
});
