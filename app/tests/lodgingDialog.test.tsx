/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent, within } from '@testing-library/react-native';
import LodgingDialog from '../components/LodgingDialog';
import LodgingDetailsDialog from '../components/LodgingDetailsDialog';
import { createInitialLodgingState, type Lodging } from '../tabs/lodging';

const styles = {
  modalOverlay: {},
  modalCard: {},
  sectionTitle: {},
  input: {},
  modalRow: {},
  modalField: {},
  modalLabel: {},
  helperText: {},
  payerBox: {},
  payerChips: {},
  payerChip: {},
  removeText: {},
  payerOptions: {},
  smallButton: {},
  buttonText: {},
  row: {},
  button: {},
  dangerButton: {},
  dangerButtonText: {},
  linkText: {},
  cellText: {},
  detailRow: {},
  detailHeaderRow: {},
  detailImage: {},
  detailImageFallback: {},
  mapPreview: {},
  detailMap: {},
  detailActionsRow: {},
  detailLabel: {},
  detailValue: {},
};

describe('Lodging Dialogs', () => {
  const mockLodging: Lodging = {
    id: 'l1',
    userId: 'u1',
    tripId: 't1',
    status: 'Booked',
    name: 'Test Hotel',
    checkInDate: '2025-04-10',
    checkOutDate: '2025-04-12',
    rooms: '1',
    refundBy: '2025-04-01',
    totalCost: '200',
    costPerNight: '100',
    address: '123 Main St',
    paidBy: ['m1'],
    travelerIds: ['m1'],
  };

  const groupMembers = [
    { id: 'm1', firstName: 'John', lastName: 'Doe', email: 'john@doe.com', status: 'active' as const },
    { id: 'm2', firstName: 'Jane', lastName: 'Doe', email: 'jane@doe.com', status: 'active' as const },
  ];

  const formatMemberName = (member: any) => `${member.firstName} ${member.lastName}`;
  const payerName = (id: string) => groupMembers.find(m => m.id === id)?.firstName ?? 'Unknown';

  test('LodgingDialog renders correctly in add mode', () => {
    const { getByText, getByPlaceholderText } = render(
      <LodgingDialog
        visible
        title="Add Lodging"
        draft={createInitialLodgingState()}
        setDraft={() => {}}
        groupMembers={groupMembers}
        formatMemberName={formatMemberName}
        payerName={payerName}
        styles={styles}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );

    expect(getByText('Add Lodging')).toBeTruthy();
    expect(getByPlaceholderText('Hotel name')).toBeTruthy();
  });

  test('LodgingDialog renders correctly in edit mode', () => {
    const { getByText, getByDisplayValue } = render(
      <LodgingDialog
        visible
        title="Edit Lodging"
        draft={mockLodging}
        setDraft={() => {}}
        groupMembers={groupMembers}
        formatMemberName={formatMemberName}
        payerName={payerName}
        styles={styles}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );

    expect(getByText('Edit Lodging')).toBeTruthy();
    expect(getByDisplayValue('Test Hotel')).toBeTruthy();
  });

  test('renders title and toggle buttons for travelers and payers', () => {
    const { getByText, getAllByText } = render(
      <LodgingDialog
        visible
        title="Lodging Details"
        draft={createInitialLodgingState({ paidBy: ['m1'], travelerIds: ['m2'] })}
        setDraft={() => {}}
        groupMembers={groupMembers}
        formatMemberName={formatMemberName}
        payerName={payerName}
        styles={styles}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );

    expect(getByText('Lodging Details')).toBeTruthy();
    expect(getAllByText('John Doe').length).toBeGreaterThan(0);
    expect(getAllByText('Jane Doe').length).toBeGreaterThan(0);
    expect(getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });

  test('LodgingDialog calls onSave with the correct data', () => {
    const onSave = jest.fn();
    const draft = createInitialLodgingState();
    const setDraft = jest.fn((update) => {
        const newDraft = { ...draft, ... (typeof update === 'function' ? update(draft) : update) };
        draft.name = newDraft.name;
    });

    const { getByText, getByPlaceholderText } = render(
      <LodgingDialog
        visible
        title="Add Lodging"
        draft={draft}
        setDraft={setDraft}
        groupMembers={groupMembers}
        formatMemberName={formatMemberName}
        payerName={payerName}
        styles={styles}
        onSave={() => onSave(draft)}
        onCancel={() => {}}
      />
    );

    fireEvent.changeText(getByPlaceholderText('Hotel name'), 'New Hotel');
    fireEvent.press(getByText('Save'));

    expect(onSave).toHaveBeenCalledWith({ ...draft, name: 'New Hotel' });
  });

  test('LodgingDetailsDialog renders correctly', () => {
    const { getByText, getAllByText } = render(
      <LodgingDetailsDialog
        visible
        lodging={mockLodging}
        attendees={[]}
        backendUrl="http://example.com"
        requestHeaders={{}}
        styles={styles}
        payerName={payerName}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onOpenMap={() => {}}
      />
    );

    expect(getByText('Test Hotel')).toBeTruthy();
    expect(getAllByText('123 Main St').length).toBeGreaterThan(0);
    expect(getByText('$200')).toBeTruthy();
  });

  test('LodgingDetailsDialog calls onEdit when edit button is pressed', () => {
    const onEdit = jest.fn();
    const { getByText } = render(
      <LodgingDetailsDialog
        visible
        lodging={mockLodging}
        attendees={[]}
        backendUrl="http://example.com"
        requestHeaders={{}}
        styles={styles}
        payerName={payerName}
        onClose={() => {}}
        onEdit={onEdit}
        onDelete={() => {}}
        onOpenMap={() => {}}
      />
    );

    fireEvent.press(getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(mockLodging);
  });

  test('LodgingDetailsDialog calls onDelete when delete is pressed', () => {
    const onDelete = jest.fn();
    const { getByText } = render(
      <LodgingDetailsDialog
        visible
        lodging={mockLodging}
        attendees={[]}
        backendUrl="http://example.com"
        requestHeaders={{}}
        styles={styles}
        payerName={payerName}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={onDelete}
        onOpenMap={() => {}}
      />
    );

    fireEvent.press(getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith(mockLodging);
  });

  test('LodgingDetailsDialog calls onOpenMap when map is pressed', () => {
    const onOpenMap = jest.fn();
    const { getAllByText } = render(
      <LodgingDetailsDialog
        visible
        lodging={mockLodging}
        attendees={[]}
        backendUrl="http://example.com"
        requestHeaders={{}}
        styles={styles}
        payerName={payerName}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onOpenMap={onOpenMap}
      />
    );
    const addressLinks = getAllByText('123 Main St');
    fireEvent.press(addressLinks[addressLinks.length - 1]);
    expect(onOpenMap).toHaveBeenCalledWith('123 Main St');
  });

  test('LodgingDetailsDialog calls onClose when close is pressed', () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <LodgingDetailsDialog
        visible
        lodging={mockLodging}
        attendees={[]}
        backendUrl="http://example.com"
        requestHeaders={{}}
        styles={styles}
        payerName={payerName}
        onClose={onClose}
        onEdit={() => {}}
        onDelete={() => {}}
        onOpenMap={() => {}}
      />
    );
    fireEvent.press(getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
