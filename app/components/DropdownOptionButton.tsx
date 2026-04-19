import React from 'react';
import { Pressable } from 'react-native';

type DropdownOptionButtonProps = {
  styles: Record<string, any>;
  children: React.ReactNode;
  onPress?: () => void;
  onPressIn?: () => void;
  testID?: string;
  disabled?: boolean;
  style?: any;
};

const DropdownOptionButton: React.FC<DropdownOptionButtonProps> = ({
  styles,
  children,
  onPress,
  onPressIn,
  testID,
  disabled,
  style,
}) => (
  <Pressable
    testID={testID}
    disabled={disabled}
    onPress={onPress}
    onPressIn={onPressIn}
    style={({ hovered, pressed }) => [
      styles.dropdownOption,
      hovered ? styles.dropdownOptionHover : null,
      pressed ? styles.dropdownOptionPressed : null,
      style,
    ]}
  >
    {children}
  </Pressable>
);

export default DropdownOptionButton;
