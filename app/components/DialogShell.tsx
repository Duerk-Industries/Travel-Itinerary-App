import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { memo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Modal from './KeyboardAwareModal';
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
  /** Wrap children in a ScrollView and cap the card to the viewport so tall content never clips. */
  scrollable?: boolean;
};

const DialogShellComponent: React.FC<DialogShellProps> = ({
  visible,
  title,
  styles,
  children,
  onClose,
  testID,
  message,
  useNativeModal = true,
  overlayStyle,
  cardStyle,
  accessibilityRole = 'none',
  showTitle = true,
  scrollable = false,
}) => {
  const _styleTheme = useStyleTheme();
  useEscapeToClose(visible, onClose);
  if (!visible) return null;

  const content = (
    <View
      style={[styles.modalOverlay, themeStyle('components_DialogShell_1', {  }, _styleTheme), overlayStyle]}
      testID={testID}
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityViewIsModal
      accessibilityLabel={title}
      accessibilityHint={message}
    >
      <View style={[styles.confirmModal, cardStyle, themeStyle('components_DialogShell_2', {  }, _styleTheme)]}>
        {showTitle ? (
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {message ? <Text style={styles.helperText}>{message}</Text> : null}
        {scrollable ? (
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator>
            {children}
          </ScrollView>
        ) : children}
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
