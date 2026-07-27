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
  const isDark = mode === 'dark';
  const foreground = isDark ? '#FFFFFF' : '#000000';
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
        backgroundColor: isDark ? '#000000' : '#FFFFFF',
        borderWidth: isDark ? 0 : 1,
        borderColor: '#000000',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        width: '100%',
      }}
    >
      <View style={{ width: 18, height: 18, marginRight: 10 }}>
        <AppleLogo size={18} color={foreground} />
      </View>
      <Text
        style={{
          color: foreground,
          fontSize: 14,
          fontWeight: '500',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

export default AppleSignInButton;
