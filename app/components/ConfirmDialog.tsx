import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { memo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import DialogShell from './DialogShell';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  styles: Record<string, any>;
  testID?: string;
  /** Render via RN's native Modal portal instead of an inline absolutely-positioned
   * view. Needed when this dialog must appear on top of another already-open
   * Modal (e.g. a picker) — a plain positioned view can end up stacked behind
   * a native Modal's portal regardless of zIndex. */
  useNativeModal?: boolean;
  /** Request in flight: buttons are disabled and the confirm label shows progress. Lets a caller
   * keep the dialog open until the work finishes instead of closing it and then raising an
   * Alert — on iOS an Alert presented while a native Modal is still dismissing leaves the whole
   * app unresponsive. */
  busy?: boolean;
  /** Text on the confirm button while busy (e.g. "Deleting…"). */
  busyLabel?: string;
  /** Shown inside the dialog when the confirmed action failed, so the user can retry or cancel. */
  errorMessage?: string | null;
};

const ConfirmDialogComponent: React.FC<ConfirmDialogProps> = ({
  visible,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  styles,
  testID,
  useNativeModal,
  busy = false,
  busyLabel = "Working…",
  errorMessage,
}) => {
  const _styleTheme = useStyleTheme();
  return (
    <DialogShell
      visible={visible}
      title={title}
      message={message}
      styles={styles}
      onClose={busy ? () => undefined : onCancel}
      testID={testID || 'confirm-dialog'}
      accessibilityRole="alert"
      scrollable
      useNativeModal={useNativeModal}
    >
      {errorMessage ? (
        <Text style={[styles.helperText, themeStyle('components_ConfirmDialog_1', {  }, _styleTheme)]} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.button, styles.dangerButton, themeStyle('components_ConfirmDialog_2', {  }, _styleTheme), busy ? themeStyle('components_ConfirmDialog_3', {  }, _styleTheme) : null]}
          onPress={busy ? undefined : onConfirm}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          accessibilityState={{ disabled: busy, busy }}
        >
          <Text style={styles.dangerButtonText}>{busy ? busyLabel : confirmLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, themeStyle('components_ConfirmDialog_4', {  }, _styleTheme), busy ? themeStyle('components_ConfirmDialog_5', {  }, _styleTheme) : null]}
          onPress={busy ? undefined : onCancel}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
        >
          <Text style={styles.buttonText}>{cancelLabel}</Text>
        </TouchableOpacity>
      </View>
    </DialogShell>
  );
};

const ConfirmDialog = memo(ConfirmDialogComponent);

export default ConfirmDialog;
