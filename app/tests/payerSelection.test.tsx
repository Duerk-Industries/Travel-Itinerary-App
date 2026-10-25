import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import PayerSelect from '../components/PayerSelect';
import { payerOptions, singlePayerIds } from '../utils/payerSelection';
import { buildCarRentalFromDraft, createInitialCarRentalDraft } from '../tabs/carRentals';

const members = [
  { id: 'z', firstName: 'Zoe', lastName: 'Traveler' },
  { id: 'b', email: 'bob@example.com', status: 'pending' },
  { id: 'a', guestName: 'Alice Guest' },
  { id: 'removed', firstName: 'Aaron', status: 'removed' },
];
const originalOS = Platform.OS;
afterEach(() => Object.assign(Platform, { OS: originalOS }));

it('sorts available payers by displayed name without changing membership order', () => {
  expect(payerOptions(members)).toEqual([
    { value: 'a', label: 'Alice Guest' },
    { value: 'b', label: 'bob@example.com' },
    { value: 'z', label: 'Zoe Traveler' },
  ]);
  expect(members.map(member => member.id)).toEqual(['z', 'b', 'a', 'removed']);
});

it('normalizes legacy multiple payers and uses the default only when empty', () => {
  expect(singlePayerIds(['z', 'a'], 'b')).toEqual(['z']);
  expect(singlePayerIds([], 'b')).toEqual(['b']);
  expect(singlePayerIds()).toEqual([]);
});

it.each(['ios', 'android'] as const)('replaces the payer with one choice on %s', os => {
  Object.assign(Platform, { OS: os });
  const onChange = jest.fn();
  const screen = render(<PayerSelect members={members} value={['z', 'b']} onChange={onChange} styles={{}} testID="payer" />);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText('Zoe Traveler')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Payer'));
  fireEvent.press(screen.getByTestId('payer-option-a'));
  expect(onChange).toHaveBeenCalledWith(['a']);
});

it('uses an alphabetized single-choice HTML dropdown on web', () => {
  Object.assign(Platform, { OS: 'web' });
  const onChange = jest.fn();
  const screen = render(<PayerSelect members={members} value={['z']} onChange={onChange} styles={{}} />);
  const select = screen.UNSAFE_getByType('select' as never);
  expect(select.props.multiple).toBeUndefined();
  expect(screen.UNSAFE_getAllByType('option' as never).map(option => option.props.children)).toEqual([
    'Select payer', 'Alice Guest', 'bob@example.com', 'Zoe Traveler',
  ]);
  fireEvent(select, 'change', { currentTarget: { value: 'b' } });
  expect(onChange).toHaveBeenCalledWith(['b']);
});

it('saves one payer while retaining all participating travelers', () => {
  const result = buildCarRentalFromDraft({
    ...createInitialCarRentalDraft(), vendor: 'Car company', paidBy: ['z', 'a'], travelerIds: ['a', 'b'],
  }, 'b');
  expect(result.error).toBeUndefined();
  expect(result.rental?.paidBy).toEqual(['z']);
  expect(result.rental?.travelerIds).toEqual(['a', 'b']);
});
