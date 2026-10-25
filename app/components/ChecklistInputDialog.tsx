import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Modal from './KeyboardAwareModal';


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
  theme?: AppTheme;
};

const ChecklistInputDialog: React.FC<ChecklistInputDialogProps> = ({
  visible,
  defaultDay,
  onSubmit,
  onCancel,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<string[]>(['', '']);
  const [error, setError] = useState('');
  const colors = theme?.colors;

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
      <Pressable style={styles((theme ?? _styleTheme)).overlay} onPress={handleCancel} testID="checklist-dialog-overlay">
        <Pressable
          style={[styles((theme ?? _styleTheme)).dialog, colors && themeStyle('components_ChecklistInputDialog_1', { colors: colors }, (theme ?? _styleTheme))]}
          onPress={(e: { stopPropagation: () => void }) => e.stopPropagation()}
          accessibilityRole={'dialog' as any}
          accessibilityLabel="Add a checklist"
          testID="checklist-dialog"
        >
          <Text style={[styles((theme ?? _styleTheme)).title, colors && themeStyle('components_ChecklistInputDialog_2', { colors: colors }, (theme ?? _styleTheme))]}>Add a checklist</Text>
          <Text style={[styles((theme ?? _styleTheme)).label, colors && themeStyle('components_ChecklistInputDialog_3', { colors: colors }, (theme ?? _styleTheme))]}>Title</Text>
          <TextInput
            testID="checklist-dialog-title"
            style={[styles((theme ?? _styleTheme)).input, colors && themeStyle('components_ChecklistInputDialog_4', { colors: colors }, (theme ?? _styleTheme))]}
            placeholderTextColor={colors?.textMuted}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Packing list"
            autoFocus
          />
          <Text style={[styles((theme ?? _styleTheme)).label, themeStyle('components_ChecklistInputDialog_5', {  }, (theme ?? _styleTheme)), colors && themeStyle('components_ChecklistInputDialog_6', { colors: colors }, (theme ?? _styleTheme))]}>Items</Text>
          <ScrollView style={styles((theme ?? _styleTheme)).itemsScroll} keyboardShouldPersistTaps="handled">
            {items.map((value, idx) => (
              <View key={idx} style={styles((theme ?? _styleTheme)).itemRow}>
                <TextInput
                  testID={`checklist-dialog-item-${idx}`}
                  style={[styles((theme ?? _styleTheme)).input, themeStyle('components_ChecklistInputDialog_7', {  }, (theme ?? _styleTheme)), colors && themeStyle('components_ChecklistInputDialog_8', { colors: colors }, (theme ?? _styleTheme))]}
                  placeholderTextColor={colors?.textMuted}
                  value={value}
                  onChangeText={(v: string) => updateItem(idx, v)}
                  placeholder={`Item ${idx + 1}`}
                />
                <Pressable
                  testID={`checklist-dialog-remove-${idx}`}
                  onPress={() => removeItem(idx)}
                  style={styles((theme ?? _styleTheme)).removeBtn}
                  accessibilityLabel={`Remove item ${idx + 1}`}
                  hitSlop={themeStyle('components_ChecklistInputDialog_9', {  }, (theme ?? _styleTheme))}
                >
                  <Text style={[styles((theme ?? _styleTheme)).removeBtnText, theme?.mode === 'dark' && themeStyle('components_ChecklistInputDialog_10', {  }, (theme ?? _styleTheme))]}>−</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
          <Pressable
            testID="checklist-dialog-add-item"
            onPress={addItem}
            style={({ pressed }: { pressed: boolean }) => [styles((theme ?? _styleTheme)).addBtn, pressed && themeStyle('components_ChecklistInputDialog_11', { colors: colors }, (theme ?? _styleTheme))]}
          >
            <Text style={[styles((theme ?? _styleTheme)).addBtnText, colors && themeStyle('components_ChecklistInputDialog_12', { theme: theme, colors: colors }, (theme ?? _styleTheme))]}>+ Add another item</Text>
          </Pressable>
          {error ? <Text style={[styles((theme ?? _styleTheme)).error, theme?.mode === 'dark' && themeStyle('components_ChecklistInputDialog_13', {  }, (theme ?? _styleTheme))]}>{error}</Text> : null}
          <View style={styles((theme ?? _styleTheme)).actions}>
            <Pressable testID="checklist-dialog-cancel" style={styles((theme ?? _styleTheme)).btnGhost} onPress={handleCancel}>
              <Text style={[styles((theme ?? _styleTheme)).btnGhostText, colors && themeStyle('components_ChecklistInputDialog_14', { colors: colors }, (theme ?? _styleTheme))]}>Cancel</Text>
            </Pressable>
            <Pressable testID="checklist-dialog-submit" style={styles((theme ?? _styleTheme)).btnPrimary} onPress={handleSubmit}>
              <Text style={styles((theme ?? _styleTheme)).btnPrimaryText}>Add checklist</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_ChecklistInputDialog_15', { StyleSheet: StyleSheet }, _theme);

export default ChecklistInputDialog;
