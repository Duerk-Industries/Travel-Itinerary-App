import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ConfirmDialog from '../components/ConfirmDialog';
import { fetchExchangeRate, getLocalDateString } from '../utils/exchangeRates';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { formatMemberDisplayName } from '../utils/memberDisplay';
import { toWebStyle } from '../utils/webStyle';

type Trip = {
  id: string;
  groupId: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  currency?: string | null;
};

type GroupMemberOption = {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
};

type Expense = {
  id: string;
  tripId: string;
  groupId: string;
  userId: string;
  expenseDate: string;
  category: string;
  amount: number;
  currency: string;
  amountInTripCurrency?: number | null;
  exchangeRateToTripCurrency?: number | null;
  exchangeRateDate?: string | null;
  payerIds: string[];
  forIds: string[];
  createdAt: string;
};

type DailyExpensesTabProps = {
  backendUrl: string;
  headers: Record<string, string>;
  jsonHeaders: Record<string, string>;
  trip: Trip | null;
  groupMembers: GroupMemberOption[];
  expenses: Expense[];
  setExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  defaultPayerId: string | null;
  styles: Record<string, any>;
};

const categoryOptions = ['Breakfast', 'Lunch', 'Dinner', 'Other Food', 'Rides', 'Souvenirs', 'Other'] as const;
type CategoryOption = typeof categoryOptions[number];

const formatDateLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/,/g, '');
};

const buildDateRange = (trip: Trip | null): string[] => {
  if (!trip?.startDate || !trip?.endDate) return [];
  const start = new Date(trip.startDate);
  const end = new Date(trip.endDate);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return [];
  const dates: string[] = [];
  let cursor = new Date(start.getTime());
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
};

type NativeDateTimePickerType = typeof import('@react-native-community/datetimepicker').default;
let NativeDateTimePicker: NativeDateTimePickerType | null = null;
if (Platform.OS !== 'web') {
  try {
    const mod = require('@react-native-community/datetimepicker');
    NativeDateTimePicker = (mod?.default ?? mod) as NativeDateTimePickerType;
  } catch (err) {
    console.warn('DateTimePicker unavailable, falling back to text inputs');
    NativeDateTimePicker = null;
  }
}

