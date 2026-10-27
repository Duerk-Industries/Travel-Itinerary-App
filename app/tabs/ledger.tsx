import { resolveComponentTheme as resolveStyleTheme, themeStyle, getAppTheme as getStyleTheme, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View, TouchableOpacity, useWindowDimensions } from 'react-native';
import HorizontalTableScroll from '../components/HorizontalTableScroll';
import ExpenseCovering from './ExpenseCovering';
import PaymentDialog from '../components/PaymentDialog';
import ConfirmDialog from '../components/ConfirmDialog';

import { fixedTableColumn } from '../utils/tableColumns';
import {
  buildSettlementMatrix,
  formatCents,
  fromCents,
  toCents,
  rollUpPayments,
  type PaymentRecord,
} from '../utils/settlement';

type Trip = {
  id: string;
  currency?: string | null;
  name?: string | null;
};

type GroupMemberOption = {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
};

type TripPayment = {
  id: string;
  tripId: string;
  payerId: string;
  receiverId: string;
  paymentDate: string;
  amountCents: number;
  currency?: string;
  notes?: string | null;
  createdAt?: string;
};

type LedgerTabProps = {
  trip: Trip | null;
  groupMembers: GroupMemberOption[];
  reportableMembers: GroupMemberOption[];
  paidTotals: Record<string, number>;
  usedTotals: Record<string, number>;
  styles: Record<string, any>;
  theme?: AppTheme;
  downloadCsv: (content: string, fileName: string) => void;
  findActiveTrip: () => Trip | undefined;
  onNavigate: (page: 'cost') => void;
  coveredBy: Record<string, string>;
  setCoveredBy: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  formatMemberName: (member: GroupMemberOption) => string;
  payerName: (id: string) => string;
  saveCoveredBy: () => Promise<void>;
  readOnly?: boolean;
  // Costs that came in from bookings (flights, lodgings, activities, car rentals).
  payments: TripPayment[];
  currentUserMemberId: string | null;
  onAddPayment: (draft: {
    payerId: string;
    receiverId: string;
    paymentDate: string;
    amountCents: number;
  }) => Promise<void>;
  onDeletePayment: (paymentId: string) => Promise<void>;
};

type LedgerRenderParams = {
  memberIds: string[];
  memberNameMap: Map<string, string>;
  paidTotals: Record<string, number>;
  usedTotals: Record<string, number>;
  overallPaid: number;
  overallUsed: number;
  overallTotal: number;
  formatMoney: (value: number) => string;
  styles: Record<string, any>;
};

const renderLedgerTable = ({
  memberIds,
  memberNameMap,
  paidTotals,
  usedTotals,
  overallPaid,
  overallUsed,
  overallTotal,
  formatMoney,
  styles,
}: LedgerRenderParams) => (
  <HorizontalTableScroll
    style={styles.tableScroll}
    contentContainerStyle={styles.tableScrollContent}
  >
    <View style={styles.table} testID="ledger-table">
      <View style={[styles.tableRow, styles.tableHeader]}>
        {['Person', 'Paid', 'Used', 'Total'].map((header, idx, arr) => (
          <View
            key={header}
            style={[
              styles.cell,
              fixedTableColumn(idx === 0 ? 160 : 140),
              idx === arr.length - 1 && styles.lastCell,
            ]}
          >
            <Text style={styles.headerText}>{header}</Text>
          </View>
        ))}
      </View>
      {memberIds.map((memberId, idx) => (
        <View
          key={memberId}
          style={[styles.tableRow, idx === memberIds.length - 1 && styles.lastRow]}
          testID={`ledger-row-${memberId}`}
        >
          <View style={[styles.cell, fixedTableColumn(160)]}>
            <Text style={styles.cellText}>{memberNameMap.get(memberId) ?? 'Traveler'}</Text>
          </View>
          <View style={[styles.cell, fixedTableColumn(140)]}>
            <Text style={styles.cellText}>{formatMoney(paidTotals[memberId] ?? 0)}</Text>
          </View>
          <View style={[styles.cell, fixedTableColumn(140)]}>
            <Text style={styles.cellText}>{formatMoney(usedTotals[memberId] ?? 0)}</Text>
          </View>
          <View style={[styles.cell, styles.lastCell, fixedTableColumn(140)]}>
            <Text style={styles.cellText}>-</Text>
          </View>
        </View>
      ))}
      {memberIds.length ? (
        <View style={[styles.tableRow, styles.tableHeader]} testID="ledger-overall-row">
          <View style={[styles.cell, fixedTableColumn(160)]}>
            <Text style={styles.headerText}>Overall</Text>
          </View>
          <View style={[styles.cell, fixedTableColumn(140)]}>
            <Text style={styles.headerText}>{formatMoney(overallPaid)}</Text>
          </View>
          <View style={[styles.cell, fixedTableColumn(140)]}>
            <Text style={styles.headerText}>{formatMoney(overallUsed)}</Text>
          </View>
          <View style={[styles.cell, styles.lastCell, fixedTableColumn(140)]}>
            <Text style={styles.headerText}>{formatMoney(overallTotal)}</Text>
          </View>
        </View>
      ) : null}
      {!memberIds.length ? (
        <View style={[styles.tableRow, styles.lastRow]}>
          <View style={[styles.cell, styles.lastCell, fixedTableColumn(160)]}>
            <Text style={styles.helperText}>No travelers available.</Text>
          </View>
        </View>
      ) : null}
    </View>
  </HorizontalTableScroll>
);

