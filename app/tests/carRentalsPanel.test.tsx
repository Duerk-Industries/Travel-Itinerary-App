/**
 * @jest-environment node
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import CarRentalsPanel from '../components/CarRentalsPanel';
import { createInitialCarRentalDraft, type CarRental } from '../tabs/carRentals';

const styles: Record<string, any> = {
  card: {},
  sectionHeaderRow: {},
  sectionTitle: {},
  table: {},
  tableRow: {},
  tableHeaderRow: {},
  tableHeaderCell: {},
  headerText: {},
  tableCell: {},
  cellText: {},
  lastCell: {},
  lastRow: {},
  helperText: {},
  actionCell: {},
  button: {},
  smallButton: {},
  dangerButton: {},
  buttonText: {},
  dangerButtonText: {},
  carFormSection: {},
  carFormGrid: {},
  carFormField: {},
  carFormWideField: {},
  cellTextWrap: {},
  input: {},
  dateInputWrap: {},
  dateTouchable: {},
  dateIcon: {},
  selectCaret: {},
  dropdown: {},
  selectButtonRow: {},
  prepaidSelectorButton: {},
  prepaidSelectorButtonSelected: {},
  prepaidSelectorText: {},
  dropdownList: {},
  prepaidDropdownList: {},
  carMemberRow: {},
  carMemberField: {},
  modalLabelSmall: {},
  payerChips: {},
  payerChip: {},
  removeText: {},
  payerOptions: {},
  carAddButton: {},
};

const baseMember = {
  id: 'm1',
  firstName: 'Alice',
  lastName: 'Tester',
  email: 'alice@example.com',
  status: 'active' as const,
};

const makeCarRental = (overrides: Partial<CarRental> = {}): CarRental => ({
  id: 'car-1',
  tripId: 'trip-1',
  status: 'Booked' as any,
  pickupLocation: 'LAX',
  pickupDate: '2026-05-10',
  dropoffLocation: 'SFO',
  dropoffDate: '2026-05-15',
  reference: 'REF-123',
  vendor: 'Hertz',
  prepaid: 'Yes',
  cost: '250',
  model: 'Prius',
  notes: '',
  paidBy: ['m1'],
  travelerIds: ['m1'],
  ...overrides,
});

const baseProps = {
  carRentals: [] as CarRental[],
  carDraft: createInitialCarRentalDraft(),
  setCarDraft: jest.fn() as any,
  carPrepaidOpen: false,
  setCarPrepaidOpen: jest.fn() as any,
  carPickupDateRef: { current: null } as any,
  carDropoffDateRef: { current: null } as any,
  isFollowingMode: false,
  userMembers: [baseMember] as any,
  styles,
  payerName: (id: string) => (id === 'm1' ? 'Alice T.' : id),
  formatMemberName: (m: any) => `${m.firstName} ${m.lastName}`.trim(),
  onAddCarRental: jest.fn(),
  onRemoveCarRental: jest.fn(),
  onVoteCarRental: jest.fn(),
  onRateCarRental: jest.fn(),
  onOpenCarDatePicker: jest.fn(),
};

beforeEach(() => {
  Object.values(baseProps).forEach((v) => {
    if (typeof v === 'function' && 'mockClear' in v) (v as jest.Mock).mockClear();
  });
});

describe('CarRentalsPanel', () => {
  it('renders the Car Rentals heading and an empty table by default', () => {
    const { getByText, queryByTestId } = render(<CarRentalsPanel {...baseProps} />);
    expect(getByText('Car Rentals')).toBeTruthy();
    // No rows yet.
    expect(queryByTestId('car-rental-delete-car-1')).toBeNull();
    // Form is visible by default (isFollowingMode=false).
    expect(queryByTestId('car-rental-add')).toBeTruthy();
  });

  it('renders one row per car rental with a route label + vendor/model/reference sub-line', () => {
    const rental = makeCarRental();
    const { getByText, getByTestId } = render(
      <CarRentalsPanel {...baseProps} carRentals={[rental]} />,
    );
    expect(getByText('LAX → SFO')).toBeTruthy();
    expect(getByText('Hertz • Prius • REF-123')).toBeTruthy();
    expect(getByTestId('car-rental-delete-car-1')).toBeTruthy();
  });

  it('fires onRemoveCarRental when the Delete button is pressed', () => {
    const rental = makeCarRental();
    const { getByTestId } = render(
      <CarRentalsPanel {...baseProps} carRentals={[rental]} />,
    );
    fireEvent.press(getByTestId('car-rental-delete-car-1'));
    expect(baseProps.onRemoveCarRental).toHaveBeenCalledTimes(1);
    expect(baseProps.onRemoveCarRental).toHaveBeenCalledWith('car-1');
  });

  it('fires onAddCarRental when the Add button is pressed', () => {
    const { getByTestId } = render(<CarRentalsPanel {...baseProps} />);
    fireEvent.press(getByTestId('car-rental-add'));
    expect(baseProps.onAddCarRental).toHaveBeenCalledTimes(1);
  });

  it('hides the Add form and replaces Delete buttons with "View only" when isFollowingMode is true', () => {
    const rental = makeCarRental();
    const { getByText, queryByTestId } = render(
      <CarRentalsPanel {...baseProps} carRentals={[rental]} isFollowingMode />,
    );
    expect(queryByTestId('car-rental-add')).toBeNull();
    expect(queryByTestId('car-rental-delete-car-1')).toBeNull();
    expect(getByText('View only')).toBeTruthy();
  });

  it('shows vote buttons only for non-completed statuses when the user has not voted yet', () => {
    const rental = makeCarRental({ status: 'Proposed' as any, userVote: null });
    const { getAllByText } = render(
      <CarRentalsPanel {...baseProps} carRentals={[rental]} />,
    );
    // Thumbs-up 👍 + thumbs-down 👎 should each render once.
    expect(getAllByText('👍')).toHaveLength(1);
    expect(getAllByText('👎')).toHaveLength(1);
  });

  it('fires onVoteCarRental when the thumbs-up is pressed', () => {
    const rental = makeCarRental({ status: 'Proposed' as any, userVote: null });
    const { getByText } = render(
      <CarRentalsPanel {...baseProps} carRentals={[rental]} />,
    );
    fireEvent.press(getByText('👍'));
    expect(baseProps.onVoteCarRental).toHaveBeenCalledWith('car-1', 1);
  });
});
