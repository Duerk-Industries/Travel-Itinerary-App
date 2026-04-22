import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';

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
  testID?: string;
};

const todayIsoDate = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const PaymentDialog: React.FC<PaymentDialogProps> = ({
  visible,
  onCancel,
  onSave,
  sortedIds,
  participantLabel,
  defaultPayerId,
  styles,
  testID,
}) => {
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
    if (Platform.OS === 'web') {
      return (
        <View style={{ gap: 4 }}>
          <Text style={styles.headerText}>{label}</Text>
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{
              ...toWebStyle(styles.input),
              width: '100%',
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
            data-testid={`${testIdPrefix}-select`}
          >
            {options.map((id) => (
              <option key={id} value={id}>
                {participantLabel(id)}
              </option>
            ))}
          </select>
        </View>
      );
    }
    return (
      <View style={{ gap: 4 }}>
        <Text style={styles.headerText}>{label}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {options.map((id) => {
            const selected = id === value;
            return (
              <TouchableOpacity
                key={`${testIdPrefix}-${id}`}
                style={[
                  styles.expenseToggleButton,
                  selected ? styles.expenseToggleSelected : styles.expenseToggleUnselected,
                ]}
                onPress={() => setValue(id)}
                testID={`${testIdPrefix}-${id}`}
              >
                <Text style={[styles.expenseToggleText, selected && styles.expenseToggleTextSelected]}>
                  {participantLabel(id)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay} testID={testID ?? 'payment-dialog'}>
        <View style={[styles.modalCard, styles.expenseModalCard]}>
          <View style={styles.row}>
            <Text style={styles.sectionTitle}>Record Payment</Text>
            <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={onCancel}>
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
            <View style={{ gap: 4 }}>
              <Text style={styles.headerText}>Payment Date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={paymentDate}
                  max={todayStr}
                  onChange={(event) => setPaymentDate(event.target.value)}
                  style={{
                    ...toWebStyle(styles.input),
                    width: '100%',
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                  }}
                  data-testid="payment-date-input"
                />
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="YYYY-MM-DD"
                  value={paymentDate}
                  onChangeText={setPaymentDate}
                />
              )}
            </View>

            {renderDropdown('Payer', payerId, setPayerId, payerOptions, 'payment-payer')}
            {renderDropdown('Receiver', receiverId, setReceiverId, receiverOptions, 'payment-receiver')}

            <View style={{ gap: 4 }}>
              <Text style={styles.headerText}>Amount</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={amount}
                onChangeText={(text: string) => setAmount(sanitizeCostInput(text))}
                testID="payment-amount-input"
              />
            </View>

            {error ? <Text style={styles.errorText ?? { color: 'red' }}>{error}</Text> : null}

            <View style={[styles.row, { gap: 8 }]}>
              <TouchableOpacity
                style={[styles.button, styles.smallButton]}
                onPress={handleSave}
                disabled={saving}
                testID="payment-save"
              >
                <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save Payment'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.smallButton, styles.dangerButton]}
                onPress={onCancel}
                disabled={saving}
              >
                <Text style={styles.dangerButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default PaymentDialog;
