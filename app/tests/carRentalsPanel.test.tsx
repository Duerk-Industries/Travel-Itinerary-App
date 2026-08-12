/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import CarRentalsPanel from '../components/CarRentalsPanel';
import { createInitialCarRentalDraft, type CarRental } from '../tabs/carRentals';

const styles: Record<string, any> = {
  card: {},
  sectionHeaderRow: {},
  sectionTitle: {},
  confirmModal: {},
  modalOverlay: {},
  table: {},
  tableScroll: {},
  tableScrollContent: {},
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
  carEditorDialog: {},
  carEditorScroll: {},
  carEditorContent: {},
  tableFooter: {},
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
  onUpdateCarRental: jest.fn(),
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
  it('opens the sortable editable car-rental grid', () => {
    const { getByTestId, getByText } = render(<CarRentalsPanel {...baseProps} carRentals={[makeCarRental()]} />);
    fireEvent.press(getByTestId('car-rental-table-edit'));
    expect(getByTestId('car-rental-table-save')).toBeTruthy();
    expect(getByText('Pick-up Location')).toBeTruthy();
  });

  it('renders the Car Rentals heading and an empty table by default', () => {
    const { getByText, queryByTestId } = render(<CarRentalsPanel {...baseProps} />);
    expect(getByText('Car Rentals')).toBeTruthy();
    // No rows yet.
    expect(queryByTestId('car-rental-delete-car-1')).toBeNull();
    // Add opens a separate editor dialog.
    expect(queryByTestId('car-rental-add')).toBeTruthy();
    expect(queryByTestId('car-rental-editor-dialog')).toBeNull();
  });

  it('renders one row per car rental with a route label + vendor/model/reference sub-line', () => {
    const rental = makeCarRental();
    const { getByText, getByTestId } = render(
      <CarRentalsPanel {...baseProps} carRentals={[rental]} />,
    );
    const tableScroll = getByTestId('car-rentals-table-scroll');
    expect(tableScroll.props.horizontal).toBe(true);
    expect(tableScroll.props.nestedScrollEnabled).toBe(true);
    expect(tableScroll.props.showsHorizontalScrollIndicator).toBe(true);
    expect(tableScroll.props.directionalLockEnabled).toBe(true);
    expect(getByText('LAX → SFO')).toBeTruthy();
    expect(getByText('Hertz • Prius • REF-123')).toBeTruthy();
    expect(getByTestId('car-rental-edit-car-1')).toBeTruthy();
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

  it('opens a separate add dialog and fires onAddCarRental when saved', () => {
    const { getByTestId, getByText } = render(<CarRentalsPanel {...baseProps} />);
    fireEvent.press(getByTestId('car-rental-add'));
    expect(getByTestId('car-rental-editor-dialog')).toBeTruthy();
    expect(getByText('Add Car Rental')).toBeTruthy();
    fireEvent.press(getByTestId('car-rental-save'));
    expect(baseProps.onAddCarRental).toHaveBeenCalledTimes(1);
  });

  it('opens a separate edit dialog and fires onUpdateCarRental when saved', () => {
    const rental = makeCarRental();
    const { getByTestId, getByText } = render(
      <CarRentalsPanel {...baseProps} carRentals={[rental]} />,
    );
    fireEvent.press(getByTestId('car-rental-edit-car-1'));
    expect(getByTestId('car-rental-editor-dialog')).toBeTruthy();
    expect(getByText('Edit Car Rental')).toBeTruthy();
    fireEvent.press(getByTestId('car-rental-save'));
    expect(baseProps.onUpdateCarRental).toHaveBeenCalledWith('car-1');
  });

  it('hides the Add form and replaces Delete buttons with "View only" when isFollowingMode is true', () => {
    const rental = makeCarRental();
    const { getByText, queryByTestId } = render(
      <CarRentalsPanel {...baseProps} carRentals={[rental]} isFollowingMode />,
    );
    expect(queryByTestId('car-rental-add')).toBeNull();
    expect(queryByTestId('car-rental-edit-car-1')).toBeNull();
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
