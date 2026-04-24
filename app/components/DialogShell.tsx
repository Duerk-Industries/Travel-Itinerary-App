import React, { memo } from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

type DialogShellProps = {
  visible: boolean;
  title: string;
  styles: Record<string, any>;
  children: React.ReactNode;
  onClose: () => void;
  testID?: string;
  message?: string;
  useNativeModal?: boolean;
  overlayStyle?: any;
  cardStyle?: any;
  accessibilityRole?: 'alert' | 'none';
  showTitle?: boolean;
};

const DialogShellComponent: React.FC<DialogShellProps> = ({
  visible,
  title,
  styles,
  children,
  onClose,
  testID,
  message,
  useNativeModal = false,
  overlayStyle,
  cardStyle,
  accessibilityRole = 'none',
  showTitle = true,
}) => {
  useEscapeToClose(visible, onClose);
  if (!visible) return null;

  const content = (
    <View
      style={[styles.modalOverlay, overlayStyle]}
      testID={testID}
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityViewIsModal
      accessibilityLabel={title}
      accessibilityHint={message}
    >
      <View style={[styles.confirmModal, cardStyle]}>
        {showTitle ? (
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {message ? <Text style={styles.helperText}>{message}</Text> : null}
        {children}
      </View>
    </View>
  );

  if (!useNativeModal) return content;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      {content}
    </Modal>
  );
};

const DialogShell = memo(DialogShellComponent);

export default DialogShell;
