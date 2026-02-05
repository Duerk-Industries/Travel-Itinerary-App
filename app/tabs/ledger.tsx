import React, { useMemo } from 'react';
import { ScrollView, Text, View, TouchableOpacity } from 'react-native';
import ExpenseCovering from './ExpenseCovering';

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

type LedgerTabProps = {
  trip: Trip | null;
  groupMembers: GroupMemberOption[];
  reportableMembers: GroupMemberOption[];
  paidTotals: Record<string, number>;
  usedTotals: Record<string, number>;
  styles: Record<string, any>;
  downloadCsv: (content: string, fileName: string) => void;
  findActiveTrip: () => Trip | undefined;
  onNavigate: (page: 'cost') => void;
  coveredBy: Record<string, string>;
  setCoveredBy: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  formatMemberName: (member: GroupMemberOption) => string;
  payerName: (id: string) => string;
  saveCoveredBy: () => Promise<void>;
};

const LedgerTab: React.FC<LedgerTabProps> = ({
  trip,
  groupMembers,
  reportableMembers,
  paidTotals,
  usedTotals,
  styles,
  downloadCsv,
  findActiveTrip,
  onNavigate,
  coveredBy,
  setCoveredBy,
  formatMemberName,
  payerName,
  saveCoveredBy,
}) => {
  const tripCurrency = (trip?.currency ?? 'USD').toUpperCase();

  const activeMembers = useMemo(
    () => reportableMembers.filter((m) => m.status !== 'removed'),
    [reportableMembers]
  );

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    activeMembers.forEach((m) => {
      const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim();
      map.set(m.id, name || m.guestName || m.email || 'Traveler');
    });
    return map;
  }, [activeMembers]);

  const memberIds = useMemo(() => activeMembers.map((m) => m.id), [activeMembers]);

  const roundMoney = (value: number): number => Math.round(value * 100) / 100;
  const overallPaid = roundMoney(memberIds.reduce((sum, id) => sum + (paidTotals[id] ?? 0), 0));
  const overallUsed = roundMoney(memberIds.reduce((sum, id) => sum + (usedTotals[id] ?? 0), 0));
  const overallTotal = roundMoney(overallPaid);

  const formatMoney = (value: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: tripCurrency }).format(value);

  const convertLedgerToCsv = (): string => {
    const escapeCsvCell = (cell: string) => {
      if (/[",\n]/.test(cell)) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    };

    const header = ['Person', 'Paid', 'Used'].map(escapeCsvCell);

    const rows = memberIds.map(memberId => {
      const person = memberNameMap.get(memberId) ?? 'Traveler';
      const paid = paidTotals[memberId] ?? 0;
      const used = usedTotals[memberId] ?? 0;
      return [person, paid.toFixed(2), used.toFixed(2)].map(escapeCsvCell);
    });

    const overallRow = [
      'Overall',
      overallPaid.toFixed(2),
      overallUsed.toFixed(2)
    ].map(escapeCsvCell);

    const allRows = [header, ...rows, overallRow];
    return allRows.map(row => row.join(',')).join('\n');
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
        <Text style={styles.sectionTitle}>Ledger</Text>
        <Text style={styles.helperText}>Select a trip to view the ledger.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.sectionTitle}>Ledger</Text>
          <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 8 }]} onPress={() => onNavigate('cost')}>
            <Text style={styles.buttonText}>Cost Report</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
            onPress={handleExportCsv}
          >
            <Text style={styles.buttonText}>Export CSV</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.helperText}>Paid vs. used costs across all trip expenses.</Text>
        <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
          <View style={styles.table} testID="ledger-table">
            <View style={[styles.tableRow, styles.tableHeader]}>
              {['Person', 'Paid', 'Used', 'Total'].map((header, idx, arr) => (
                <View key={header} style={[styles.cell, { minWidth: idx === 0 ? 160 : 140, flex: 1 }, idx === arr.length - 1 && styles.lastCell]}>
                  <Text style={styles.headerText}>{header}</Text>
                </View>
              ))}
            </View>
            {memberIds.map((memberId, idx) => (
              <View key={memberId} style={[styles.tableRow, idx === memberIds.length - 1 && styles.lastRow]} testID={`ledger-row-${memberId}`}>
                <View style={[styles.cell, { minWidth: 160, flex: 1 }]}>
                  <Text style={styles.cellText}>{memberNameMap.get(memberId) ?? 'Traveler'}</Text>
                </View>
                <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                  <Text style={styles.cellText}>{formatMoney(paidTotals[memberId] ?? 0)}</Text>
                </View>
                <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                  <Text style={styles.cellText}>{formatMoney(usedTotals[memberId] ?? 0)}</Text>
                </View>
                <View style={[styles.cell, styles.lastCell, { minWidth: 140, flex: 1 }]}>
                  <Text style={styles.cellText}>-</Text>
                </View>
              </View>
            ))}
            {memberIds.length ? (
              <View style={[styles.tableRow, styles.tableHeader]} testID="ledger-overall-row">
                <View style={[styles.cell, { minWidth: 160, flex: 1 }]}>
                  <Text style={styles.headerText}>Overall</Text>
                </View>
                <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                  <Text style={styles.headerText}>{formatMoney(overallPaid)}</Text>
                </View>
                <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                  <Text style={styles.headerText}>{formatMoney(overallUsed)}</Text>
                </View>
                <View style={[styles.cell, styles.lastCell, { minWidth: 140, flex: 1 }]}>
                  <Text style={styles.headerText}>{formatMoney(overallTotal)}</Text>
                </View>
              </View>
            ) : null}
            {!memberIds.length ? (
              <View style={[styles.tableRow, styles.lastRow]}>
                <View style={[styles.cell, styles.lastCell, { minWidth: 160, flex: 1 }]}>
                  <Text style={styles.helperText}>No travelers available.</Text>
                </View>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
      <ExpenseCovering
        groupMembers={groupMembers}
        reportableMembers={reportableMembers}
        coveredBy={coveredBy}
        setCoveredBy={setCoveredBy}
        formatMemberName={formatMemberName}
        payerName={payerName}
        saveCoveredBy={saveCoveredBy}
        styles={styles}
      />
    </View>
  );
};

export default LedgerTab;
