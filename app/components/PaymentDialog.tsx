import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import SelectField from './SelectField';
import React, { memo, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import DialogShell from './DialogShell';
import DateField from './DateField';
import DraftTextInput from './DraftTextInput';


type Participant = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  userEmail?: string | null;
};

type PaymentDialogProps = {
  visible: boolean;
  onCancel: () => void;
  onSave: (draft: { payerId: string; receiverId: string; paymentDate: string; amount: number }) => Promise<void> | void;
  participants: Participant[];
  sortedIds: string[];
  participantLabel: (id: string) => string;
  defaultPayerId: string | null;
  styles: Record<string, any>;
  theme?: AppTheme;
  testID?: string;
};

const todayIsoDate = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const PaymentDialogComponent: React.FC<PaymentDialogProps> = ({
  visible,
  onCancel,
  onSave,
  sortedIds,
  participantLabel,
  defaultPayerId,
  styles,
  theme: _providedTheme,
  testID,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const initialPayer = useMemo(() => {
    if (defaultPayerId && sortedIds.includes(defaultPayerId)) return defaultPayerId;
    return sortedIds[0] ?? '';
  }, [defaultPayerId, sortedIds]);

  const initialReceiver = useMemo(() => {
    const firstOther = sortedIds.find((id) => id !== initialPayer);
    return firstOther ?? '';
  }, [sortedIds, initialPayer]);

  const [payerId, setPayerId] = useState<string>(initialPayer);
  const [receiverId, setReceiverId] = useState<string>(initialReceiver);
  const [paymentDate, setPaymentDate] = useState<string>(todayIsoDate());
  const [amount, setAmount] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setPayerId(initialPayer);
      setReceiverId(initialReceiver);
      setPaymentDate(todayIsoDate());
      setAmount('');
      setError(null);
      setSaving(false);
    }
  }, [visible, initialPayer, initialReceiver]);

  if (!visible) return null;

  const todayStr = todayIsoDate();
  const payerOptions = sortedIds;
  const receiverOptions = sortedIds;

  const handleSave = async () => {
    setError(null);
    if (!payerId || !receiverId) {
      setError('Payer and receiver are required.');
      return;
    }
    if (payerId === receiverId) {
      setError('Payer and receiver must be different travelers.');
      return;
    }
    if (!paymentDate) {
      setError('Payment date is required.');
      return;
    }
    if (paymentDate > todayStr) {
      setError('Future-dated payments are not allowed.');
      return;
    }
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    setSaving(true);
    try {
      await onSave({ payerId, receiverId, paymentDate, amount: numeric });
    } catch (err: any) {
      setError(err?.message || 'Failed to save payment.');
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  const renderDropdown = (
    label: string,
    value: string,
    setValue: (id: string) => void,
    options: string[],
    testIdPrefix: string
  ) => {
    return (
      <View style={themeStyle('components_PaymentDialog_1', {  }, (theme ?? _styleTheme))}>
        <Text style={styles.headerText}>{label}</Text>
        <SelectField styles={styles} title={label} testID={`${testIdPrefix}-select`} value={value}
          options={options.map(id => ({ value: id, label: participantLabel(id) })).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }))}
          onChange={id => { if (id) setValue(id); }} />
      </View>
    );
  };

  return (
    <DialogShell
      visible={visible}
      title="Record Payment"
      styles={styles}
      onClose={onCancel}
      testID={testID ?? 'payment-dialog'}
      useNativeModal
      overlayStyle={themeStyle('components_PaymentDialog_2', {  }, (theme ?? _styleTheme))}
      cardStyle={[styles.modalCard, styles.expenseModalCard]}
    >
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.button, styles.smallButton, themeStyle('components_PaymentDialog_3', {  }, (theme ?? _styleTheme))]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Close payment dialog"
            >
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={themeStyle('components_PaymentDialog_4', {  }, (theme ?? _styleTheme))} contentContainerStyle={themeStyle('components_PaymentDialog_5', {  }, (theme ?? _styleTheme))}>
            <View style={themeStyle('components_PaymentDialog_6', {  }, (theme ?? _styleTheme))}>
              <Text style={styles.headerText}>Payment Date</Text>
              <DateField
                value={paymentDate}
                onChange={setPaymentDate}
                maxDate={todayStr}
                styles={styles}
                theme={theme}
                testID="payment-date-input"
                accessibilityLabel="Payment date"
              />
            </View>

            {renderDropdown('Payer', payerId, setPayerId, payerOptions, 'payment-payer')}
            {renderDropdown('Receiver', receiverId, setReceiverId, receiverOptions, 'payment-receiver')}

            <View style={themeStyle('components_PaymentDialog_7', {  }, (theme ?? _styleTheme))}>
              <Text style={styles.headerText}>Amount</Text>
              <DraftTextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={amount}
                onChangeText={(text: string) => setAmount(sanitizeCostInput(text))}
                commitOnBlur={false}
                testID="payment-amount-input"
                accessibilityLabel="Payment amount"
              />
            </View>

            {error ? <Text style={styles.errorText ?? themeStyle('components_PaymentDialog_8', {  }, (theme ?? _styleTheme))}>{error}</Text> : null}

            <View style={[styles.row, themeStyle('components_PaymentDialog_9', {  }, (theme ?? _styleTheme))]}>
              <TouchableOpacity
                style={[styles.button, styles.smallButton]}
                onPress={handleSave}
                disabled={saving}
                testID="payment-save"
                accessibilityRole="button"
                accessibilityLabel={saving ? 'Saving payment' : 'Save payment'}
                accessibilityState={{ disabled: saving }}
              >
                <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save Payment'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.smallButton, styles.dangerButton]}
                onPress={onCancel}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                accessibilityState={{ disabled: saving }}
              >
                <Text style={styles.dangerButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
    </DialogShell>
  );
};

const PaymentDialog = memo(PaymentDialogComponent);

export default PaymentDialog;
