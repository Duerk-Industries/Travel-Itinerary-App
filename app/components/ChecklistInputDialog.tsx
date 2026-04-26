import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

export type ChecklistSubmit = {
  day: number;
  title: string;
  items: Array<{ label: string }>;
};

export type ChecklistInputDialogProps = {
  visible: boolean;
  defaultDay?: number;
  onSubmit: (payload: ChecklistSubmit) => void;
  onCancel: () => void;
};

const ChecklistInputDialog: React.FC<ChecklistInputDialogProps> = ({
  visible,
  defaultDay,
  onSubmit,
  onCancel,
}) => {
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<string[]>(['', '']);
  const [error, setError] = useState('');

  const updateItem = (idx: number, value: string) =>
    setItems((prev) => prev.map((v, i) => (i === idx ? value : v)));

  const addItem = () => setItems((prev) => [...prev, '']);

  const removeItem = (idx: number) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));

  const handleSubmit = () => {
    const t = title.trim();
    if (!t) {
      setError('Title is required');
      return;
    }
    const cleaned = items
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ label }));
    if (!cleaned.length) {
      setError('Add at least one checklist item');
      return;
    }
    const dayNum = defaultDay != null && Number.isFinite(defaultDay) && defaultDay >= 1 ? defaultDay : 1;
    onSubmit({ day: Math.round(dayNum), title: t, items: cleaned });
    setTitle('');
    setItems(['', '']);
    setError('');
  };

  const handleCancel = () => {
    setTitle('');
    setItems(['', '']);
    setError('');
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <Pressable style={styles.overlay} onPress={handleCancel} testID="checklist-dialog-overlay">
        <Pressable
          style={styles.dialog}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="dialog"
          accessibilityLabel="Add a checklist"
          testID="checklist-dialog"
        >
          <Text style={styles.title}>Add a checklist</Text>
          <Text style={styles.label}>Title</Text>
          <TextInput
            testID="checklist-dialog-title"
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Packing list"
            autoFocus
          />
          <Text style={[styles.label, { marginTop: 8 }]}>Items</Text>
          <ScrollView style={styles.itemsScroll} keyboardShouldPersistTaps="handled">
            {items.map((value, idx) => (
              <View key={idx} style={styles.itemRow}>
                <TextInput
                  testID={`checklist-dialog-item-${idx}`}
                  style={[styles.input, { flex: 1 }]}
                  value={value}
                  onChangeText={(v) => updateItem(idx, v)}
                  placeholder={`Item ${idx + 1}`}
                />
                <Pressable
                  testID={`checklist-dialog-remove-${idx}`}
                  onPress={() => removeItem(idx)}
                  style={styles.removeBtn}
                  accessibilityLabel={`Remove item ${idx + 1}`}
                >
                  <Text style={styles.removeBtnText}>−</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
          <Pressable
            testID="checklist-dialog-add-item"
            onPress={addItem}
            style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
          >
            <Text style={styles.addBtnText}>+ Add another item</Text>
          </Pressable>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable testID="checklist-dialog-cancel" style={styles.btnGhost} onPress={handleCancel}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable testID="checklist-dialog-submit" style={styles.btnPrimary} onPress={handleSubmit}>
              <Text style={styles.btnPrimaryText}>Add checklist</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 460, backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: '#111827', backgroundColor: '#fff',
  },
  itemsScroll: { maxHeight: 220 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  removeBtn: {
    width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.1)', borderWidth: 1, borderColor: 'rgba(220, 38, 38, 0.4)',
  },
  removeBtnText: { fontSize: 18, fontWeight: '700', color: '#dc2626', lineHeight: 18 },
  addBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6, alignSelf: 'flex-start' },
  addBtnPressed: { backgroundColor: 'rgba(0,0,0,0.06)' },
  addBtnText: { color: '#2563eb', fontWeight: '600' },
  error: { color: '#dc2626', fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  btnGhost: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  btnGhostText: { color: '#374151', fontWeight: '600' },
  btnPrimary: { backgroundColor: '#2563eb', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
});

export default ChecklistInputDialog;
