import React from 'react';
import { ScrollView, Text, View } from 'react-native';

type Member = {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
};

type CostReportRow = {
  label: string;
  total: number;
  shares: Record<string, number>;
};

type CostReportTableProps = {
  rows: CostReportRow[];
  members: Member[];
  overallShares: Record<string, number>;
  overallCost: number;
  styles: Record<string, any>;
  formatMemberName: (member: Member) => string;
};

const CostReportTable: React.FC<CostReportTableProps> = ({
  rows,
  members,
  overallShares,
  overallCost,
  styles,
  formatMemberName,
}) => (
  <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
    <View style={styles.table}>
      <View style={[styles.tableRow, styles.tableHeader]}>
        <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
          <Text style={styles.headerText}>Category</Text>
        </View>
        {members.map((m) => (
          <View key={m.id} style={[styles.cell, { minWidth: 120, flex: 1 }]}>
            <Text style={styles.headerText}>{formatMemberName(m)}</Text>
          </View>
        ))}
        <View style={[styles.cell, styles.lastCell, { minWidth: 120, flex: 1 }]}>
          <Text style={styles.headerText}>Total</Text>
        </View>
      </View>
      {rows.map((row, idx, arr) => (
        <View key={row.label} style={[styles.tableRow, idx === arr.length - 1 && styles.lastRow]}>
          <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
            <Text style={styles.cellText}>{row.label}</Text>
          </View>
          {members.map((m) => {
            const share = row.shares[m.id] ?? 0;
            return (
              <View key={`${row.label}-${m.id}`} style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                <Text style={styles.cellText}>${share.toFixed(2)}</Text>
              </View>
            );
          })}
          <View style={[styles.cell, styles.lastCell, { minWidth: 120, flex: 1 }]}>
            <Text style={styles.cellText}>${row.total.toFixed(2)}</Text>
          </View>
        </View>
      ))}
      <View style={[styles.tableRow, styles.tableHeader]}>
        <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
          <Text style={styles.headerText}>Overall</Text>
        </View>
        {members.map((m) => {
          const total = overallShares[m.id] ?? 0;
          return (
            <View key={`overall-${m.id}`} style={[styles.cell, { minWidth: 120, flex: 1 }]}>
              <Text style={styles.headerText}>${total.toFixed(2)}</Text>
            </View>
          );
        })}
        <View style={[styles.cell, styles.lastCell, { minWidth: 120, flex: 1 }]}>
          <Text style={styles.headerText}>${overallCost.toFixed(2)}</Text>
        </View>
      </View>
    </View>
  </ScrollView>
);

export default CostReportTable;
