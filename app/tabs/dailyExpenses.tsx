import { resolveComponentTheme as resolveStyleTheme, themeStyle, getAppTheme as getStyleTheme, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import PayerSelect from '../components/PayerSelect';
import { singlePayerIds } from '../utils/payerSelection';
import { exportCsv } from '../utils/csvExport';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import HorizontalTableScroll from '../components/HorizontalTableScroll';
import ConfirmDialog from '../components/ConfirmDialog';
import DialogShell from '../components/DialogShell';
import PlaidImportQueue from '../components/PlaidImportQueue';
import DraftTextInput from '../components/DraftTextInput';
import SelectField, { type SelectFieldOption } from '../components/SelectField';
import DateField from '../components/DateField';
import { formatLocalDateOnly, localTodayDateOnly, parseLocalDateOnly } from '../utils/dateOnly';
import { fetchExchangeRate, getLocalDateString } from '../utils/exchangeRates';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { formatMemberDisplayName } from '../utils/memberDisplay';
import { formatDateLong } from '../utils/formatDateLong';
import { toWebStyle } from '../utils/webStyle';
import { alertMessage } from '../utils/crossPlatformAlert';
import { usePersistedState } from '../hooks/usePersistedState';
import { fixedTableColumn } from '../utils/tableColumns';
import { startItemSaveTask } from '../utils/analytics/track';
import { newPendingExpenseArgs, type PendingExpenseArgs } from '../utils/pendingExpenses';
import type { PendingExpenseEntry } from '../hooks/usePendingExpenseSync';

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
  vendor?: string | null;
  notes?: string | null;
  payerIds: string[];
  forIds: string[];
  createdAt: string;
  sourceType?: string | null;
  sourceId?: string | null;
};

type ParsedReceiptExpenseDraft = {
  expenseDate?: string | null;
  /** 24-hour "HH:MM" from the receipt; the server already used it to pick Breakfast/Lunch/Dinner. */
  expenseTime?: string | null;
  amount?: number | null;
  currency?: string | null;
  vendor?: string | null;
  category?: string | null;
  notes?: string | null;
};

type DailyExpensesTabProps = {
  theme: AppTheme;
  backendUrl: string;
  headers: Record<string, string>;
  jsonHeaders: Record<string, string>;
  trip: Trip | null;
  groupMembers: GroupMemberOption[];
  expenses: Expense[];
  setExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  defaultPayerId: string | null;
  styles: Record<string, any>;
  /** Names for itinerary items whose generated expenses appear in this table. */
  itineraryExpenseDescriptions?: Readonly<Record<string, string>>;
  /** Opens the linked itinerary item's standard editor. */
  onEditItineraryItem?: (sourceType: string, sourceId: string) => void;
  /** Opens the Balances page (who owes whom). Omitted when the viewer can't open it. */
  onOpenBalances?: () => void;
  costTrackingAllowed?: boolean;
  receiptScanningAllowed?: boolean;
  expenseImportAllowed?: boolean;
  readOnly?: boolean;
  /** Lets "Add Expense" work while the rest of the tab is read-only because the device is offline. */
  allowOfflineAdd?: boolean;
  /** Expenses saved on this device and waiting to sync. Provided by the app-level sync hook. */
  pendingExpenses?: {
    entries: PendingExpenseEntry[];
    syncedNotice: string | null;
    queueExpense: (args: PendingExpenseArgs) => Promise<string | null>;
    retryEntry: (id: string) => void;
    replaceEntry?: (id: string, args: PendingExpenseArgs) => Promise<boolean>;
    discardEntry: (id: string) => void | Promise<boolean>;
  };
};

const categoryOptions = ['Breakfast', 'Lunch', 'Dinner', 'Other Food', 'Rides', 'Souvenirs', 'Other'] as const;
const categorySelectOptions: SelectFieldOption[] = categoryOptions.map((category) => ({ label: category, value: category }));
const currencySelectOptions: SelectFieldOption[] = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'MXN'].map((currency) => ({
  label: currency,
  value: currency,
}));
type CategoryOption = typeof categoryOptions[number];

type DailyExpenseDraft = {
  isOpen: boolean;
  date: string;
  category: CategoryOption;
  currency: string;
  amount: string;
  vendor: string;
  forIds: string[];
  payerIds: string[];
};

const dayCardStyles = {
  card: themeStyle('tabs_dailyExpenses_1', {  }, getStyleTheme('auto', null)),
  headerRow: themeStyle('tabs_dailyExpenses_2', {  }, getStyleTheme('auto', null)),
  dateLabel: themeStyle('tabs_dailyExpenses_3', {  }, getStyleTheme('auto', null)),
  dayTotal: themeStyle('tabs_dailyExpenses_4', {  }, getStyleTheme('auto', null)),
  categoryRow: themeStyle('tabs_dailyExpenses_5', {  }, getStyleTheme('auto', null)),
  emptyNote: themeStyle('tabs_dailyExpenses_6', {  }, getStyleTheme('auto', null)),
};