const DailyExpensesTab: React.FC<DailyExpensesTabProps> = ({
  backendUrl,
  headers,
  jsonHeaders,
  trip,
  groupMembers,
  expenses,
  setExpenses,
  defaultPayerId,
  styles,
}) => {
  const activeMembers = useMemo(
    () => groupMembers.filter((m) => m.status !== 'removed'),
    [groupMembers]
  );
  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    activeMembers.forEach((m) => {
      map.set(m.id, formatMemberDisplayName(m));
    });
    return map;
  }, [activeMembers]);

  const [draftDate, setDraftDate] = useState<string>('');
  const [draftCategory, setDraftCategory] = useState<CategoryOption>('Breakfast');
  const [draftCurrency, setDraftCurrency] = useState<string>('USD');
  const [draftAmount, setDraftAmount] = useState<string>('');
  const [draftForIds, setDraftForIds] = useState<string[]>([]);
  const [draftPayerIds, setDraftPayerIds] = useState<string[]>([]);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [addExpenseVisible, setAddExpenseVisible] = useState(false);
  const [detailTarget, setDetailTarget] = useState<{ date: string; category: CategoryOption } | null>(null);
  const [pendingDeleteExpense, setPendingDeleteExpense] = useState<Expense | null>(null);

  const tripDates = useMemo(() => buildDateRange(trip), [trip]);
  const expenseItems = useMemo(
    () => expenses.filter((expense) => categoryOptions.includes(expense.category as CategoryOption)),
    [expenses]
  );

  useEffect(() => {
    if (!trip) return;
    const todayIso = new Date().toISOString().slice(0, 10);
    const initialDate = tripDates.includes(todayIso) ? todayIso : tripDates[0] ?? todayIso;
    setDraftDate(initialDate);
    setDraftCategory('Breakfast');
    setDraftCurrency(trip.currency ?? 'USD');
    setDraftAmount('');
    setDraftForIds(activeMembers.map((m) => m.id));
    setDraftPayerIds(defaultPayerId ? [defaultPayerId] : []);
  }, [trip?.id, tripDates, activeMembers, defaultPayerId, trip?.currency]);

  const dailyTotals = useMemo(() => {
    const totals: Record<string, Record<string, number>> = {};
    tripDates.forEach((date) => {
      totals[date] = {};
      categoryOptions.forEach((category) => {
        totals[date][category] = 0;
      });
    });
    expenseItems.forEach((expense) => {
      if (!totals[expense.expenseDate]) return;
      totals[expense.expenseDate][expense.category] =
        (totals[expense.expenseDate][expense.category] ?? 0) + (Number(expense.amount) || 0);
    });
    return totals;
  }, [expenseItems, tripDates]);

  const dailyTotalsByDay = useMemo(() => {
    const totals: Record<string, number> = {};
    tripDates.forEach((date) => {
      totals[date] = categoryOptions.reduce((sum, category) => sum + (dailyTotals[date]?.[category] ?? 0), 0);
    });
    return totals;
  }, [dailyTotals, tripDates]);

  const detailItems = useMemo(() => {
    if (!detailTarget) return [];
    return expenseItems.filter(
      (expense) => expense.expenseDate === detailTarget.date && expense.category === detailTarget.category
    );
  }, [detailTarget, expenseItems]);

  const toggleSelection = (ids: string[], id: string): string[] =>
    ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];

  const closeAddExpenseModal = () => {
    setAddExpenseVisible(false);
    setShowCategoryDropdown(false);
    setShowCurrencyDropdown(false);
    setDatePickerVisible(false);
  };

  const saveExpense = async () => {
    if (!trip?.id) {
      alert('Select an active trip before adding expenses.');
      return;
    }
    if (!draftForIds.length) {
      alert('Select at least one traveler.');
      return;
    }
    if (!draftPayerIds.length) {
      alert('Select at least one payer.');
      return;
    }
    if (!draftDate) {
      alert('Select a date.');
      return;
    }
    const tripCurrency = (trip.currency ?? 'USD').toUpperCase();
    const inputCurrency = (draftCurrency || tripCurrency).toUpperCase();
    const amountValue = Number(draftAmount) || 0;
    const rateDate = getLocalDateString();
    let amountInTripCurrency: number | null = null;
    let exchangeRateToTripCurrency: number | null = null;
    let exchangeRateDate: string | null = null;
    if (inputCurrency === tripCurrency) {
      amountInTripCurrency = amountValue;
      exchangeRateToTripCurrency = 1;
      exchangeRateDate = rateDate;
    } else if (amountValue) {
      try {
        const rateInfo = await fetchExchangeRate(inputCurrency, tripCurrency, rateDate);
        if (rateInfo) {
          amountInTripCurrency = amountValue * rateInfo.rate;
          exchangeRateToTripCurrency = rateInfo.rate;
          exchangeRateDate = rateInfo.date;
        }
      } catch {
        // ignore FX lookup failures; ledger can still compute on demand.
      }
    }
    const payload = {
      tripId: trip.id,
      expenseDate: draftDate,
      category: draftCategory,
      amount: amountValue,
      currency: inputCurrency,
      amountInTripCurrency: amountInTripCurrency ?? undefined,
      exchangeRateToTripCurrency: exchangeRateToTripCurrency ?? undefined,
      exchangeRateDate: exchangeRateDate ?? undefined,
      payerIds: draftPayerIds,
      forIds: draftForIds,
    };
    try {
      const res = await fetch(`${backendUrl}/api/expenses`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to save expense');
        return;
      }
      setExpenses((prev) => [data as Expense, ...prev.filter((e) => e.id !== data.id)]);
      setDraftAmount('');
      closeAddExpenseModal();
    } catch (err) {
      alert((err as Error).message || 'Unable to save expense');
    }
  };

  const deleteExpense = async (expense: Expense) => {
    try {
      const res = await fetch(`${backendUrl}/api/expenses/${expense.id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Unable to delete expense');
        return;
      }
      setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
      setPendingDeleteExpense(null);
    } catch (err) {
      alert((err as Error).message || 'Unable to delete expense');
    }
  };

  if (!trip) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Daily Expenses</Text>
        <Text style={styles.helperText}>Select a trip to view daily expenses.</Text>
      </View>
    );
  }

  if (!tripDates.length) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Daily Expenses</Text>
        <Text style={styles.helperText}>Add trip start and end dates to track daily expenses.</Text>
      </View>
    );
  }

  const formattedDraftDate = draftDate ? formatDateLabel(draftDate) : '';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Daily Expenses</Text>
        <TouchableOpacity
          style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
          onPress={() => setAddExpenseVisible(true)}
          testID="expense-add-button"
        >
          <Text style={styles.buttonText}>+ Add Expense</Text>
        </TouchableOpacity>
      </View>
      {addExpenseVisible ? (
        <Modal transparent visible animationType="fade">
          <View style={styles.modalOverlay} testID="expense-add-modal">
            <View style={[styles.modalCard, styles.expenseModalCard]}>
              <View style={styles.row}>
                <Text style={styles.sectionTitle}>Add Expense</Text>
                <TouchableOpacity
                  style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
                  onPress={closeAddExpenseModal}
                >
                  <Text style={styles.buttonText}>Close</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.expenseModalScroll} contentContainerStyle={{ gap: 8, overflow: 'visible', paddingBottom: 8 }}>
                <View style={styles.expenseFieldRow}>
                  <View style={styles.expenseFieldDate}>
                    {Platform.OS === 'web' ? (
                      <input
                        type="date"
                        value={draftDate}
                        onChange={(event) => setDraftDate(event.target.value)}
                        style={{
                          ...toWebStyle(styles.input),
                          width: '100%',
                          maxWidth: '100%',
                          boxSizing: 'border-box',
                        }}
                      />
                    ) : (
                      <View style={styles.dateInputWrap}>
                        <TouchableOpacity
                          style={[styles.input, styles.dateTouchable]}
                          onPress={() => setDatePickerVisible(true)}
                        >
                          <Text style={draftDate ? styles.cellText : styles.placeholderText}>
                            {draftDate ? formattedDraftDate : 'Select date'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.dateIcon} onPress={() => setDatePickerVisible(true)}>
                          <Text style={styles.selectCaret}>📅</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  <View style={[styles.input, styles.dropdown, styles.expenseFieldCategory]}>
                    <TouchableOpacity
                      style={styles.selectButtonRow}
                      onPress={() => setShowCategoryDropdown((prev) => !prev)}
                    >
                      <Text style={styles.cellText}>{draftCategory}</Text>
                      <Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                    {showCategoryDropdown ? (
                      <View style={styles.dropdownList}>
                        {categoryOptions.map((category) => (
                          <TouchableOpacity
                            key={category}
                            style={styles.dropdownOption}
                            onPress={() => {
                              setDraftCategory(category);
                              setShowCategoryDropdown(false);
                            }}
                          >
                            <Text style={styles.cellText}>{category}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <View style={[styles.input, styles.dropdown, styles.expenseFieldCurrency]}>
                    <TouchableOpacity
                      style={styles.selectButtonRow}
                      onPress={() => setShowCurrencyDropdown((prev) => !prev)}
                    >
                      <Text style={styles.cellText}>{draftCurrency}</Text>
                      <Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                    {showCurrencyDropdown ? (
                      <View style={styles.dropdownList}>
                        {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'MXN'].map((currency) => (
                          <TouchableOpacity
                            key={currency}
                            style={styles.dropdownOption}
                            onPress={() => {
                              setDraftCurrency(currency);
                              setShowCurrencyDropdown(false);
                            }}
                          >
                            <Text style={styles.cellText}>{currency}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <TextInput
                    style={[styles.input, styles.expenseFieldAmount]}
                    placeholder="Amount"
                    keyboardType="numeric"
                    value={draftAmount}
                    onChangeText={(value: string) => setDraftAmount(sanitizeCostInput(value))}
                  />
                </View>

                <Text style={styles.headerText}>For</Text>
                <View style={styles.toggleGroup}>
                  {activeMembers.map((member) => {
                    const selected = draftForIds.includes(member.id);
                    return (
                      <TouchableOpacity
                        key={`for-toggle-${member.id}`}
                        style={[
                          styles.expenseToggleButton,
                          selected ? styles.expenseToggleSelected : styles.expenseToggleUnselected,
                        ]}
                        onPress={() => setDraftForIds((prev) => toggleSelection(prev, member.id))}
                      >
                        <Text style={[styles.expenseToggleText, selected && styles.expenseToggleTextSelected]}>
                          {memberNameMap.get(member.id) ?? 'Traveler'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.headerText}>Payers</Text>
                <View style={styles.toggleGroup}>
                  {activeMembers.map((member) => {
                    const selected = draftPayerIds.includes(member.id);
                    return (
                      <TouchableOpacity
                        key={`payer-toggle-${member.id}`}
                        style={[
                          styles.expenseToggleButton,
                          selected ? styles.expenseToggleSelected : styles.expenseToggleUnselected,
                        ]}
                        onPress={() => setDraftPayerIds((prev) => toggleSelection(prev, member.id))}
                      >
                        <Text style={[styles.expenseToggleText, selected && styles.expenseToggleTextSelected]}>
                          {memberNameMap.get(member.id) ?? 'Traveler'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.row}>
                  <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={saveExpense} testID="expense-save">
                    <Text style={styles.buttonText}>Save Expense</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}

      <View style={styles.divider} />
      <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            {['Date', ...categoryOptions, 'Total'].map((header, index) => (
              <View key={header} style={[styles.cell, { minWidth: index === 0 ? 120 : 110, flex: 1 }, index === categoryOptions.length + 1 && styles.lastCell]}>
                <Text style={styles.headerText}>{header}</Text>
              </View>
            ))}
          </View>
          {tripDates.map((date, idx) => (
            <View key={date} style={[styles.tableRow, idx === tripDates.length - 1 && styles.lastRow]}>
              <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                <Text style={styles.cellText}>{formatDateLabel(date)}</Text>
              </View>
              {categoryOptions.map((category) => {
                const value = dailyTotals[date]?.[category] ?? 0;
                const content = value ? `$${value.toFixed(2)}` : '-';
                return (
                  <View key={`${date}-${category}`} style={[styles.cell, { minWidth: 110, flex: 1 }]}>
                    {value ? (
                      <TouchableOpacity onPress={() => setDetailTarget({ date, category })} testID={`expense-cell-${date}-${category}`}>
                        <Text style={[styles.cellText, styles.linkText]}>{content}</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.cellText}>{content}</Text>
                    )}
                  </View>
                );
              })}
              <View style={[styles.cell, styles.lastCell, { minWidth: 110, flex: 1 }]}>
                <Text style={styles.cellText}>${(dailyTotalsByDay[date] ?? 0).toFixed(2)}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {Platform.OS !== 'web' && datePickerVisible && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={draftDate ? new Date(draftDate) : new Date()}
          mode="date"
          onChange={(_, date) => {
            if (!date) {
              setDatePickerVisible(false);
              return;
            }
            setDraftDate(date.toISOString().slice(0, 10));
            setDatePickerVisible(false);
          }}
        />
      ) : null}

      {detailTarget ? (
        <Modal transparent visible animationType="fade">
          <View style={styles.modalOverlay} testID="expense-detail-modal">
            <View style={[styles.modalCard, styles.detailModal]}>
              <View style={styles.row}>
                <Text style={styles.sectionTitle}>
                  {detailTarget ? `${detailTarget.category} · ${formatDateLabel(detailTarget.date)}` : 'Details'}
                </Text>
                <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={() => setDetailTarget(null)}>
                  <Text style={styles.buttonText}>Close</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.detailModalScroll}>
                <View style={[styles.table, { marginTop: 8 }]}>
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    {['For', 'Payers', 'Amount', 'Action'].map((header, index) => (
                      <View key={header} style={[styles.cell, { minWidth: index === 2 ? 90 : 140, flex: 1 }, index === 3 && styles.lastCell]}>
                        <Text style={styles.headerText}>{header}</Text>
                      </View>
                    ))}
                  </View>
                  {detailItems.map((expense, index) => (
                    <View key={expense.id} style={[styles.tableRow, index === detailItems.length - 1 && styles.lastRow]}>
                      <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                        <Text style={styles.cellText}>
                          {expense.forIds.length
                            ? expense.forIds.map((id) => memberNameMap.get(id) ?? 'Traveler').join(', ')
                            : '-'}
                        </Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                        <Text style={styles.cellText}>
                          {expense.payerIds.length
                            ? expense.payerIds.map((id) => memberNameMap.get(id) ?? 'Traveler').join(', ')
                            : '-'}
                        </Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 90, flex: 1 }]}>
                        <Text style={styles.cellText}>${(Number(expense.amount) || 0).toFixed(2)}</Text>
                      </View>
                      <View style={[styles.cell, styles.lastCell, { minWidth: 120, flex: 1 }]}>
                        <TouchableOpacity
                          style={[styles.tableActionButton, styles.tableActionButtonDanger]}
                          onPress={() => setPendingDeleteExpense(expense)}
                          testID={`expense-delete-${expense.id}`}
                        >
                          <Text style={styles.buttonText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                  {!detailItems.length ? (
                    <View style={[styles.tableRow, styles.lastRow]}>
                      <View style={[styles.cell, styles.lastCell, { minWidth: 140, flex: 1 }]}>
                        <Text style={styles.helperText}>No expenses recorded.</Text>
                      </View>
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}

      {pendingDeleteExpense ? (
        <ConfirmDialog
          visible={Boolean(pendingDeleteExpense)}
          title="Delete Expense"
          message="Are you sure you want to delete this expense? This cannot be undone."
          onConfirm={() => deleteExpense(pendingDeleteExpense)}
          onCancel={() => setPendingDeleteExpense(null)}
          styles={styles}
        />
      ) : null}
    </View>
  );
};

export default DailyExpensesTab;
