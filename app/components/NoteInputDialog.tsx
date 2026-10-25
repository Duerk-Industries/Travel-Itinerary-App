import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Modal from './KeyboardAwareModal';


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
  theme?: AppTheme;
};

const NoteInputDialog: React.FC<NoteInputDialogProps> = ({ visible, defaultDay, onSubmit, onCancel, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const colors = theme?.colors;

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
      <Pressable style={styles((theme ?? _styleTheme)).overlay} onPress={handleCancel} testID="note-dialog-overlay">
        <Pressable
          style={[styles((theme ?? _styleTheme)).dialog, colors && themeStyle('components_NoteInputDialog_1', { colors: colors }, (theme ?? _styleTheme))]}
          onPress={(e: { stopPropagation: () => void }) => e.stopPropagation()}
          accessibilityRole={'dialog' as any}
          accessibilityLabel="Add a note"
          testID="note-dialog"
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={themeStyle('components_NoteInputDialog_2', {  }, (theme ?? _styleTheme))} showsVerticalScrollIndicator>
          <Text style={[styles((theme ?? _styleTheme)).title, colors && themeStyle('components_NoteInputDialog_3', { colors: colors }, (theme ?? _styleTheme))]}>Add a note</Text>
          <Text style={[styles((theme ?? _styleTheme)).label, colors && themeStyle('components_NoteInputDialog_4', { colors: colors }, (theme ?? _styleTheme))]}>Title</Text>
          <TextInput
            testID="note-dialog-title"
            style={[styles((theme ?? _styleTheme)).input, colors && themeStyle('components_NoteInputDialog_5', { colors: colors }, (theme ?? _styleTheme))]}
            placeholderTextColor={colors?.textMuted}
            value={title}
            onChangeText={setTitle}
            placeholder="Short label"
            autoFocus
          />
          <Text style={[styles((theme ?? _styleTheme)).label, colors && themeStyle('components_NoteInputDialog_6', { colors: colors }, (theme ?? _styleTheme))]}>Body</Text>
          <TextInput
            testID="note-dialog-body"
            style={[styles((theme ?? _styleTheme)).input, styles((theme ?? _styleTheme)).textarea, colors && themeStyle('components_NoteInputDialog_7', { colors: colors }, (theme ?? _styleTheme))]}
            placeholderTextColor={colors?.textMuted}
            value={body}
            onChangeText={setBody}
            placeholder="Free-form note text. Line breaks are preserved."
            multiline
            numberOfLines={5}
          />
          {error ? <Text style={[styles((theme ?? _styleTheme)).error, theme?.mode === 'dark' && themeStyle('components_NoteInputDialog_8', {  }, (theme ?? _styleTheme))]}>{error}</Text> : null}
          <View style={styles((theme ?? _styleTheme)).actions}>
            <Pressable testID="note-dialog-cancel" style={styles((theme ?? _styleTheme)).btnGhost} onPress={handleCancel}>
              <Text style={[styles((theme ?? _styleTheme)).btnGhostText, colors && themeStyle('components_NoteInputDialog_9', { colors: colors }, (theme ?? _styleTheme))]}>Cancel</Text>
            </Pressable>
            <Pressable testID="note-dialog-submit" style={styles((theme ?? _styleTheme)).btnPrimary} onPress={handleSubmit}>
              <Text style={styles((theme ?? _styleTheme)).btnPrimaryText}>Add note</Text>
            </Pressable>
          </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_NoteInputDialog_10', { StyleSheet: StyleSheet }, _theme);

export default NoteInputDialog;