const renderLedgerCards = ({
  memberIds,
  memberNameMap,
  paidTotals,
  usedTotals,
  overallPaid,
  overallUsed,
  overallTotal,
  formatMoney,
  styles,
}: LedgerRenderParams) => {
  if (!memberIds.length) {
    return (
      <View style={[styles.card, themeStyle('tabs_ledger_1', {  }, getStyleTheme('auto', null))]} testID="ledger-empty">
        <Text style={styles.helperText}>No travelers available.</Text>
      </View>
    );
  }
  return (
    <View testID="ledger-cards">
      {memberIds.map((memberId) => (
        <View
          key={memberId}
          style={[styles.card, themeStyle('tabs_ledger_2', {  }, getStyleTheme('auto', null))]}
          testID={`ledger-row-${memberId}`}
        >
          <View style={themeStyle('tabs_ledger_3', {  }, getStyleTheme('auto', null))}>
            <Text style={[styles.cellText, themeStyle('tabs_ledger_4', {  }, getStyleTheme('auto', null))]}>
              {memberNameMap.get(memberId) ?? 'Traveler'}
            </Text>
          </View>
          <View style={themeStyle('tabs_ledger_5', {  }, getStyleTheme('auto', null))}>
            <Text style={styles.cellText}>
              <Text style={themeStyle('tabs_ledger_6', {  }, getStyleTheme('auto', null))}>Paid: </Text>
              {formatMoney(paidTotals[memberId] ?? 0)}
            </Text>
            <Text style={styles.cellText}>
              <Text style={themeStyle('tabs_ledger_7', {  }, getStyleTheme('auto', null))}>Used: </Text>
              {formatMoney(usedTotals[memberId] ?? 0)}
            </Text>
          </View>
        </View>
      ))}
      <View style={[styles.card, styles.tableHeader, themeStyle('tabs_ledger_8', {  }, getStyleTheme('auto', null))]} testID="ledger-overall-row">
        <View style={themeStyle('tabs_ledger_9', {  }, getStyleTheme('auto', null))}>
          <Text style={[styles.headerText, themeStyle('tabs_ledger_10', {  }, getStyleTheme('auto', null))]}>Overall</Text>
        </View>
        <View style={themeStyle('tabs_ledger_11', {  }, getStyleTheme('auto', null))}>
          <Text style={styles.headerText}>
            <Text style={themeStyle('tabs_ledger_12', {  }, getStyleTheme('auto', null))}>Paid: </Text>
            {formatMoney(overallPaid)}
          </Text>
          <Text style={styles.headerText}>
            <Text style={themeStyle('tabs_ledger_13', {  }, getStyleTheme('auto', null))}>Used: </Text>
            {formatMoney(overallUsed)}
          </Text>
          <Text style={styles.headerText}>
            <Text style={themeStyle('tabs_ledger_14', {  }, getStyleTheme('auto', null))}>Total: </Text>
            {formatMoney(overallTotal)}
          </Text>
        </View>
      </View>
    </View>
  );
};

