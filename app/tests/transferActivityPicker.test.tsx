import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import HotelAddressPicker from '../components/HotelAddressPicker';

it('offers hotel and same-day activity addresses together and updates when the date changes', () => {
  const onSelect = jest.fn();
  const hotels = [{ id: 'hotel', name: 'Hotel', address: 'Hotel Road', checkInDate: '2027-03-01', checkOutDate: '2027-03-04', status: 'Booked' as const }];
  const activities = [
    { id: 'museum', name: 'Museum', startLocation: '  Museum Road  ', date: '2027-03-02', status: 'Booked' as const },
    { id: 'tour', name: 'Tour', startLocation: 'Tour Road', date: '2027-03-03', status: 'Booked' as const },
  ];
  const view = render(<HotelAddressPicker hotels={hotels} activities={activities} date="2027-03-02" styles={{}} testID="locations" onSelect={onSelect} />);
  fireEvent.press(view.getByTestId('locations'));
  expect(view.getByText('Hotel')).toBeTruthy();
  expect(view.getByText('Museum')).toBeTruthy();
  expect(view.queryByText(/ · /)).toBeNull();
  expect(view.getByTestId('locations-hotel')).toBeTruthy();
  expect(view.queryByTestId('locations-activity:tour')).toBeNull();
  fireEvent.press(view.getByTestId('locations-activity:museum'));
  expect(onSelect).toHaveBeenCalledWith('Museum Road');
  view.rerender(<HotelAddressPicker hotels={hotels} activities={activities} date="2027-03-03" styles={{}} testID="locations" onSelect={onSelect} />);
  fireEvent.press(view.getByTestId('locations'));
  expect(view.queryByTestId('locations-activity:museum')).toBeNull();
  fireEvent.press(view.getByTestId('locations-activity:tour'));
  expect(onSelect).toHaveBeenLastCalledWith('Tour Road');
});
