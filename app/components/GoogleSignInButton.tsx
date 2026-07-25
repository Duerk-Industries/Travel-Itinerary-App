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
  const isDark = mode === 'dark';
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      activeOpacity={0.85}
      style={{
        height: 40,
        borderRadius: 4,
        backgroundColor: isDark ? '#131314' : '#FFFFFF',
        borderWidth: isDark ? 0 : 1,
        borderColor: '#747775',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        width: '100%',
      }}
    >
      <View style={{ width: 18, height: 18, marginRight: 10 }}>
        <GoogleLogo size={18} />
      </View>
      <Text
        style={{
          color: isDark ? '#E3E3E3' : '#1F1F1F',
          fontSize: 14,
          fontWeight: '500',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

export default GoogleSignInButton;
