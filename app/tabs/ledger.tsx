import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { computePayerTotals } from './costReport';
import { fetchExchangeRate, getLocalDateString } from '../utils/exchangeRates';

type Trip = {
  id: string;
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
  expenseDate: string;
  category: string;
  amount: number;
  currency?: string | null;
  amountInTripCurrency?: number | null;
  exchangeRateToTripCurrency?: number | null;
  exchangeRateDate?: string | null;
  payerIds: string[];
  forIds: string[];
};

type CarRental = {
  id: string;
  cost: string;
  paidBy: string[];
  travelerIds: string[];
};

type LedgerTabProps = {
  trip: Trip | null;
  groupMembers: GroupMemberOption[];
  expenses: Expense[];
  carRentals: CarRental[];
  styles: Record<string, any>;
};

type RateEntry = { rate: number; date: string };

const LedgerTab: React.FC<LedgerTabProps> = ({ trip, groupMembers, expenses, carRentals, styles }) => {
  const [fxRates, setFxRates] = useState<Record<string, RateEntry>>({});
  const [fxMissing, setFxMissing] = useState<Set<string>>(new Set());
  const tripCurrency = (trip?.currency ?? 'USD').toUpperCase();
  const rateDate = getLocalDateString();

  const activeMembers = useMemo(
    () => groupMembers.filter((m) => m.status !== 'removed'),
    [groupMembers]
  );

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    activeMembers.forEach((m) => {
      const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim();
      map.set(m.id, name || m.guestName || m.email || 'Traveler');
    });
    return map;
  }, [activeMembers]);

  useEffect(() => {
    if (!trip) return;
    const currencies = Array.from(
      new Set(
        expenses
          .filter((expense) => expenseNeedsFx(expense))
          .map((expense) => (expense.currency ?? tripCurrency).toUpperCase())
          .filter((currency) => currency && currency !== tripCurrency)
      )
    );
    if (!currencies.length) {
      setFxRates({});
      setFxMissing(new Set());
      return;
    }
    let isMounted = true;
    Promise.all(
      currencies.map(async (currency) => {
        try {
          const rate = await fetchExchangeRate(currency, tripCurrency, rateDate);
          return { currency, rate };
        } catch {
          return { currency, rate: null };
        }
      })
    ).then((results) => {
      if (!isMounted) return;
      const nextRates: Record<string, RateEntry> = {};
      const missing = new Set<string>();
      results.forEach(({ currency, rate }) => {
        if (rate) {
          nextRates[currency] = rate;
        } else {
          missing.add(currency);
        }
      });
      setFxRates(nextRates);
      setFxMissing(missing);
    });
    return () => {
      isMounted = false;
    };
  }, [expenses, rateDate, trip, tripCurrency]);

  const memberIds = useMemo(() => activeMembers.map((m) => m.id), [activeMembers]);

  const carRentalExpenses = useMemo(() => {
    if (!carRentals.length) return [];
    return carRentals
      .map((rental) => {
        const amount = Number(rental.cost) || 0;
        if (!amount) return null;
        const payerIds = Array.isArray(rental.paidBy) ? rental.paidBy : [];
        const travelerIds = Array.isArray(rental.travelerIds) ? rental.travelerIds : [];
        const forIds = travelerIds.length ? travelerIds : payerIds.length ? payerIds : memberIds;
        return {
          id: `car-${rental.id}`,
          expenseDate: rateDate,
          category: 'Car Rentals',
          amount,
          currency: tripCurrency,
          amountInTripCurrency: amount,
          payerIds,
          forIds,
        } as Expense;
      })
      .filter(Boolean) as Expense[];
  }, [carRentals, memberIds, rateDate, tripCurrency]);

  const normalizedExpenses = useMemo(() => {
    const combined = [...expenses, ...carRentalExpenses];
    const mapped = combined.map((expense) => {
      const currency = (expense.currency ?? tripCurrency).toUpperCase();
      let amountInTripCurrency = expense.amountInTripCurrency ?? null;
      if (amountInTripCurrency == null && currency === tripCurrency) {
        amountInTripCurrency = Number(expense.amount) || 0;
      }
      if (amountInTripCurrency == null && currency !== tripCurrency) {
        const rateEntry = fxRates[currency];
        if (rateEntry) {
          amountInTripCurrency = (Number(expense.amount) || 0) * rateEntry.rate;
        } else {
          amountInTripCurrency = Number(expense.amount) || 0;
        }
      }
      return {
        ...expense,
        currency,
        amountInTripCurrency,
      };
    });
    return mapped;
  }, [carRentalExpenses, expenses, fxRates, tripCurrency]);

  const paidTotals = useMemo(
    () =>
      computePayerTotals(
        normalizedExpenses,
        (expense) => Number(expense.amountInTripCurrency) || 0,
        (expense) => expense.payerIds,
        memberIds
      ),
    [memberIds, normalizedExpenses]
  );

  const usedTotals = useMemo(
    () =>
      computePayerTotals(
        normalizedExpenses,
        (expense) => Number(expense.amountInTripCurrency) || 0,
        (expense) => expense.forIds,
        memberIds
      ),
    [memberIds, normalizedExpenses]
  );

  const roundMoney = (value: number): number => Math.round(value * 100) / 100;
  const overallPaid = roundMoney(memberIds.reduce((sum, id) => sum + (paidTotals[id] ?? 0), 0));
  const overallUsed = roundMoney(memberIds.reduce((sum, id) => sum + (usedTotals[id] ?? 0), 0));
  const overallTotal = roundMoney(overallPaid);

  const formatMoney = (value: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: tripCurrency }).format(value);

  if (!trip) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Ledger</Text>
        <Text style={styles.helperText}>Select a trip to view the ledger.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Ledger</Text>
      <Text style={styles.helperText}>Paid vs. used costs across all trip expenses.</Text>
      {fxMissing.size ? (
        <Text style={styles.helperText}>
          FX rates unavailable for: {Array.from(fxMissing).join(', ')}. Amounts may be unconverted.
        </Text>
      ) : null}
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
            <View key={memberId} style={[styles.tableRow, idx === memberIds.length - 1 && styles.lastRow]}>
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
  );
};

const expenseNeedsFx = (expense: Expense): boolean => {
  const currency = (expense.currency ?? '').toUpperCase();
  if (!currency) return false;
  return expense.amountInTripCurrency == null;
};

export default LedgerTab;