const formatDateLabel = (iso: string): string => {
  // `iso` is a date-only string (YYYY-MM-DD, e.g. from buildDateRange below).
  // `new Date(iso)` parses that as UTC midnight; toLocaleDateString then
  // renders it in the browser's local timezone, which rolls the displayed
  // date back a day for anyone west of UTC (e.g. a trip starting Sat Oct 10
  // showed as "Fri Oct 9"). Parse the year/month/day explicitly into a local
  // Date instead, matching the safe pattern already used by formatDateLong.ts.
  const [y, m, d] = iso.split('-').map((part) => Number(part));
  const date = Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d) ? new Date(iso) : new Date(y, m - 1, d);
  if (Number.isNaN(date.valueOf())) return iso;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/,/g, '');
};

const buildDateRange = (trip: Trip | null): string[] => {
  if (!trip?.startDate || !trip?.endDate) return [];
  const start = parseLocalDateOnly(trip.startDate);
  const end = parseLocalDateOnly(trip.endDate);
  if (formatLocalDateOnly(start) !== trip.startDate || formatLocalDateOnly(end) !== trip.endDate) return [];
  const dates: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    dates.push(formatLocalDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const DailyExpensesTab: React.FC<DailyExpensesTabProps> = ({
  theme: _providedTheme,
  backendUrl,
  headers,
  jsonHeaders,
  trip,
  groupMembers,
  expenses,
  setExpenses,
  defaultPayerId,
  styles,
  itineraryExpenseDescriptions = {},
  onEditItineraryItem,
  onOpenBalances,
  costTrackingAllowed,
  receiptScanningAllowed,
  expenseImportAllowed = false,
  readOnly = false,
  allowOfflineAdd = false,
  pendingExpenses,
}) => {
  const canScanReceipt = Boolean(receiptScanningAllowed && costTrackingAllowed && !readOnly && Platform.OS === 'web');
  const canImportExpenses = Boolean(expenseImportAllowed && costTrackingAllowed && !readOnly);
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [editingPendingId, setEditingPendingId] = useState<string | null>(null);
  const [pendingDiscardId, setPendingDiscardId] = useState<string | null>(null);
  const tripPendingEntries = useMemo(
    () => (pendingExpenses?.entries ?? []).filter((entry) => entry.args.payload.tripId === trip?.id),
    [pendingExpenses?.entries, trip?.id],
  );
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isNarrowLayout = viewportWidth < 700;
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


  const tripDates = useMemo(() => buildDateRange(trip), [trip]);
  const expenseDraftStorageKey = `stp.daily-expense-draft.${trip?.id ?? 'none'}`;
  const defaultExpenseDraft = useMemo<DailyExpenseDraft>(() => {
    const todayIso = localTodayDateOnly();
    return {
      isOpen: false,
      date: tripDates.includes(todayIso) ? todayIso : tripDates[0] ?? todayIso,
      category: 'Breakfast',
      currency: trip?.currency ?? 'USD',
      amount: '',
      vendor: '',
      forIds: activeMembers.map((member) => member.id),
      payerIds: defaultPayerId ? [defaultPayerId] : [],
    };
  }, [activeMembers, defaultPayerId, trip?.currency, tripDates]);
  const [storedExpenseDraft, setExpenseDraft] = usePersistedState<DailyExpenseDraft | null>(
    expenseDraftStorageKey,
    null,
  );
  const expenseDraft = storedExpenseDraft ?? defaultExpenseDraft;
  const {
    date: draftDate,
    category: draftCategory,
    currency: draftCurrency,
    amount: draftAmount,
    vendor: draftVendor,
    forIds: draftForIds,
    payerIds: draftPayerIds,
  } = expenseDraft;
  const updateExpenseDraft = (update: Partial<DailyExpenseDraft>) => {
    setExpenseDraft((current) => ({ ...(current ?? defaultExpenseDraft), ...update }));
  };
  const setDraftDate = (date: string) => updateExpenseDraft({ date });
  const setDraftCategory = (category: CategoryOption) => updateExpenseDraft({ category });
  const setDraftCurrency = (currency: string) => updateExpenseDraft({ currency });
  const setDraftAmount = (amount: string) => updateExpenseDraft({ amount });
  const setDraftVendor = (vendor: string) => updateExpenseDraft({ vendor });
  const setDraftForIds = (next: React.SetStateAction<string[]>) => {
    setExpenseDraft((current) => {
      const draft = current ?? defaultExpenseDraft;
      return {
        ...draft,
        forIds: typeof next === 'function' ? next(draft.forIds) : next,
      };
    });
  };
  const setDraftPayerIds = (next: React.SetStateAction<string[]>) => {
    setExpenseDraft((current) => {
      const draft = current ?? defaultExpenseDraft;
      return {
        ...draft,
        payerIds: typeof next === 'function' ? next(draft.payerIds) : next,
      };
    });
  };
  const [importExpensesVisible, setImportExpensesVisible] = useState(false);
  const [receiptParsing, setReceiptParsing] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  // Shown inside the expense dialog after a scan -- never written into the expense itself.
  const [receiptNotice, setReceiptNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!expenseDraft.isOpen) setReceiptNotice(null);
  }, [expenseDraft.isOpen]);
  const [detailTarget, setDetailTarget] = useState<{ date: string; category: CategoryOption } | null>(null);
  const [pendingDeleteExpense, setPendingDeleteExpense] = useState<Expense | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const receiptFileInputRef = useRef<any>(null);

  // Keep zero-cost itinerary records intact so a later cost update can surface
  // them again, without requiring users to repeatedly delete mirrored $0 rows.
  const nonZeroExpenses = useMemo(
    () => expenses.filter((expense) => (Number(expense.amount) || 0) !== 0),
    [expenses]
  );
  const expenseItems = useMemo(
    () => nonZeroExpenses.filter((expense) => categoryOptions.includes(expense.category as CategoryOption)),
    [nonZeroExpenses]
  );

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

  const openAddExpenseModal = () => {
    setEditingPendingId(null);
    setEditingExpenseId(null);
    updateExpenseDraft({ isOpen: true });
  };

  const cancelAddExpenseModal = () => {
    setExpenseDraft(null);
    setEditingPendingId(null);
    setEditingExpenseId(null);
    setReceiptError(null);
  };

  const openEditExpenseModal = (expense: Expense) => {
    if (readOnly) return;
    setEditingPendingId(null);
    setPendingDeleteExpense(null);
    setDetailTarget(null);
    setEditingExpenseId(expense.id);
    setExpenseDraft({
      isOpen: true,
      date: expense.expenseDate,
      category: expense.category as CategoryOption,
      currency: expense.currency || trip?.currency || 'USD',
      amount: String(expense.amount ?? ''),
      vendor: expense.vendor || expense.notes || '',
      forIds: Array.isArray(expense.forIds) ? expense.forIds : [],
      payerIds: Array.isArray(expense.payerIds) ? expense.payerIds : [],
    });
  };

  const handleReceiptPickerPress = () => {
    if (!canScanReceipt) return;
    if (!receiptScanningAllowed) {
      alertMessage('Receipt scanning is available with Premium.');
      return;
    }
    setReceiptError(null);
    if (Platform.OS === 'web') {
      receiptFileInputRef.current?.click?.();
      return;
    }
    alertMessage('Receipt scanning is available in a mobile web browser.');
  };

  const applyParsedReceiptDraft = (parsed: ParsedReceiptExpenseDraft) => {
    const parsedDateOutsideTrip = Boolean(parsed.expenseDate && tripDates.length && !tripDates.includes(parsed.expenseDate));
    if (parsed.expenseDate && (!tripDates.length || tripDates.includes(parsed.expenseDate))) {
      setDraftDate(parsed.expenseDate);
    }
    const parsedCategory = parsed.category && categoryOptions.includes(parsed.category as CategoryOption)
      ? parsed.category as CategoryOption
      : 'Other';
    setDraftCategory(parsedCategory);
    if (parsed.currency) setDraftCurrency(parsed.currency.toUpperCase());
    if (typeof parsed.amount === 'number' && Number.isFinite(parsed.amount)) {
      setDraftAmount(parsed.amount.toFixed(2));
    }
    // Description gets the merchant name only; review guidance goes in the dialog notice instead.
    setDraftVendor(parsed.vendor ?? '');
    setReceiptNotice(
      [
        'Filled in from your receipt. Check the amount, date and category before saving.',
        parsedDateOutsideTrip && parsed.expenseDate
          ? `The receipt date (${formatDateLabel(parsed.expenseDate)}) is outside this trip's dates, so the date was not changed.`
          : '',
        !parsed.expenseDate ? "The receipt's date couldn't be read." : '',
        parsed.amount == null ? "The total couldn't be read." : '',
      ].filter(Boolean).join(' ')
    );
    openAddExpenseModal();
  };

  const handleReceiptFile = async (file: File | null | undefined) => {
    if (!canScanReceipt) return;
    if (!receiptScanningAllowed) {
      alertMessage('Receipt scanning is available with Premium.');
      return;
    }
    if (!trip?.id || !file) return;
    setReceiptParsing(true);
    setReceiptError(null);
    try {
      const form = new FormData();
      form.append('tripId', trip.id);
      form.append('image', file);
      const uploadHeaders = { ...headers };
      delete uploadHeaders['Content-Type'];
      delete uploadHeaders['content-type'];
      const res = await fetch(`${backendUrl}/api/expenses/receipt/parse`, {
        method: 'POST',
        headers: uploadHeaders,
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data.error || 'Unable to scan receipt';
        setReceiptError(message);
        alertMessage(message);
        return;
      }
      applyParsedReceiptDraft(data as ParsedReceiptExpenseDraft);
    } catch (err) {
      const message = (err as Error).message || 'Unable to scan receipt';
      setReceiptError(message);
      alertMessage(message);
    } finally {
      setReceiptParsing(false);
      if (receiptFileInputRef.current) receiptFileInputRef.current.value = '';
    }
  };

  const saveExpense = async () => {
    // Offline, only brand-new expenses may be added (they are saved on this device and synced later).
    // Editing an existing expense, or following someone else's trip, stays read-only.
    const canQueueOffline = allowOfflineAdd && Boolean(pendingExpenses) && !editingExpenseId;
    if (readOnly && !canQueueOffline) {
      alertMessage('Offline trip information is read-only. Reconnect to add an expense.');
      return;
    }
    if (!costTrackingAllowed) {
      alertMessage('Expense tracking is a premium feature');
      return;
    }
    if (!trip?.id) {
      alertMessage('Select an active trip before adding expenses.');
      return;
    }
    if (!draftForIds.length) {
      alertMessage('Select at least one traveler.');
      return;
    }
    if (!draftPayerIds.length) {
      alertMessage('Select at least one payer.');
      return;
    }
    if (!draftDate) {
      alertMessage('Select a date.');
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
      payerIds: singlePayerIds(draftPayerIds, defaultPayerId),
      forIds: draftForIds,
      vendor: draftVendor || undefined,
    };
    // A new expense carries one stable operation key for its whole life. Whether the first attempt
    // reaches the server, times out after committing, or is replayed later from the offline queue, the
    // server returns the same expense instead of creating a duplicate.
    const pendingArgs: PendingExpenseArgs | null = editingExpenseId ? null : newPendingExpenseArgs(payload);

    const saveOnThisDevice = async (): Promise<boolean> => {
      if (!pendingArgs || !pendingExpenses) return false;
      const queuedId = await pendingExpenses.queueExpense(pendingArgs);
      if (!queuedId) {
        // Keep the form open with everything the user typed; do not claim anything was saved.
        alertMessage("Couldn't save this expense on your device. Free up some space and try again.");
        return true;
      }
      cancelAddExpenseModal();
      return true;
    };

    if (editingPendingId && pendingArgs) {
      if (!await pendingExpenses?.replaceEntry?.(editingPendingId, pendingArgs)) {
        alertMessage("Couldn't replace this expense. The original is still saved. Try again.");
        return;
      }
      cancelAddExpenseModal();
      return;
    }
    if (readOnly && pendingArgs) {
      await saveOnThisDevice();
      return;
    }

    const saveTask = startItemSaveTask('expenses', Boolean(editingExpenseId), trip.id);
    try {
      const res = await saveTask.request(editingExpenseId ? `${backendUrl}/api/expenses/${editingExpenseId}` : `${backendUrl}/api/expenses`, {
        method: editingExpenseId ? 'PUT' : 'POST',
        headers: pendingArgs ? { ...jsonHeaders, 'Idempotency-Key': pendingArgs.operationKey } : jsonHeaders,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alertMessage(data.error || `Unable to ${editingExpenseId ? 'update' : 'save'} expense`);
        return;
      }
      setExpenses((prev) => editingExpenseId
        ? prev.map((expense) => expense.id === data.id ? data as Expense : expense)
        : [data as Expense, ...prev.filter((expense) => expense.id !== data.id)]);
      cancelAddExpenseModal();
    } catch (err) {
      // The request never got an answer (lost connection mid-save). For a new expense the answer is
      // unknown, so queue it under the same key: the server dedupes if it did save.
      if (pendingArgs && (await saveOnThisDevice())) return;
      alertMessage((err as Error).message || 'Unable to save expense');
    }
  };

  const deleteExpense = async (expense: Expense) => {
    if (readOnly) {
      alertMessage('Offline trip information is read-only. Reconnect to delete an expense.');
      return;
    }
    if (!costTrackingAllowed) {
      alertMessage('Expense tracking is a premium feature');
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/expenses/${expense.id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alertMessage(data.error || 'Unable to delete expense');
        return;
      }
      setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
      setPendingDeleteExpense(null);
    } catch (err) {
      alertMessage((err as Error).message || 'Unable to delete expense');
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

  const fullWidthExpenseField = isNarrowLayout ? themeStyle('tabs_dailyExpenses_7', {  }, (theme ?? _styleTheme)) : null;
  const narrowSelectField = isNarrowLayout ? themeStyle('tabs_dailyExpenses_8', {  }, (theme ?? _styleTheme)) : null;
  const narrowAmountField = isNarrowLayout ? themeStyle('tabs_dailyExpenses_9', {  }, (theme ?? _styleTheme)) : null;
  const categoryFieldStyle = [styles.expenseFieldCategory, narrowSelectField];
  const currencyFieldStyle = [styles.expenseFieldCurrency, narrowSelectField];
  const dateFieldStyle = isNarrowLayout
    ? { ...(styles.expenseFieldDate ?? {}), ...(fullWidthExpenseField ?? {}) }
    : styles.expenseFieldDate;
  const amountFieldStyle = [styles.input, styles.expenseFieldAmount, narrowAmountField];
  const vendorFieldStyle = [styles.input, styles.expenseFieldVendor, fullWidthExpenseField];
  const narrowCardsScrollStyle = isNarrowLayout
    ? [
        styles.dailyExpensesVerticalScroll,
        themeStyle('tabs_dailyExpenses_10', { viewportHeight: viewportHeight }, (theme ?? _styleTheme)),
      ]
    : styles.dailyExpensesVerticalScroll;
  const webFieldBase = themeStyle('tabs_dailyExpenses_11', {  }, (theme ?? _styleTheme));

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Daily Expenses</Text>
        <TouchableOpacity
          style={[styles.button, styles.smallButton, themeStyle('tabs_dailyExpenses_12', {  }, (theme ?? _styleTheme))]}
          onPress={openAddExpenseModal}
          disabled={readOnly && !(allowOfflineAdd && pendingExpenses)}
          testID="expense-add-button"
        >
          <Text style={styles.buttonText}>+ Add Expense</Text>
        </TouchableOpacity>
        {canScanReceipt ? (
          <TouchableOpacity
            style={[styles.button, styles.smallButton, receiptParsing && styles.buttonDisabled]}
            onPress={handleReceiptPickerPress}
            disabled={receiptParsing || readOnly}
            testID="expense-scan-receipt-button"
          >
            <Text style={styles.buttonText}>{receiptParsing ? 'Scanning...' : 'Scan Receipt'}</Text>
          </TouchableOpacity>
        ) : null}
        {canImportExpenses ? (
        <TouchableOpacity
          style={[styles.button, styles.smallButton]}
          onPress={() => { if (canImportExpenses) setImportExpensesVisible(true); }}
          disabled={readOnly}
          testID="expense-import-button"
        >
          <Text style={styles.buttonText}>Import</Text>
        </TouchableOpacity>
        ) : null}
        {onOpenBalances ? (
          <TouchableOpacity
            style={[styles.button, styles.smallButton]}
            onPress={onOpenBalances}
            accessibilityRole="button"
            accessibilityLabel="Settle Up: open balances"
            testID="expense-balances-button"
          >
            <Text style={styles.buttonText}>Settle Up</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {canScanReceipt ? (
        <input
          ref={receiptFileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => handleReceiptFile(event.target.files?.[0])}
          style={themeStyle('tabs_dailyExpenses_13', {  }, (theme ?? _styleTheme))}
          data-testid="expense-receipt-input"
        />
      ) : null}
      {receiptError ? <Text style={styles.warningText}>{receiptError}</Text> : null}
      {pendingExpenses?.syncedNotice ? (
        <Text style={styles.helperText} accessibilityRole="alert" testID="expense-synced-notice">
          {pendingExpenses.syncedNotice}
        </Text>
      ) : null}
      {tripPendingEntries.length ? (
        <View style={styles.card} testID="expense-pending-section" accessibilityLabel="Expenses waiting to sync">
          <Text style={styles.flightTitle}>Saved on this device · waiting to sync</Text>
          <Text style={styles.helperText}>
            These expenses are not on the server yet. They are sent automatically when you are back online and signed in.
          </Text>
          {tripPendingEntries.map((entry) => {
            const failed = entry.status === 'failed';
            const { payload } = entry.args;
            return (
              <View key={entry.id} style={styles.groupRow} testID={`expense-pending-${entry.id}`}>
                <View style={themeStyle('tabs_dailyExpenses_14', {  }, (theme ?? _styleTheme))}>
                  <Text style={styles.cellText}>
                    {formatDateLong(payload.expenseDate)} · {payload.category}
                    {payload.vendor ? ` · ${payload.vendor}` : ''} · {payload.amount.toFixed(2)} {payload.currency}
                  </Text>
                  <Text style={failed ? styles.warningText : styles.helperText}>
                    {failed
                      ? `Couldn't sync: ${entry.lastError || 'the server rejected this expense.'}`
                      : entry.lastError
                        ? `Waiting to sync · ${entry.lastError}`
                        : 'Waiting to sync'}
                  </Text>
                </View>
                {failed ? (
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton]}
                    onPress={() => pendingExpenses?.retryEntry(entry.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Try syncing this expense again"
                  >
                    <Text style={styles.buttonText}>Try again</Text>
                  </TouchableOpacity>
                ) : null}
                {failed && pendingExpenses?.replaceEntry ? <TouchableOpacity style={[styles.button, styles.smallButton]}
                  accessibilityRole="button" accessibilityLabel="Edit this rejected expense" onPress={() => {
                    setEditingExpenseId(null); setEditingPendingId(entry.id);
                    setExpenseDraft({ isOpen: true, date: payload.expenseDate, category: payload.category as CategoryOption,
                      currency: payload.currency, amount: String(payload.amount), vendor: payload.vendor || '',
                      forIds: payload.forIds, payerIds: payload.payerIds });
                  }}><Text style={styles.buttonText}>Edit</Text></TouchableOpacity> : null}
                <TouchableOpacity style={[styles.button, styles.smallButton]} accessibilityRole="button"
                  accessibilityLabel="Export this unsynced expense" onPress={() => {
                    // JSON inside a quoted CSV cell preserves recovery data without formula execution.
                    const recovery = JSON.stringify({ operationKey: entry.args.operationKey, ...payload });
                    void exportCsv(`Recovery data\n"${recovery.replace(/"/g, '""')}"`, 'unsynced-expense.csv')
                      .then(result => { if (result === 'failed' || result === 'unavailable') alertMessage('Could not export. Your expense is still saved on this device.'); });
                  }}><Text style={styles.buttonText}>Export</Text></TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.smallButton, styles.dangerButton]}
                  onPress={() => setPendingDiscardId(entry.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Discard this expense"
                >
                  <Text style={styles.dangerButtonText}>Discard</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      ) : null}
      {pendingDiscardId ? (
        <ConfirmDialog
          visible
          title="Discard this expense?"
          message="This stops retries on this device. If an earlier attempt reached the server, the expense may still appear in your trip. Discarding cannot undo an expense already saved to the trip."
          confirmLabel="Discard"
          onConfirm={async () => {
            const discarded = await pendingExpenses?.discardEntry(pendingDiscardId);
            if (discarded === false) { alertMessage("Couldn't discard this expense from device storage. It is still saved; try again."); return; }
            setPendingDiscardId(null);
          }}
          onCancel={() => setPendingDiscardId(null)}
          styles={styles}
          testID="expense-pending-discard-dialog"
          useNativeModal
        />
      ) : null}
      {canImportExpenses && importExpensesVisible && trip && (
        <PlaidImportQueue
          theme={theme}
          styles={styles}
          backendUrl={backendUrl}
          jsonHeaders={jsonHeaders}
          tripId={trip.id}
          groupMembers={activeMembers.map(m => ({ id: m.id, name: formatMemberDisplayName(m) }))}
          defaultPayerId={defaultPayerId}
          onClose={() => setImportExpensesVisible(false)}
          onImported={(expense) => setExpenses(prev => [expense, ...prev])}
        />
      )}
      {expenseDraft.isOpen ? (
        <DialogShell
          visible
          title={editingExpenseId ? 'Edit Expense' : 'Add Expense'}
          styles={styles}
          // Backdrop, Escape, and the native back action must not discard a
          // partially entered expense. Cancel is the explicit discard action.
          onClose={() => undefined}
          testID="expense-add-modal"
          useNativeModal
          cardStyle={[styles.modalCard, styles.expenseModalCard]}
        >
              {receiptNotice ? (
                <Text style={[styles.helperText, themeStyle('tabs_dailyExpenses_15', {  }, (theme ?? _styleTheme))]} testID="expense-receipt-review-notice">
                  {receiptNotice}
                </Text>
              ) : null}
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.button, styles.smallButton, themeStyle('tabs_dailyExpenses_16', {  }, (theme ?? _styleTheme))]}
                  onPress={cancelAddExpenseModal}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel expense"
                  testID="expense-cancel"
                >
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.expenseModalScroll} contentContainerStyle={themeStyle('tabs_dailyExpenses_17', {  }, (theme ?? _styleTheme))}>
                <View style={styles.expenseFieldRow}>
                  <DateField
                    value={draftDate}
                    onChange={setDraftDate}
                    styles={styles}
                    theme={theme}
                    minDate={trip.startDate ?? undefined}
                    maxDate={trip.endDate ?? undefined}
                    testID="daily-expense-date"
                    accessibilityLabel="Expense date"
                    style={dateFieldStyle}
                  />
                  <SelectField
                    styles={styles}
                    value={draftCategory}
                    options={categorySelectOptions}
                    placeholder="Category"
                    title="Expense category"
                    style={categoryFieldStyle}
                    webStyle={toWebStyle(styles.input, themeStyle('expenseSelectWeb1', { toWebStyle: toWebStyle, styles: styles, narrowSelectField: narrowSelectField, webFieldBase: webFieldBase }, _styleTheme))}
                    onChange={(value) => setDraftCategory((value || 'Other') as CategoryOption)}
                  />
                  <SelectField
                    styles={styles}
                    value={draftCurrency}
                    options={currencySelectOptions}
                    placeholder="Currency"
                    title="Expense currency"
                    style={currencyFieldStyle}
                    webStyle={toWebStyle(styles.input, themeStyle('expenseSelectWeb2', { toWebStyle: toWebStyle, styles: styles, narrowSelectField: narrowSelectField, webFieldBase: webFieldBase }, _styleTheme))}
                    onChange={setDraftCurrency}
                  />
                  <DraftTextInput
                    style={amountFieldStyle}
                    placeholder="Amount"
                    keyboardType="numeric"
                    value={draftAmount}
                    onChangeText={(value: string) => setDraftAmount(sanitizeCostInput(value))}
                    commitOnBlur={false}
                  />
                </View>
                <View style={styles.expenseFieldRow}>
                  <DraftTextInput
                    style={vendorFieldStyle}
                    placeholder="Description"
                    testID="expense-description-input"
                    value={draftVendor}
                    onChangeText={setDraftVendor}
                    commitOnBlur={false}
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

                <Text style={styles.headerText}>Payer</Text>
                <PayerSelect members={activeMembers} value={draftPayerIds} onChange={setDraftPayerIds} styles={styles} testID="expense-payer" />

                <View style={styles.row}>
                  <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={saveExpense} testID="expense-save">
                    <Text style={styles.buttonText}>{editingExpenseId ? 'Save Changes' : 'Save Expense'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
        </DialogShell>
      ) : null}

      <View style={styles.divider} />
      {isNarrowLayout ? (
        <ScrollView
          testID="daily-expenses-cards"
          style={narrowCardsScrollStyle}
          contentContainerStyle={[styles.dailyExpensesVerticalContent, themeStyle('tabs_dailyExpenses_18', {  }, (theme ?? _styleTheme))]}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          {tripDates.map((date) => {
            const dayTotal = dailyTotalsByDay[date] ?? 0;
            const nonZeroCategories = categoryOptions.filter(
              (category) => (dailyTotals[date]?.[category] ?? 0) > 0,
            );
            return (
              <View
                key={date}
                style={[styles.dailyExpenseDayCard ?? styles.flightRow, dayCardStyles.card]}
                testID={`daily-expenses-card-${date}`}
              >
                <View style={dayCardStyles.headerRow}>
                  <Text style={[styles.cellText, dayCardStyles.dateLabel]}>
                    {formatDateLabel(date)}
                  </Text>
                  <Text style={[styles.cellText, dayCardStyles.dayTotal]}>
                    ${dayTotal.toFixed(2)}
                  </Text>
                </View>
                {nonZeroCategories.length ? (
                  nonZeroCategories.map((category) => {
                    const value = dailyTotals[date]?.[category] ?? 0;
                    return (
                      <TouchableOpacity
                        key={`${date}-${category}`}
                        style={dayCardStyles.categoryRow}
                        onPress={() => setDetailTarget({ date, category })}
                        testID={`expense-cell-${date}-${category}`}
                      >
                        <Text style={styles.cellText}>{category}</Text>
                        <Text style={[styles.cellText, styles.linkText]}>
                          ${value.toFixed(2)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  <Text style={[styles.helperText, dayCardStyles.emptyNote]}>
                    No expenses recorded.
                  </Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <HorizontalTableScroll
          style={styles.tableScroll}
          contentContainerStyle={styles.tableScrollContent}
        >
          <View style={styles.table} testID="daily-expenses-table">
            <View style={[styles.tableRow, styles.tableHeader]}>
              {['Date', ...categoryOptions, 'Total'].map((header, index) => (
                <View key={header} style={[styles.cell, fixedTableColumn(index === 0 ? 120 : 110), index === categoryOptions.length + 1 && styles.lastCell]}>
                  <Text style={styles.headerText}>{header}</Text>
                </View>
              ))}
            </View>
            {tripDates.map((date, idx) => (
              <View key={date} style={[styles.tableRow, idx === tripDates.length - 1 && styles.lastRow]}>
                <View style={[styles.cell, fixedTableColumn(120)]}>
                  <Text style={styles.cellText}>{formatDateLabel(date)}</Text>
                </View>
                {categoryOptions.map((category) => {
                  const value = dailyTotals[date]?.[category] ?? 0;
                  const content = value ? `$${value.toFixed(2)}` : '-';
                  return (
                    <View key={`${date}-${category}`} style={[styles.cell, fixedTableColumn(110)]}>
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
                <View style={[styles.cell, styles.lastCell, fixedTableColumn(110)]}>
                  <Text style={styles.cellText}>${(dailyTotalsByDay[date] ?? 0).toFixed(2)}</Text>
                </View>
              </View>
            ))}
          </View>
        </HorizontalTableScroll>
      )}


      {detailTarget ? (
        <DialogShell
          visible
          title={detailTarget ? `${detailTarget.category} · ${formatDateLabel(detailTarget.date)}` : 'Details'}
          styles={styles}
          onClose={() => setDetailTarget(null)}
          testID="expense-detail-modal"
          useNativeModal
          cardStyle={[styles.modalCard, styles.detailModal]}
        >
              <View style={styles.row}>
                <TouchableOpacity style={[styles.button, styles.smallButton, themeStyle('tabs_dailyExpenses_19', {  }, (theme ?? _styleTheme))]} onPress={() => setDetailTarget(null)}>
                  <Text style={styles.buttonText}>Close</Text>
                </TouchableOpacity>
              </View>
              {pendingDeleteExpense && detailItems.some((e) => e.id === pendingDeleteExpense.id) ? (
                // Inline confirm — a second stacked Modal can render behind this one on web.
                <View testID="expense-detail-delete-confirm" style={themeStyle('tabs_dailyExpenses_20', { theme: theme }, (theme ?? _styleTheme))}>
                  <Text style={styles.cellText}>Delete this ${(Number(pendingDeleteExpense.amount) || 0).toFixed(2)} expense? This cannot be undone.</Text>
                  <View style={[styles.row, themeStyle('tabs_dailyExpenses_21', {  }, (theme ?? _styleTheme))]}>
                    <TouchableOpacity testID="expense-detail-delete-confirm-yes" accessibilityRole="button" accessibilityLabel="Confirm delete" style={[styles.button, styles.smallButton, styles.tableActionButtonDanger]} onPress={() => deleteExpense(pendingDeleteExpense)}>
                      <Text style={styles.buttonText}>Delete</Text>
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" style={[styles.button, styles.smallButton]} onPress={() => setPendingDeleteExpense(null)}>
                      <Text style={styles.buttonText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
              <HorizontalTableScroll style={themeStyle('tabs_dailyExpenses_22', {  }, (theme ?? _styleTheme))} contentContainerStyle={styles.tableScrollContent}>
                <View style={[styles.table, themeStyle('tabs_dailyExpenses_23', {  }, (theme ?? _styleTheme))]}>
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    {['Description', 'For', 'Payer', 'Amount', 'Action'].map((header, index) => (
                      <View key={header} style={[styles.cell, fixedTableColumn(index === 3 ? 90 : 150), index === 4 && styles.lastCell]}>
                        <Text style={styles.headerText}>{header}</Text>
                      </View>
                    ))}
                  </View>
                  <ScrollView style={themeStyle('tabs_dailyExpenses_24', { viewportHeight: viewportHeight }, (theme ?? _styleTheme))} nestedScrollEnabled>
                    {detailItems.map((expense, index) => (
                      <View key={expense.id} style={[styles.tableRow, index === detailItems.length - 1 && styles.lastRow]}>
                        <View style={[styles.cell, fixedTableColumn(150)]}>
                          <Text style={styles.cellText}>{expense.vendor || expense.notes || '-'}</Text>
                        </View>
                        <View style={[styles.cell, fixedTableColumn(150)]}>
                          <Text style={styles.cellText}>
                            {expense.forIds.length ? expense.forIds.map((id) => memberNameMap.get(id) ?? 'Traveler').join(', ') : '-'}
                          </Text>
                        </View>
                        <View style={[styles.cell, fixedTableColumn(150)]}>
                          <Text style={styles.cellText}>
                            {expense.payerIds.length ? expense.payerIds.map((id) => memberNameMap.get(id) ?? 'Traveler').join(', ') : '-'}
                          </Text>
                        </View>
                        <View style={[styles.cell, fixedTableColumn(90)]}>
                          <Text style={styles.cellText}>${(Number(expense.amount) || 0).toFixed(2)}</Text>
                        </View>
                        <View style={[styles.cell, styles.lastCell, fixedTableColumn(150)]}>
                          <View style={[styles.actionCell, themeStyle('tabs_dailyExpenses_25', {  }, (theme ?? _styleTheme))]}>
                            <TouchableOpacity
                              style={[styles.tableActionButton, styles.tableActionButtonPrimary]}
                              onPress={() => openEditExpenseModal(expense)}
                              testID={`expense-edit-${expense.id}`}
                            >
                              <Text style={styles.buttonText}>Edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.tableActionButton, styles.tableActionButtonDanger]}
                              onPress={() => setPendingDeleteExpense(expense)}
                              testID={`expense-delete-${expense.id}`}
                            >
                              <Text style={styles.buttonText}>Delete</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    ))}
                    {!detailItems.length ? (
                      <View style={[styles.tableRow, styles.lastRow]}>
                        <View style={[styles.cell, styles.lastCell, fixedTableColumn(150)]}>
                          <Text style={styles.helperText}>No expenses recorded.</Text>
                        </View>
                      </View>
                    ) : null}
                  </ScrollView>
                </View>
              </HorizontalTableScroll>
        </DialogShell>
      ) : null}

      {pendingDeleteExpense && !detailItems.some((e) => e.id === pendingDeleteExpense.id) ? (
        // Deletes from the "Other expenses" table (no other modal open) use the standard confirm.
        // The category-detail-dialog case is handled by the inline confirm inside that dialog.
        <ConfirmDialog
          visible
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
