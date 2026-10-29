import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { memo, useEffect, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import DialogShell from './DialogShell';
import { subscribePermissionDenied } from '../utils/permissionDenied';

type PermissionDeniedModalProps = {
  styles: Record<string, any>;
};

const PermissionDeniedModalComponent: React.FC<PermissionDeniedModalProps> = ({ styles }) => {
  const _styleTheme = useStyleTheme();
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
      scrollable
      useNativeModal
    >
      <TouchableOpacity
        style={[styles.button, themeStyle('components_PermissionDeniedModal_1', {  }, _styleTheme)]}
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
