import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AirportInput from '../components/AirportInput';
import { formatFlightDetails } from '../utils/overviewBuilder';

test('airport suggestions can be selected and return the full label and code', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true,
    json: async () => ['Boston (BOS)', 'Other location'] } as Response);
  const onChange = jest.fn();
  try {
    const view = render(<AirportInput backendUrl="http://localhost:4000" value="Boston" onChange={onChange}
      styles={{}} testID="airport" />);
    fireEvent(view.getByTestId('airport'), 'focus');
    fireEvent.press(await view.findByTestId('airport-option-BOS'));
    expect(onChange).toHaveBeenCalledWith('Boston (BOS)', 'BOS');
    await waitFor(() => expect(view.queryByTestId('airport-option-BOS')).toBeNull());
    expect(view.queryByText('Other location')).toBeNull();
  } finally { fetchMock.mockRestore(); }
});

test('flight details combine airline and number and arrival date and time', () => {
  const rows = formatFlightDetails({ id: 'flight', carrier: 'Japan Airlines', flight_number: 'JL7',
    departure_date: '2026-11-09', arrival_date: '2026-11-10', arrival_time: '16:10' });
  expect(rows).toContainEqual({ label: 'Flight', value: 'Japan Airlines JL7' });
  expect(rows.some(row => ['Type', 'Carrier', 'Transfer Number', 'Arrival Time'].includes(row.label))).toBe(false);
  expect(rows.filter(row => row.label === 'Arrival Date')).toHaveLength(1);
  expect(rows.find(row => row.label === 'Arrival Date')?.value).toContain('4:10 PM');
});
