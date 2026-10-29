import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import AppleLogo from './AppleLogo';

export type AppleSignInButtonProps = {
  onPress: () => void | Promise<void>;
  /** Apple HIG calls these "White"/"White with outline" and "Black" — 'light' maps to White with outline, 'dark' to Black. */
  mode?: 'light' | 'dark';
  label?: string;
  testID?: string;
};

/**
 * "Sign in with Apple" button built to Apple's Human Interface Guidelines
 * (developer.apple.com/design/human-interface-guidelines/sign-in-with-apple):
 * black or white fill, the Apple glyph in the button's foreground color,
 * San-Francisco-style medium weight label, and a fully rounded/pill-safe
 * corner radius. Height/width match GoogleSignInButton so the two sit flush
 * when stacked on the login screen.
 */
const AppleSignInButton: React.FC<AppleSignInButtonProps> = ({
  onPress,
  mode = 'dark',
  label = 'Sign in with Apple',
  testID,
}) => {
  const _styleTheme = useStyleTheme();
  const isDark = mode === 'dark';
  const foreground = isDark ? themeStyle('components_AppleSignInButton_4', {  }, _styleTheme) : themeStyle('components_AppleSignInButton_5', {  }, _styleTheme);
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      activeOpacity={0.85}
      style={themeStyle('components_AppleSignInButton_1', { isDark: isDark }, _styleTheme)}
    >
      <View style={themeStyle('components_AppleSignInButton_2', {  }, _styleTheme)}>
        <AppleLogo size={18} color={foreground} />
      </View>
      <Text
        style={themeStyle('components_AppleSignInButton_3', { foreground: foreground }, _styleTheme)}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

export default AppleSignInButton;
