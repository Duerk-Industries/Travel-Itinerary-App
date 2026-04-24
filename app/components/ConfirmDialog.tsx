import React from 'react';
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
};

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  visible,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  styles,
  testID,
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

export default ConfirmDialog;
