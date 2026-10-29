import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import HorizontalTableScroll from './HorizontalTableScroll';
import { fixedTableColumn } from '../utils/tableColumns';
import { formatDateLong } from '../utils/formatDateLong';
import { formatMemberDisplayName, type DisplayableMember } from '../utils/memberDisplay';
import type { UnifiedExpense } from '../utils/costs';

type Props = {
  expenses: readonly UnifiedExpense[];
  members: readonly DisplayableMember[];
  styles: Record<string, any>;
  readOnly?: boolean;
  onEditItineraryItem?: (sourceType: string, sourceId: string) => void;
};

export default function CostReportExpenses({ expenses, members, styles, readOnly, onEditItineraryItem }: Props) {
  const _styleTheme = useStyleTheme();
  const memberNameMap = new Map(members.map(member => [member.id, formatMemberDisplayName(member)]));
  const visibleExpenses = expenses.filter(expense => Number.isFinite(Number(expense.amount)) && Number(expense.amount) !== 0)
    .slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id));
  return <>
      {visibleExpenses.length ? (
        <View style={themeStyle('components_CostReportExpenses_1', {  }, _styleTheme)} testID="other-expenses">
          <Text style={styles.sectionTitle}>Other Expenses ({visibleExpenses.length})</Text>
          <Text style={styles.helperText}>
            Individual daily expenses and itinerary items with non-zero costs. Select a linked description to edit its itinerary item.
          </Text>
          <HorizontalTableScroll style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
            <View style={styles.table} testID="other-expenses-table">
              <View style={[styles.tableRow, styles.tableHeader]}>
                {['Date', 'Category', 'Description', 'Paid by', 'For', 'Amount'].map((header, index) => (
                  <View key={header} style={[styles.cell, fixedTableColumn(index === 5 ? 90 : index === 2 ? 200 : 130), index === 5 && styles.lastCell]}>
                    <Text style={styles.headerText}>{header}</Text>
                  </View>
                ))}
              </View>
              {visibleExpenses.map((expense, index) => (
                <View key={expense.id} style={[styles.tableRow, index === visibleExpenses.length - 1 && styles.lastRow]} testID={`other-expense-row-${expense.id}`}>
                  <View style={[styles.cell, fixedTableColumn(130)]}>
                    <Text style={styles.cellText}>{formatDateLong(expense.date) || expense.date || '-'}</Text>
                  </View>
                  <View style={[styles.cell, fixedTableColumn(130)]}>
                    <Text style={styles.cellText}>{expense.category}</Text>
                  </View>
                  <View style={[styles.cell, fixedTableColumn(200)]}>
                    {!readOnly && expense.sourceType && expense.sourceId && onEditItineraryItem ? (
                      <TouchableOpacity
                        accessibilityRole="link"
                        accessibilityLabel={`Edit ${expense.description || '-'}`}
                        onPress={() => onEditItineraryItem(expense.sourceType as string, expense.sourceId as string)}
                        testID={`other-expense-edit-source-${expense.id}`}
                      >
                        <Text style={[styles.cellText, styles.linkText]}>{expense.description || '-'}</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.cellText}>{expense.description || '-'}</Text>
                    )}
                  </View>
                  <View style={[styles.cell, fixedTableColumn(130)]}>
                    <Text style={styles.cellText}>{expense.payerIds.length ? expense.payerIds.map((id) => memberNameMap.get(id) ?? 'Traveler').join(', ') : '-'}</Text>
                  </View>
                  <View style={[styles.cell, fixedTableColumn(130)]}>
                    <Text style={styles.cellText}>{expense.forIds.length ? expense.forIds.map((id) => memberNameMap.get(id) ?? 'Traveler').join(', ') : '-'}</Text>
                  </View>
                  <View style={[styles.cell, fixedTableColumn(90)]}>
                    <Text style={styles.cellText}>${(Number(expense.amount) || 0).toFixed(2)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </HorizontalTableScroll>
        </View>
      ) : null}

  </>;
}
