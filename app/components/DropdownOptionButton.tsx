import React, { memo } from 'react';
import { Pressable } from 'react-native';

type DropdownOptionButtonProps = {
  styles: Record<string, any>;
  children: React.ReactNode;
  onPress?: () => void;
  onPressIn?: () => void;
  testID?: string;
  disabled?: boolean;
  selected?: boolean;
  style?: any;
  accessibilityLabel?: string;
};

// react-native-web waits 50 ms before reporting a press start unless told otherwise. A text input's blur
// fires immediately on mouse-down, so a parent that uses onPressIn to say "an option is being chosen" (to
// skip its blur auto-select) would always lose that race and pick the first option. React Native's
// Pressable typings omit this web prop; native ignores it.
const WEB_IMMEDIATE_PRESS_IN = { delayPressIn: 0 } as object;

const DropdownOptionButtonComponent: React.FC<DropdownOptionButtonProps> = ({
  styles,
  children,
  onPress,
  onPressIn,
  testID,
  disabled,
  selected,
  style,
  accessibilityLabel,
}) => (
  <Pressable
    testID={testID}
    disabled={disabled}
    onPress={onPress}
    onPressIn={onPressIn}
    {...WEB_IMMEDIATE_PRESS_IN}
    accessibilityRole="menuitem"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ disabled: !!disabled, ...(selected === undefined ? {} : { selected }) }}
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
