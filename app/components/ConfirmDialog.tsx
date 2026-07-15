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
}) => {
  return (
    <DialogShell
      visible={visible}
      title={title}
      message={message}
      styles={styles}
      onClose={onCancel}
      testID={testID || 'confirm-dialog'}
      accessibilityRole="alert"
      useNativeModal={useNativeModal}
    >
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.button, styles.dangerButton, { flex: 1 }]}
          onPress={onConfirm}
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
        >
          <Text style={styles.dangerButtonText}>{confirmLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, { flex: 1 }]}
          onPress={onCancel}
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
