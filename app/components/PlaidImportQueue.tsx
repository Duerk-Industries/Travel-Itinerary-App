import { resolveComponentTheme as resolveStyleTheme, themeStyle, AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';

import DialogShell from './DialogShell';
import SelectField from './SelectField';

export type PlaidCandidate = {
  id: string;
  itemId: string;
  accountId: string;
  amount: number;
  isoCurrencyCode: string;
  date: string;
  merchantName: string | null;
  personalFinanceCategory: string | null;
  pending: boolean;
};

type PlaidImportQueueProps = {
  theme: AppTheme;
  styles: Record<string, any>;
  backendUrl: string;
  jsonHeaders: Record<string, string>;
  tripId: string;
  groupMembers: Array<{ id: string; name: string }>;
  defaultPayerId: string | null;
  onClose: () => void;
  onImported: (expense: any) => void;
};

const PlaidImportQueue: React.FC<PlaidImportQueueProps> = ({
  theme: _providedTheme,
  styles,
  backendUrl,
  jsonHeaders,
  tripId,
  groupMembers,
  defaultPayerId,
  onClose,
  onImported,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const { colors, typography, spacing } = theme;
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<PlaidCandidate[]>([]);
  const [importingId, setImportingId] = useState<string | null>(null);

  const fetchCandidates = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/api/plaid/candidates`, { headers: jsonHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch candidates');
      setCandidates(data.candidates);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCandidates();
  }, []);

  const handleAssign = async (candidate: PlaidCandidate) => {
    setImportingId(candidate.id);
    try {
      const res = await fetch(`${backendUrl}/api/plaid/assign`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          transactionId: candidate.id,
          tripId,
          category: 'Other', // In a real UI, let the user pick
          payerIds: defaultPayerId ? [defaultPayerId] : [],
          forIds: groupMembers.map((m) => m.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assign transaction');

      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
      onImported(data);
      Alert.alert('Success', 'Transaction imported as expense.');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setImportingId(null);
    }
  };

  return (
    <DialogShell
      styles={styles}
      title="Import Expenses"
      visible={true}
      onClose={onClose}
    >
      {loading ? (
        <ActivityIndicator size="large" color={colors.link} style={themeStyle('components_PlaidImportQueue_1', { spacing: spacing }, (theme ?? _styleTheme))} />
      ) : candidates.length === 0 ? (
        <View style={themeStyle('components_PlaidImportQueue_2', { spacing: spacing }, (theme ?? _styleTheme))}>
          <Text style={themeStyle('components_PlaidImportQueue_3', { colors: colors, typography: typography }, (theme ?? _styleTheme))}>No new transactions found.</Text>
        </View>
      ) : (
        <ScrollView style={themeStyle('components_PlaidImportQueue_4', {  }, (theme ?? _styleTheme))}>
          {candidates.map((c) => (
            <View
              key={c.id}
              style={themeStyle('components_PlaidImportQueue_5', { spacing: spacing, colors: colors }, (theme ?? _styleTheme))}
            >
              <View style={themeStyle('components_PlaidImportQueue_6', {  }, (theme ?? _styleTheme))}>
                <Text style={themeStyle('components_PlaidImportQueue_7', { colors: colors }, (theme ?? _styleTheme))}>{c.merchantName || 'Unknown Merchant'}</Text>
                <Text style={themeStyle('components_PlaidImportQueue_8', { typography: typography, colors: colors }, (theme ?? _styleTheme))}>
                  {c.date} • {c.personalFinanceCategory || 'Uncategorized'}
                </Text>
              </View>
              <View style={themeStyle('components_PlaidImportQueue_9', { spacing: spacing }, (theme ?? _styleTheme))}>
                <Text style={themeStyle('components_PlaidImportQueue_10', { colors: colors }, (theme ?? _styleTheme))}>
                  {c.amount} {c.isoCurrencyCode}
                </Text>
                <TouchableOpacity
                  onPress={() => handleAssign(c)}
                  disabled={importingId === c.id}
                  style={themeStyle('components_PlaidImportQueue_11', { colors: colors, spacing: spacing }, (theme ?? _styleTheme))}
                >
                  {importingId === c.id ? (
                    <ActivityIndicator size="small" color={themeStyle('components_PlaidImportQueue_13', {  }, (theme ?? _styleTheme))} />
                  ) : (
                    <Text style={themeStyle('components_PlaidImportQueue_12', { typography: typography }, (theme ?? _styleTheme))}>Import</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </DialogShell>
  );
};

export default PlaidImportQueue;
