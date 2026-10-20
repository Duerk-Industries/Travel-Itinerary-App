import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { exportCsv } from '../utils/csvExport';

export default function PendingExpenseRecovery({ error, getRecoveryData, ownerId, environment }: {
  error: string | null; getRecoveryData: () => Promise<string | null>; ownerId: string; environment: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  if (!error) return null;
  return <View style={{ padding: 12 }}>
    <Text accessibilityRole="alert">{error}</Text>
    <Text>Export a recovery copy before changing device storage. It contains private financial data. Keep its operation keys when recovering expenses to prevent duplicate charges in your trip ledger.</Text>
    <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, padding: 8 }} onPress={() => void (async () => {
      try {
        const raw = await getRecoveryData();
        if (raw === null) throw new Error('Unavailable');
        const envelope = JSON.stringify({ schemaVersion: 1, kind: 'pending-expense-recovery', ownerId, environment, raw });
        const result = await exportCsv(`Saved expense queue recovery\n"${envelope.replace(/"/g, '""')}"`, 'expense-queue-recovery.csv');
        setNotice(result === 'downloaded' || result === 'shared' ? 'Recovery copy exported. The original is still kept on this device.' : 'Could not export. The original is still kept; try again.');
      } catch { setNotice('Could not read the recovery copy. The original has not been removed. Try again when device storage is available.'); }
    })()}><Text>Export saved expense recovery data</Text></TouchableOpacity>
    {notice && <Text accessibilityLiveRegion="polite">{notice}</Text>}
  </View>;
}
