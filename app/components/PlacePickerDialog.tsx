import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export type PlacePickerSubmit = {
  day: number;
  name: string;
  time?: string;
  notes?: string;
};

export type PlacePickerDialogProps = {
  visible: boolean;
  defaultDay?: number;
  onSubmit: (payload: PlacePickerSubmit) => void;
  onCancel: () => void;
};

const PlacePickerDialog: React.FC<PlacePickerDialogProps> = ({ visible, defaultDay, onSubmit, onCancel }) => {
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Place name is required');
      return;
    }
    const dayNum = defaultDay != null && Number.isFinite(defaultDay) && defaultDay >= 1 ? defaultDay : 1;
    onSubmit({
      day: Math.round(dayNum),
      name: trimmedName,
      time: time.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setName('');
    setTime('');
    setNotes('');
    setError('');
  };

  const handleCancel = () => {
    setName('');
    setTime('');
    setNotes('');
    setError('');
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <Pressable style={styles.overlay} onPress={handleCancel} testID="place-dialog-overlay">
        <Pressable
          style={styles.dialog}
          onPress={(e: { stopPropagation: () => void }) => e.stopPropagation()}
          accessibilityRole={'dialog' as any}
          accessibilityLabel="Add a place"
          testID="place-dialog"
        >
          <Text style={styles.title}>Add a place</Text>
          <Text style={styles.label}>Place name</Text>
          <TextInput
            testID="place-dialog-name"
            style={styles.input}
            value={name}
            placeholder="e.g. Hagia Sophia"
            onChangeText={setName}
            autoFocus
          />
          <Text style={styles.label}>Time (optional)</Text>
          <TextInput
            testID="place-dialog-time"
            style={styles.input}
            value={time}
            placeholder="e.g. 09:00"
            onChangeText={setTime}
          />
          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            testID="place-dialog-notes"
            style={[styles.input, styles.textarea]}
            value={notes}
            placeholder="Add details for this location"
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable testID="place-dialog-cancel" style={styles.btnGhost} onPress={handleCancel}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable testID="place-dialog-submit" style={styles.btnPrimary} onPress={handleSubmit}>
              <Text style={styles.btnPrimaryText}>Add place</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: '#111827', backgroundColor: '#fff',
  },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  error: { color: '#dc2626', fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  btnGhost: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  btnGhostText: { color: '#374151', fontWeight: '600' },
  btnPrimary: { backgroundColor: '#2563eb', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
});

export default PlacePickerDialog;
