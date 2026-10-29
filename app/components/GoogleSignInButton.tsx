import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import GoogleLogo from './GoogleLogo';

export type GoogleSignInButtonProps = {
  onPress: () => void | Promise<void>;
  /** Selects the light ("Neutral") or dark ("Filled Dark") official variant. */
  mode?: 'light' | 'dark';
  /** "Sign in with Google" vs "Sign up with Google" — both are sanctioned copy per the branding guidelines. */
  label?: string;
  testID?: string;
};

/**
 * "Sign in with Google" button built to Google's identity branding guidelines
 * (developers.google.com/identity/branding-guidelines): unmodified four-color
 * "G" logo, approved light/dark color pairs, Roboto medium 14sp label text,
 * 40dp height, and a 4dp corner radius (the "rectangular" shape option from
 * Google's own button configurator).
 */
const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onPress,
  mode = 'light',
  label = 'Sign in with Google',
  testID,
}) => {
  const _styleTheme = useStyleTheme();
  const isDark = mode === 'dark';
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      activeOpacity={0.85}
      style={themeStyle('components_GoogleSignInButton_1', { isDark: isDark }, _styleTheme)}
    >
      <View style={themeStyle('components_GoogleSignInButton_2', {  }, _styleTheme)}>
        <GoogleLogo size={18} />
      </View>
      <Text
        style={themeStyle('components_GoogleSignInButton_3', { isDark: isDark }, _styleTheme)}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

export default GoogleSignInButton;
