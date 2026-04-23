import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

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
  useEscapeToClose(visible, onCancel);
  if (!visible) return null;
  return (
    <View
      style={styles.modalOverlay}
      testID={testID || 'confirm-dialog'}
      accessible
      accessibilityRole="alert"
      accessibilityViewIsModal
      accessibilityLabel={title}
      accessibilityHint={message}
    >
      <View style={styles.confirmModal}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        {message ? <Text style={styles.helperText}>{message}</Text> : null}
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
      </View>
    </View>
  );
};

export default ConfirmDialog;