// "2026-11-02" → "Nov 2" for the compact phone payment rows. Parsed as a local date so it
// doesn't roll back a day west of UTC.
const formatShortPaymentDate = (value: string): string => {
  const [y, m, d] = String(value ?? '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const LedgerTab: React.FC<LedgerTabProps> = ({
  trip,
  groupMembers,
  reportableMembers,
  paidTotals,
  usedTotals,
  styles,
  theme: _providedTheme,
  downloadCsv,
  findActiveTrip,
  onNavigate,
  coveredBy,
  setCoveredBy,
  formatMemberName,
  payerName,
  saveCoveredBy,
  readOnly,
  payments,
  currentUserMemberId,
  onAddPayment,
  onDeletePayment,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const { width: viewportWidth } = useWindowDimensions();
  const isNarrowLayout = viewportWidth < 700;
  const tripCurrency = (trip?.currency ?? 'USD').toUpperCase();

  const activeMembers = useMemo(
    () => reportableMembers.filter((m) => m.status !== 'removed'),
    [reportableMembers]
  );

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    groupMembers.forEach((m) => {
      map.set(m.id, formatMemberName(m));
    });
    return map;
  }, [groupMembers, formatMemberName]);

  const memberIds = useMemo(() => activeMembers.map((m) => m.id), [activeMembers]);

  const roundMoney = (value: number): number => Math.round(value * 100) / 100;
  const overallPaid = roundMoney(memberIds.reduce((sum, id) => sum + (paidTotals[id] ?? 0), 0));
  const overallUsed = roundMoney(memberIds.reduce((sum, id) => sum + (usedTotals[id] ?? 0), 0));
  const overallTotal = roundMoney(overallPaid);

  const formatMoney = (value: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: tripCurrency }).format(value);

  const paidTotalsCents = useMemo(() => {
    const out: Record<string, number> = {};
    Object.entries(paidTotals).forEach(([id, v]) => {
      out[id] = toCents(v);
    });
    return out;
  }, [paidTotals]);

  const usedTotalsCents = useMemo(() => {
    const out: Record<string, number> = {};
    Object.entries(usedTotals).forEach(([id, v]) => {
      out[id] = toCents(v);
    });
    return out;
  }, [usedTotals]);

  const paymentRecords: PaymentRecord[] = useMemo(
    () =>
      payments.map((p) => ({
        payerId: p.payerId,
        receiverId: p.receiverId,
        amountCents: Math.round(Number(p.amountCents) || 0),
      })),
    [payments]
  );

  const matrix = useMemo(
    () =>
      buildSettlementMatrix({
        participants: activeMembers,
        paidTotalsCents,
        usedTotalsCents,
        payments: paymentRecords,
        coveredBy,
      }),
    [activeMembers, paidTotalsCents, usedTotalsCents, paymentRecords, coveredBy]
  );

  const balanceCheckDelta = fromCents(
    Object.values(matrix.rowTotalsCents).reduce((s, v) => s + v, 0) -
      Object.values(matrix.columnTotalsCents).reduce((s, v) => s + v, 0)
  );
  const balanceCheckOk = Math.abs(balanceCheckDelta) <= 0.01;

  const sortedParticipants = useMemo(() => {
    const byId = new Map(activeMembers.map((m) => [m.id, m] as const));
    return matrix.sortedIds
      .map((id) => byId.get(id))
      .filter((m): m is GroupMemberOption => Boolean(m));
  }, [activeMembers, matrix.sortedIds]);

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleSavePayment = async (draft: {
    payerId: string;
    receiverId: string;
    paymentDate: string;
    amount: number;
  }) => {
    await onAddPayment({
      payerId: draft.payerId,
      receiverId: draft.receiverId,
      paymentDate: draft.paymentDate,
      amountCents: toCents(draft.amount),
    });
    setPaymentDialogOpen(false);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await onDeletePayment(pendingDeleteId);
    } finally {
      setPendingDeleteId(null);
    }
  };

  const convertLedgerToCsv = (): string => {
    const escapeCsvCell = (cell: string) => {
      if (/[",\n]/.test(cell)) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    };

    const header = ['Person', 'Paid', 'Used', 'Paid to Other Travelers', 'Received from Other Travelers', 'Owed'].map(escapeCsvCell);
    const paidToOthers: Record<string, number> = {};
    const receivedFromOthers: Record<string, number> = {};
    for (const payment of rollUpPayments(paymentRecords, coveredBy)) {
      paidToOthers[payment.payerId] = (paidToOthers[payment.payerId] ?? 0) + payment.amountCents;
      receivedFromOthers[payment.receiverId] = (receivedFromOthers[payment.receiverId] ?? 0) + payment.amountCents;
    }
    const totals = [0, 0, 0, 0, 0];
    const decimal = (cents: number) => fromCents(cents).toFixed(2);

    const rows = memberIds.map((memberId) => {
      const person = memberNameMap.get(memberId) ?? 'Traveler';
      const paid = paidTotalsCents[memberId] ?? 0;
      const used = usedTotalsCents[memberId] ?? 0;
      const sent = paidToOthers[memberId] ?? 0;
      const received = receivedFromOthers[memberId] ?? 0;
      const values = [paid, used, sent, received, paid + sent - used - received];
      values.forEach((value, index) => { totals[index] += value; });
      return [person, ...values.map(decimal)].map(escapeCsvCell);
    });

    const overallRow = ['Overall', ...totals.map(decimal)].map(escapeCsvCell);

    return [header, ...rows, overallRow].map((row) => row.join(',')).join('\n');
  };

  const handleExportCsv = () => {
    const activeTrip = findActiveTrip?.();
    const csv = convertLedgerToCsv();
    const fileName = `ledger-${activeTrip?.name?.replace(/\s/g, '_') ?? 'export'}.csv`;
    downloadCsv?.(csv, fileName);
  };

  if (!trip) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Balances</Text>
        <Text style={styles.helperText}>Select a trip to view balances.</Text>
      </View>
    );
  }

  const greyCellBg = (styles.tableHeader?.backgroundColor as string) ?? themeStyle('tabs_ledger_34', {  }, (theme ?? _styleTheme));
  const greyCellStyle = themeStyle('tabs_ledger_15', { greyCellBg: greyCellBg }, (theme ?? _styleTheme));

  const renderMatrixCell = (fromId: string, toId: string, isDiagonal: boolean) => {
    const cents = matrix.matrixCents[fromId]?.[toId] ?? 0;
    const isZero = cents === 0;
    const label = isZero ? '' : formatCents(cents, tripCurrency);
    return (
      <View
        key={`${fromId}-${toId}`}
        style={[styles.cell, fixedTableColumn(120), isDiagonal && greyCellStyle]}
        testID={`settlement-cell-${fromId}-${toId}`}
      >
        <Text style={styles.cellText}>{label}</Text>
      </View>
    );
  };

  const renderSettlementMatrix = () => {
    if (!sortedParticipants.length) {
      return <Text style={styles.helperText}>No travelers available.</Text>;
    }

    return (
      <HorizontalTableScroll
        style={styles.tableScroll}
        contentContainerStyle={styles.tableScrollContent}
      >
        <View style={styles.table} testID="settlement-matrix">
          <View style={[styles.tableRow, styles.tableHeader]}>
            <View style={[styles.cell, fixedTableColumn(160)]}>
              <Text style={styles.headerText}>Owes ↓ / To →</Text>
            </View>
            {sortedParticipants.map((p) => (
              <View key={`header-col-${p.id}`} style={[styles.cell, fixedTableColumn(120)]}>
                <Text style={styles.headerText}>{memberNameMap.get(p.id) ?? 'Traveler'}</Text>
              </View>
            ))}
            <View style={[styles.cell, styles.lastCell, fixedTableColumn(120)]}>
              <Text style={styles.headerText}>Totals</Text>
            </View>
          </View>

          {sortedParticipants.map((rowMember) => {
            const rowTotalCents = matrix.rowTotalsCents[rowMember.id] ?? 0;
            return (
              <View
                key={`settle-row-${rowMember.id}`}
                style={styles.tableRow}
                testID={`settlement-row-${rowMember.id}`}
              >
                <View style={[styles.cell, fixedTableColumn(160)]}>
                  <Text style={styles.cellText}>{memberNameMap.get(rowMember.id) ?? 'Traveler'}</Text>
                </View>
                {sortedParticipants.map((colMember) =>
                  renderMatrixCell(rowMember.id, colMember.id, rowMember.id === colMember.id)
                )}
                <View style={[styles.cell, styles.lastCell, fixedTableColumn(120)]}>
                  <Text style={styles.cellText}>
                    {rowTotalCents === 0 ? '' : formatCents(rowTotalCents, tripCurrency)}
                  </Text>
                </View>
              </View>
            );
          })}

          <View style={[styles.tableRow, styles.tableHeader, styles.lastRow]} testID="settlement-totals-row">
            <View style={[styles.cell, fixedTableColumn(160)]}>
              <Text style={styles.headerText}>Totals</Text>
            </View>
            {sortedParticipants.map((colMember) => {
              const colCents = matrix.columnTotalsCents[colMember.id] ?? 0;
              return (
                <View key={`total-col-${colMember.id}`} style={[styles.cell, fixedTableColumn(120)]}>
                  <Text style={styles.headerText}>
                    {colCents === 0 ? '' : formatCents(colCents, tripCurrency)}
                  </Text>
                </View>
              );
            })}
            <View
              style={[styles.cell, styles.lastCell, fixedTableColumn(120), greyCellStyle]}
              testID="settlement-grand-total"
            >
              <Text style={styles.headerText}></Text>
            </View>
          </View>
        </View>
      </HorizontalTableScroll>
    );
  };

  // Phone layout: the matrix is ~760px wide, so narrow screens get one card per transfer
  // ("Sam pays Maya $442.78") read straight from the same minimal-transfer matrix.
  const renderSettlementList = () => {
    if (!sortedParticipants.length) {
      return <Text style={styles.helperText}>No travelers available.</Text>;
    }
    const transfers = sortedParticipants.flatMap((from) =>
      sortedParticipants
        .filter((to) => to.id !== from.id && (matrix.matrixCents[from.id]?.[to.id] ?? 0) > 0)
        .map((to) => ({ fromId: from.id, toId: to.id, cents: matrix.matrixCents[from.id][to.id] }))
    );
    if (!transfers.length) {
      return <Text style={styles.helperText} testID="settlement-settled">Everyone is settled up.</Text>;
    }
    return (
      <View testID="settlement-list">
        {transfers.map(({ fromId, toId, cents }) => (
          <View
            key={`settle-${fromId}-${toId}`}
            style={[styles.card, themeStyle('tabs_ledger_16', {  }, (theme ?? _styleTheme))]}
            testID={`settlement-transfer-${fromId}-${toId}`}
          >
            <Text style={[styles.cellText, themeStyle('tabs_ledger_17', {  }, (theme ?? _styleTheme))]}>
              <Text style={themeStyle('tabs_ledger_18', {  }, (theme ?? _styleTheme))}>{memberNameMap.get(fromId) ?? 'Traveler'}</Text>
              {' pays '}
              <Text style={themeStyle('tabs_ledger_19', {  }, (theme ?? _styleTheme))}>{memberNameMap.get(toId) ?? 'Traveler'}</Text>
            </Text>
            <Text style={[styles.cellText, themeStyle('tabs_ledger_20', {  }, (theme ?? _styleTheme))]}>{formatCents(cents, tripCurrency)}</Text>
          </View>
        ))}
      </View>
    );
  };

  const eligiblePaymentParticipants = useMemo(
    () => activeMembers.filter((m) => !coveredBy[m.id]),
    [activeMembers, coveredBy]
  );
  const eligibleSortedIds = matrix.sortedIds;

  const renderPaymentsList = () => {
    if (!payments.length) {
      return <Text style={styles.helperText}>No payments recorded yet.</Text>;
    }
    return (
      <View style={themeStyle('tabs_ledger_21', {  }, (theme ?? _styleTheme))}>
        {payments.map((payment) => {
          const label = `${memberNameMap.get(payment.payerId) ?? 'Someone'} paid ${
            memberNameMap.get(payment.receiverId) ?? 'someone'
          } ${formatCents(payment.amountCents, tripCurrency)}`;
          const paymentDescription = `${memberNameMap.get(payment.payerId) ?? 'Someone'} paid ${memberNameMap.get(payment.receiverId) ?? 'someone'}`;
          const paymentAmount = formatCents(payment.amountCents, tripCurrency);
          return (
            <View
              key={`payment-${payment.id}`}
              style={[
                styles.row,
                themeStyle('tabs_ledger_22', { isNarrowLayout: isNarrowLayout }, (theme ?? _styleTheme)),
              ]}
              testID={`payment-row-${payment.id}`}
            >
              {isNarrowLayout ? (
                <View style={themeStyle('tabs_ledger_23', {  }, (theme ?? _styleTheme))}>
                  <Text style={[styles.cellText, themeStyle('tabs_ledger_24', {  }, (theme ?? _styleTheme))]}>
                    {formatShortPaymentDate(payment.paymentDate)} · {paymentDescription}
                  </Text>
                  <Text style={[styles.cellText, themeStyle('tabs_ledger_25', {  }, (theme ?? _styleTheme))]}>{paymentAmount}</Text>
                </View>
              ) : (
                <Text style={[styles.cellText, themeStyle('tabs_ledger_26', {  }, (theme ?? _styleTheme))]}>
                  {payment.paymentDate} — {label}
                </Text>
              )}
              {!readOnly ? (
                <TouchableOpacity
                  style={[styles.button, styles.smallButton, styles.dangerButton, isNarrowLayout && themeStyle('tabs_ledger_27', {  }, (theme ?? _styleTheme))]}
                  onPress={() => setPendingDeleteId(payment.id)}
                  testID={`payment-delete-${payment.id}`}
                >
                  <Text style={styles.dangerButtonText}>Delete</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <View style={themeStyle('tabs_ledger_28', {  }, (theme ?? _styleTheme))}>
      <View style={styles.card} testID="ledger-summary">
        <View style={styles.row}>
          <Text style={styles.sectionTitle}>Balances</Text>
          <TouchableOpacity
            style={[styles.button, styles.smallButton, themeStyle('tabs_ledger_29', {  }, (theme ?? _styleTheme))]}
            onPress={() => onNavigate('cost')}
          >
            <Text style={styles.buttonText}>Cost Report</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.smallButton, themeStyle('tabs_ledger_30', {  }, (theme ?? _styleTheme))]}
            onPress={handleExportCsv}
          >
            <Text style={styles.buttonText}>Export Details</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.helperText}>Paid vs. used costs across all trip expenses.</Text>
        {isNarrowLayout
          ? renderLedgerCards({
              memberIds,
              memberNameMap,
              paidTotals,
              usedTotals,
              overallPaid,
              overallUsed,
              overallTotal,
              formatMoney,
              styles,
            })
          : renderLedgerTable({
              memberIds,
              memberNameMap,
              paidTotals,
              usedTotals,
              overallPaid,
              overallUsed,
              overallTotal,
              formatMoney,
              styles,
            })}
      </View>

      <View
        style={[styles.card, themeStyle('settlementPanel', {}, (theme ?? _styleTheme))]}
        testID="ledger-settlement"
      >
        <Text style={styles.sectionTitle}>Settlement</Text>
        <Text style={styles.helperText}>
          {isNarrowLayout
            ? 'Who pays whom to settle up, after accounting for recorded payments.'
            : 'Each row shows what that traveler owes to every column traveler, after accounting for recorded payments.'}
        </Text>
        {isNarrowLayout ? renderSettlementList() : renderSettlementMatrix()}
        {!balanceCheckOk ? (
          <Text style={styles.warningText ?? themeStyle('tabs_ledger_32', {  }, (theme ?? _styleTheme))}>
            Warning: row total sum minus column total sum is {balanceCheckDelta.toFixed(2)} (expected within $0.01).
          </Text>
        ) : null}
      </View>

      <View style={styles.card} testID="ledger-payments">
        <View style={styles.row}>
          <Text style={styles.sectionTitle}>Payments</Text>
          {!readOnly ? (
            <TouchableOpacity
              style={[styles.button, styles.smallButton, themeStyle('tabs_ledger_33', {  }, (theme ?? _styleTheme))]}
              onPress={() => setPaymentDialogOpen(true)}
              testID="record-payment-button"
              disabled={eligibleSortedIds.length < 2}
            >
              <Text style={styles.buttonText}>+ Record Payment</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {renderPaymentsList()}
      </View>

      {!readOnly && (
        <ExpenseCovering
          groupMembers={groupMembers}
          reportableMembers={reportableMembers}
          coveredBy={coveredBy}
          setCoveredBy={setCoveredBy}
          formatMemberName={formatMemberName}
          payerName={payerName}
          saveCoveredBy={saveCoveredBy}
          styles={styles}
          theme={theme}
        />
      )}

      <PaymentDialog
        visible={paymentDialogOpen}
        participants={eligiblePaymentParticipants}
        sortedIds={eligibleSortedIds}
        participantLabel={(id) => memberNameMap.get(id) ?? 'Traveler'}
        defaultPayerId={currentUserMemberId && eligibleSortedIds.includes(currentUserMemberId) ? currentUserMemberId : null}
        styles={styles}
        theme={theme}
        onCancel={() => setPaymentDialogOpen(false)}
        onSave={handleSavePayment}
      />

      <ConfirmDialog
        visible={pendingDeleteId !== null}
        title="Delete payment?"
        message="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
        styles={styles}
        testID="payment-delete-confirm"
      />
    </View>
  );
};

export default LedgerTab;
