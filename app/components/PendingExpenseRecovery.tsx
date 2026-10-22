import React, { useState } from 'react';
import { Platform, TextInput, TouchableOpacity, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../theme/ThemeContext';
import { exportCsv } from '../utils/csvExport';
import { readRecoveryFile } from '../utils/pendingQueueRepair';
import type { RepairOutcome } from '../hooks/usePendingWrites';

type Props = {
  error: string | null;
  getRecoveryData: () => Promise<string | null>;
  ownerId: string;
  environment: string;
  /** Rebuilds the queue from readable entries plus any recovery files. Omitted: export only. */
  repairQueue?: (extraRecoveryData: string[]) => Promise<RepairOutcome>;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const describe = (outcome: RepairOutcome): string => {
  if (outcome.status === 'failed') return 'Repair did not complete, so nothing was changed. Your saved expenses are still kept on this device. Try again.';
  if (outcome.status === 'nothing-recoverable') {
    return `No expenses could be recovered${outcome.skipped ? ` (${plural(outcome.skipped, 'entry was', 'entries were')} unreadable)` : ''}. Nothing was changed and the original is still kept. Keep your exported copy.`;
  }
  const parts = [`Recovered ${plural(outcome.restored, 'expense', 'expenses')}. They will sync automatically when you are online.`];
  if (outcome.alreadyHandled) parts.push(`${plural(outcome.alreadyHandled, 'was', 'were')} already synced or discarded and was not added again.`);
  if (outcome.skipped) parts.push(`${plural(outcome.skipped, 'entry', 'entries')} could not be read; they remain in the backup kept on this device and in your exported copy.`);
  return parts.join(' ');
};

const FILE_PROBLEMS = {
  unrecognized: 'That is not a recovery file from this app.',
  'wrong-account': 'That recovery file belongs to a different account, so it was not used.',
  'wrong-environment': 'That recovery file is from a different version of the app (a different server), so it was not used.',
} as const;

export default function PendingExpenseRecovery({ error, getRecoveryData, ownerId, environment, repairQueue }: Props) {
  const { colors } = useAppTheme();
  const [notice, setNotice] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState<string | null>(null);
  // Once repaired the error clears, but the person still needs to read what happened.
  if (!error && !result) return null;

  const runRepair = async (extra: string[]) => {
    if (!repairQueue || busy) return;
    setBusy(true);
    try { setResult(describe(await repairQueue(extra))); setPasted(''); }
    finally { setBusy(false); }
  };
  const restoreFrom = async (text: string) => {
    const file = readRecoveryFile(text, ownerId, environment);
    if (!file.ok) { setNotice(FILE_PROBLEMS[file.reason]); return; }
    setNotice(null);
    await runRepair([file.raw]);
  };
  const chooseFile = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.csv,.json,.txt,text/csv,application/json,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 6_000_000) { setNotice('That file is too large to be a recovery file.'); return; }
      void file.text().then(restoreFrom).catch(() => setNotice('That file could not be read.'));
    };
    input.click();
  };

  const button = (label: string, onPress: () => void, testID: string, disabled = false) => (
    <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy}
      style={{ minHeight: 44, padding: 8, justifyContent: 'center', opacity: disabled || busy ? 0.5 : 1 }} onPress={onPress}>
      <Text>{label}</Text>
    </TouchableOpacity>
  );

  return <View style={{ padding: 12 }}>
    {error ? <>
      <Text accessibilityRole="alert">{error}</Text>
      <Text>Export a recovery copy before changing device storage. It contains private financial data. Keep its operation keys when recovering expenses to prevent duplicate charges in your trip ledger.</Text>
      {button('Export saved expense recovery data', () => void (async () => {
        try {
          const raw = await getRecoveryData();
          if (raw === null) throw new Error('Unavailable');
          const envelope = JSON.stringify({ schemaVersion: 1, kind: 'pending-expense-recovery', ownerId, environment, raw });
          const outcome = await exportCsv(`Saved expense queue recovery\n"${envelope.replace(/"/g, '""')}"`, 'expense-queue-recovery.csv');
          const ok = outcome === 'downloaded' || outcome === 'shared';
          setExported(ok);
          setNotice(ok ? 'Recovery copy exported. The original is still kept on this device.' : 'Could not export. The original is still kept; try again.');
        } catch { setNotice('Could not read the recovery copy. The original has not been removed. Try again when device storage is available.'); }
      })(), 'expense-recovery-export')}
      {repairQueue ? <>
        <Text style={{ marginTop: 8 }}>Repair keeps every expense that can still be read, with the same operation keys, and puts the original in a backup on this device. Nothing is deleted. Export first so you also have a copy.</Text>
        {button('Repair saved expenses', () => { if (exported) void runRepair([]); }, 'expense-recovery-repair', !exported)}
        <Text style={{ marginTop: 8 }}>Or restore from a recovery file you exported earlier. It must be from this account.</Text>
        {Platform.OS === 'web' ? button('Choose a recovery file', chooseFile, 'expense-recovery-choose-file') : null}
        <TextInput testID="expense-recovery-paste" multiline value={pasted} onChangeText={setPasted} placeholder="Or paste the file contents here" placeholderTextColor={colors.textMuted}
          accessibilityLabel="Recovery file contents" autoCapitalize="none" autoCorrect={false} style={{ minHeight: 64, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8 }} />
        {button('Restore from pasted contents', () => void restoreFrom(pasted), 'expense-recovery-restore', !pasted.trim())}
      </> : null}
    </> : null}
    {result ? <Text testID="expense-recovery-result" accessibilityLiveRegion="polite">{result}</Text> : null}
    {notice && <Text accessibilityLiveRegion="polite">{notice}</Text>}
  </View>;
}
