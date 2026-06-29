import React, { memo, useEffect, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import DialogShell from './DialogShell';
import { subscribePermissionDenied } from '../utils/permissionDenied';

type PermissionDeniedModalProps = {
  styles: Record<string, any>;
};

const PermissionDeniedModalComponent: React.FC<PermissionDeniedModalProps> = ({ styles }) => {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => subscribePermissionDenied(setMessage), []);

  const dismiss = () => setMessage(null);

  return (
    <DialogShell
      visible={Boolean(message)}
      title="Permission Denied"
      message={message ?? undefined}
      styles={styles}
      onClose={dismiss}
      testID="permission-denied-dialog"
      accessibilityRole="alert"
      useNativeModal
    >
      <TouchableOpacity
        style={[styles.button, { flex: 1 }]}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="OK"
        testID="permission-denied-dialog-ok"
      >
        <Text style={styles.buttonText}>OK</Text>
      </TouchableOpacity>
    </DialogShell>
  );
};

const PermissionDeniedModal = memo(PermissionDeniedModalComponent);

export default PermissionDeniedModal;
