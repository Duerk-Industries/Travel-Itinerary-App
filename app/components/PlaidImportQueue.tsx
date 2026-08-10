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
import { AppTheme } from '../theme/theme';
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
  backendUrl: string;
  jsonHeaders: Record<string, string>;
  tripId: string;
  groupMembers: Array<{ id: string; name: string }>;
  defaultPayerId: string | null;
  onClose: () => void;
  onImported: (expense: any) => void;
};

const PlaidImportQueue: React.FC<PlaidImportQueueProps> = ({
  theme,
  backendUrl,
  jsonHeaders,
  tripId,
  groupMembers,
  defaultPayerId,
  onClose,
  onImported,
}) => {
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
      theme={theme}
      title="Import Expenses"
      visible={true}
      onClose={onClose}
    >
      {loading ? (
        <ActivityIndicator size="large" color={colors.link} style={{ padding: spacing.xl }} />
      ) : candidates.length === 0 ? (
        <View style={{ padding: spacing.xl, alignItems: 'center' }}>
          <Text style={{ color: colors.textMuted, fontSize: typography.body }}>No new transactions found.</Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 500 }}>
          {candidates.map((c) => (
            <View
              key={c.id}
              style={{
                padding: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: 'bold', color: colors.text }}>{c.merchantName || 'Unknown Merchant'}</Text>
                <Text style={{ fontSize: typography.small, color: colors.textMuted }}>
                  {c.date} • {c.personalFinanceCategory || 'Uncategorized'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', marginLeft: spacing.md }}>
                <Text style={{ fontWeight: 'bold', color: colors.text }}>
                  {c.amount} {c.isoCurrencyCode}
                </Text>
                <TouchableOpacity
                  onPress={() => handleAssign(c)}
                  disabled={importingId === c.id}
                  style={{
                    backgroundColor: colors.cta,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    borderRadius: 4,
                    marginTop: spacing.xs,
                  }}
                >
                  {importingId === c.id ? (
                    <ActivityIndicator size="small" color="#0B1726" />
                  ) : (
                    <Text style={{ color: '#0B1726', fontWeight: 'bold', fontSize: typography.small }}>Import</Text>
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
