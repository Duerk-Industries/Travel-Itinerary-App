import React, { memo } from 'react';
import { Pressable } from 'react-native';

type DropdownOptionButtonProps = {
  styles: Record<string, any>;
  children: React.ReactNode;
  onPress?: () => void;
  onPressIn?: () => void;
  testID?: string;
  disabled?: boolean;
  style?: any;
  accessibilityLabel?: string;
};

const DropdownOptionButtonComponent: React.FC<DropdownOptionButtonProps> = ({
  styles,
  children,
  onPress,
  onPressIn,
  testID,
  disabled,
  style,
  accessibilityLabel,
}) => (
  <Pressable
    testID={testID}
    disabled={disabled}
    onPress={onPress}
    onPressIn={onPressIn}
    accessibilityRole="menuitem"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ disabled: !!disabled }}
    style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
      styles.dropdownOption,
      hovered ? styles.dropdownOptionHover : null,
      pressed ? styles.dropdownOptionPressed : null,
      style,
    ]}
  >
    {children}
  </Pressable>
);

const DropdownOptionButton = memo(DropdownOptionButtonComponent);

export default DropdownOptionButton;
