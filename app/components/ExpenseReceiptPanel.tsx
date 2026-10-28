import React, { useEffect, useRef, useState } from 'react';
import { Image, Linking, Platform, Text, TouchableOpacity, View } from 'react-native';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';

type Props = {
  backendUrl: string;
  headers: Record<string, string>;
  expenseId: string;
  title: string;
  hasReceipt: boolean;
  /** Attaching, replacing and removing; the picker is a web file input, like Scan Receipt. */
  canEdit: boolean;
  onChanged: (hasReceipt: boolean) => void;
  onClose: () => void;
  styles: Record<string, any>;
};

/** The stored receipt image for one expense: view it, attach or replace it, remove it. */
const ExpenseReceiptPanel: React.FC<Props> = ({ backendUrl, headers, expenseId, title, hasReceipt, canEdit, onChanged, onClose, styles }) => {
  const _styleTheme = useStyleTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<any>(null);
  const base = `${backendUrl}/api/expenses/${encodeURIComponent(expenseId)}/receipt`;

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    if (!hasReceipt) return undefined;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(base, { headers });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.url) setUrl(String(data.url));
        else setError(data.error || 'The receipt image is unavailable.');
      } catch {
        if (!cancelled) setError('The receipt image is unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // headers is rebuilt by the caller on every render; the expense and whether it has a receipt decide when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, hasReceipt]);

  const upload = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('image', file);
      const uploadHeaders = { ...headers };
      delete uploadHeaders['Content-Type'];
      delete uploadHeaders['content-type'];
      const res = await fetch(base, { method: 'PUT', headers: uploadHeaders, body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Unable to save the receipt image.');
        return;
      }
      onChanged(true);
    } catch (err) {
      setError((err as Error).message || 'Unable to save the receipt image.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, { method: 'DELETE', headers });
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Unable to remove the receipt image.');
        return;
      }
      onChanged(false);
    } catch (err) {
      setError((err as Error).message || 'Unable to remove the receipt image.');
    } finally {
      setBusy(false);
    }
  };

  const openFull = () => {
    if (!url) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    else void Linking.openURL(url);
  };

  return (
    <View testID="expense-receipt-panel">
      <Text style={styles.headerText}>Receipt · {title}</Text>
      {loading ? <Text style={styles.helperText}>Loading receipt…</Text> : null}
      {url ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open the receipt image in full size" onPress={openFull} testID="expense-receipt-open">
          <Image source={{ uri: url }} accessibilityLabel={`Receipt for ${title}`} style={themeStyle('components_ExpenseReceiptPanel_2', {  }, _styleTheme)} resizeMode="contain" />
        </TouchableOpacity>
      ) : null}
      {!hasReceipt && !loading ? <Text style={styles.helperText}>No receipt stored for this expense.</Text> : null}
      {error ? <Text style={styles.warningText} testID="expense-receipt-error">{error}</Text> : null}
      <View style={styles.row}>
        {canEdit && Platform.OS === 'web' ? (
          <>
            <TouchableOpacity style={[styles.button, styles.smallButton, busy && styles.buttonDisabled]} disabled={busy} onPress={() => fileInputRef.current?.click?.()} testID="expense-receipt-attach">
              <Text style={styles.buttonText}>{busy ? 'Saving…' : hasReceipt ? 'Replace' : 'Attach receipt'}</Text>
            </TouchableOpacity>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => upload(event.target.files?.[0])}
              style={themeStyle('components_ExpenseReceiptPanel_1', {  }, _styleTheme)}
              data-testid="expense-receipt-file-input"
            />
          </>
        ) : null}
        {canEdit && hasReceipt ? (
          <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton, busy && styles.buttonDisabled]} disabled={busy} onPress={remove} testID="expense-receipt-remove">
            <Text style={styles.dangerButtonText}>Remove</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={onClose} testID="expense-receipt-close">
          <Text style={styles.buttonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default ExpenseReceiptPanel;
