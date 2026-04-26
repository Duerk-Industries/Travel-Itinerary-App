import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export type NoteSubmit = {
  day: number;
  title: string;
  body: string;
};

export type NoteInputDialogProps = {
  visible: boolean;
  defaultDay?: number;
  onSubmit: (payload: NoteSubmit) => void;
  onCancel: () => void;
};

const NoteInputDialog: React.FC<NoteInputDialogProps> = ({ visible, defaultDay, onSubmit, onCancel }) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const t = title.trim();
    const b = body.trim();
    if (!t) {
      setError('Title is required');
      return;
    }
    if (!b) {
      setError('Note body is required');
      return;
    }
    const dayNum = defaultDay != null && Number.isFinite(defaultDay) && defaultDay >= 1 ? defaultDay : 1;
    onSubmit({ day: Math.round(dayNum), title: t, body: b });
    setTitle('');
    setBody('');
    setError('');
  };

  const handleCancel = () => {
    setTitle('');
    setBody('');
    setError('');
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <Pressable style={styles.overlay} onPress={handleCancel} testID="note-dialog-overlay">
        <Pressable
          style={styles.dialog}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="dialog"
          accessibilityLabel="Add a note"
          testID="note-dialog"
        >
          <Text style={styles.title}>Add a note</Text>
          <Text style={styles.label}>Title</Text>
          <TextInput
            testID="note-dialog-title"
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Short label"
            autoFocus
          />
          <Text style={styles.label}>Body</Text>
          <TextInput
            testID="note-dialog-body"
            style={[styles.input, styles.textarea]}
            value={body}
            onChangeText={setBody}
            placeholder="Free-form note text. Line breaks are preserved."
            multiline
            numberOfLines={5}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable testID="note-dialog-cancel" style={styles.btnGhost} onPress={handleCancel}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable testID="note-dialog-submit" style={styles.btnPrimary} onPress={handleSubmit}>
              <Text style={styles.btnPrimaryText}>Add note</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 460, backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: '#111827', backgroundColor: '#fff',
  },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  error: { color: '#dc2626', fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  btnGhost: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  btnGhostText: { color: '#374151', fontWeight: '600' },
  btnPrimary: { backgroundColor: '#2563eb', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
});

export default NoteInputDialog;
