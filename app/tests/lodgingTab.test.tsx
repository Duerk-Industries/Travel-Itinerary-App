import React from 'react';
import { render, fireEvent, within } from '@testing-library/react-native';
import LodgingTab, { formatShortDate } from '../tabs/LodgingTab';
import type { Lodging } from '../tabs/lodging';

const styles = {
    card: {},
    row: {},
    sectionTitle: {},
    button: {},
    roundButton: {},
    buttonText: {},
    table: {},
    tableHeader: {},
    tableHeaderCell: {},
    tableRow: {},
    tableCell: {},
    modalOverlay: {},
    modalCard: {},
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
    dangerButton: {},
    linkText: {},
    cellText: {},
    detailRow: {},
    detailLabel: {},
    detailValue: {},
};

const mockLodgings: Lodging[] = [
    { id: 'l1', userId: 'u1', tripId: 't1', name: 'Hotel 1', checkInDate: '2025-01-01', checkOutDate: '2025-01-05', rooms: '1', refundBy: '', totalCost: '400', costPerNight: '100', address: '123 Main St', paidBy: ['m1'], travelerIds: ['m1'] },
    { id: 'l2', userId: 'u1', tripId: 't1', name: 'Hotel 2', checkInDate: '2025-01-05', checkOutDate: '2025-01-10', rooms: '2', refundBy: '', totalCost: '1000', costPerNight: '100', address: '456 Oak Ave', paidBy: ['m2'], travelerIds: ['m1', 'm2'] },
];

const groupMembers = [
    { id: 'm1', firstName: 'John', lastName: 'Doe', email: 'john@doe.com', status: 'active' as const },
    { id: 'm2', firstName: 'Jane', lastName: 'Doe', email: 'jane@doe.com', status: 'active' as const },
];

const formatMemberName = (member: any) => `${member.firstName} ${member.lastName}`;
const payerName = (id: string) => groupMembers.find(m => m.id === id)?.firstName ?? 'Unknown';

describe('LodgingTab', () => {
    const trip = { id: 't1', startDate: '2025-01-01' };

    it('renders the lodging table correctly', () => {
        const { getByTestId } = render(
            <LodgingTab
                backendUrl=""
                jsonHeaders={{}}
                trip={trip}
                lodgings={mockLodgings}
                groupMembers={groupMembers}
                defaultPayerId="m1"
                styles={styles}
                onRefreshLodgings={() => { }}
                onOpenMap={() => { }}
                formatMemberName={formatMemberName}
                payerName={payerName}
            />
        );

        const row1 = getByTestId('lodging-row-l1');
        expect(within(row1).getByText('Hotel 1')).toBeTruthy();
        expect(within(row1).getByText(formatShortDate('2025-01-01'))).toBeTruthy();
        expect(within(row1).getByText(formatShortDate('2025-01-05'))).toBeTruthy();

        const row2 = getByTestId('lodging-row-l2');
        expect(within(row2).getByText('Hotel 2')).toBeTruthy();
        expect(within(row2).getByText(formatShortDate('2025-01-05'))).toBeTruthy();
        expect(within(row2).getByText(formatShortDate('2025-01-10'))).toBeTruthy();
    });

    it('opens the add dialog when add button is clicked', () => {
        const { getByText, getByTestId } = render(
            <LodgingTab
                backendUrl=""
                jsonHeaders={{}}
                trip={trip}
                lodgings={mockLodgings}
                groupMembers={groupMembers}
                defaultPayerId="m1"
                styles={styles}
                onRefreshLodgings={() => { }}
                onOpenMap={() => { }}
                formatMemberName={formatMemberName}
                payerName={payerName}
            />
        );

        fireEvent.press(getByText('+'));
        const dialog = getByTestId('lodging-editor-dialog');
        expect(within(dialog).getByText('Add Accommodation')).toBeTruthy();
    });

    it('opens the details dialog when a lodging is clicked', () => {
        const { getByTestId } = render(
            <LodgingTab
                backendUrl=""
                jsonHeaders={{}}
                trip={trip}
                lodgings={mockLodgings}
                groupMembers={groupMembers}
                defaultPayerId="m1"
                styles={styles}
                onRefreshLodgings={() => { }}
                onOpenMap={() => { }}
                formatMemberName={formatMemberName}
                payerName={payerName}
            />
        );

        fireEvent.press(within(getByTestId('lodging-row-l1')).getByText('Hotel 1'));
        const dialog = getByTestId('lodging-details-dialog');
        expect(within(dialog).getByText('Hotel 1')).toBeTruthy();
        expect(within(dialog).getByText('Edit')).toBeTruthy();
        expect(within(dialog).getByText('Delete')).toBeTruthy();
    });

    it('opens the edit dialog from the details dialog', () => {
        const { getByTestId, queryByTestId } = render(
            <LodgingTab
                backendUrl=""
                jsonHeaders={{}}
                trip={trip}
                lodgings={mockLodgings}
                groupMembers={groupMembers}
                defaultPayerId="m1"
                styles={styles}
                onRefreshLodgings={() => { }}
                onOpenMap={() => { }}
                formatMemberName={formatMemberName}
                payerName={payerName}
            />
        );

        fireEvent.press(within(getByTestId('lodging-row-l1')).getByText('Hotel 1'));
        const detailsDialog = getByTestId('lodging-details-dialog');
        fireEvent.press(within(detailsDialog).getByText('Edit'));

        expect(queryByTestId('lodging-details-dialog')).toBeNull();
        const editDialog = getByTestId('lodging-editor-dialog');
        expect(within(editDialog).getByText('Edit Accommodation')).toBeTruthy();
    });

    it('shows delete confirmation when delete is clicked', () => {
        const { getByTestId } = render(
            <LodgingTab
                backendUrl=""
                jsonHeaders={{}}
                trip={trip}
                lodgings={mockLodgings}
                groupMembers={groupMembers}
                defaultPayerId="m1"
                styles={styles}
                onRefreshLodgings={() => { }}
                onOpenMap={() => { }}
                formatMemberName={formatMemberName}
                payerName={payerName}
            />
        );

        fireEvent.press(within(getByTestId('lodging-row-l1')).getByText('Hotel 1'));
        const detailsDialog = getByTestId('lodging-details-dialog');
        fireEvent.press(within(detailsDialog).getByText('Delete'));
        const deleteDialog = getByTestId('delete-lodging-dialog');
        expect(within(deleteDialog).getByText('Are you sure you want to delete Hotel 1?')).toBeTruthy();
    });
});
