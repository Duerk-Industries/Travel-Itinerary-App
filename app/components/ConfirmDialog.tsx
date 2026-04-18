import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

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
  if (!visible) return null;
  return (
    <View style={styles.modalOverlay} testID={testID || 'confirm-dialog'}>
      <View style={styles.confirmModal}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {message ? <Text style={styles.helperText}>{message}</Text> : null}
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={onConfirm}>
            <Text style={styles.dangerButtonText}>{confirmLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={onCancel}>
            <Text style={styles.buttonText}>{cancelLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default ConfirmDialog;
