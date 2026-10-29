import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Image, Linking, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import GoogleSignInButton from './GoogleSignInButton';
import AppleSignInButton from './AppleSignInButton';

export type LandingPageProps = {
  theme: AppTheme;
  logoSource: number;
  /** API base URL for resolving the static legal docs — same pattern as AuthForm's openLegal. */
  backendUrl?: string;
  onLogin: () => void;
  onCreateAccount: () => void;
  onLoginWithGoogle: () => void;
  onLoginWithApple?: () => void;
  /** Hides the Apple button when the backend hasn't enabled the appleOAuthEnabled flag. */
  appleOAuthEnabled?: boolean;
};

type SampleDay = {
  label: string;
  title: string;
  subtitle: string;
  color: string;
};

// Static, clearly-labeled sample data — this is a product preview, never real
// trip content, so the copy and the day badges both make that explicit.
const SAMPLE_DAYS = (_theme: import('../theme/theme').AppTheme): SampleDay[] => themeStyle('components_LandingPage_54', {  }, _theme);

// Enumerated so the homepage fully describes app functionality, not just a
// one-line tagline — a stated requirement for Google OAuth consent-screen
// homepage review.
const FEATURES: string[] = [
  'Collaborative Planning: Build a shared day-by-day itinerary with flights, lodging, activities, and car rentals that everyone in your group can see and edit.',
  'Shared Expenses: Split and track shared costs with automatic balances for each traveler, so everyone can settle up.',
  'AI Itinerary Generation: Generate intelligent itinerary suggestions based on your destinations and dates using state-of-the-art AI models.',
  'Real-time Collaboration: Chat with your group and see presence indicators to know who is online and planning with you.',
  'Packing & Notes: Manage shared packing lists and trip-wide notes to keep all your travel details in one central location.',
];

const PUBLIC_PRIVACY_URL = 'https://wander-bunnies.com/privacy.html';
const PUBLIC_TERMS_URL = 'https://wander-bunnies.com/terms.html';
const PUBLIC_COOKIES_URL = 'https://wander-bunnies.com/cookies.html';
const PUBLIC_PRIVACY_CHOICES_URL = 'https://wander-bunnies.com/privacy-choices.html';

type PublicLinkProps = {
  href: string;
  children: React.ReactNode;
  onPress?: () => void;
  testID?: string;
  style?: React.ComponentProps<typeof Text>['style'];
};

/**
 * React Native Web supports href on Text and renders it as a real anchor, but
 * the React Native type definition does not include that web-only prop.
 * Keeping the cast here gives crawlers a real URL while preserving native
 * Linking behavior on iOS and Android.
 */
const PublicLink: React.FC<PublicLinkProps> = ({ href, children, onPress, testID, style }) => {
  const LinkText = Text as unknown as React.ComponentType<any>;
  return (
    <LinkText
      href={Platform.OS === 'web' ? href : undefined}
      accessibilityRole="link"
      onPress={Platform.OS === 'web' ? undefined : onPress}
      testID={testID}
      style={style}
    >
      {children}
    </LinkText>
  );
};

type SemanticHeadingProps = {
  level: 1 | 2;
  children: React.ReactNode;
  style?: React.ComponentProps<typeof Text>['style'];
};

/** Emit real heading elements on web while keeping native output as Text. */
const SemanticHeading: React.FC<SemanticHeadingProps> = ({ level, children, style }) => {
  if (Platform.OS === 'web') {
    return React.createElement(level === 1 ? 'h1' : 'h2', { style }, children);
  }
  return (
    <Text accessibilityRole="header" style={style}>
      {children}
    </Text>
  );
};

/**
 * Public landing page shown before login. Gives new visitors a sense of what
 * the itinerary Overview looks like (a static sample, not live data), fully
 * describes app functionality, explains what account data is requested and
 * why, and links the privacy policy — all visible without signing in, per
 * Google OAuth consent-screen homepage requirements. The "Sign in with
 * Google" control itself lives inside AuthForm/GoogleSignInButton — kept
 * separate so this page never has to reproduce Google's branded button.
 */
const LandingPage: React.FC<LandingPageProps> = ({
  theme: _providedTheme,
  logoSource,
  backendUrl,
  onLogin,
  onCreateAccount,
  onLoginWithGoogle,
  onLoginWithApple,
  appleOAuthEnabled,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const { colors, typography, spacing } = theme;

  const openLegal = (path: string) => {
    const baseUrl = Platform.OS === 'web' ? window.location.origin : (backendUrl || '').replace(/\/api$/, '');
    void Linking.openURL(`${baseUrl}/${path}`);
  };

  return (
    <ScrollView
      style={themeStyle('components_LandingPage_1', { colors: colors }, (theme ?? _styleTheme))}
      contentContainerStyle={themeStyle('components_LandingPage_2', { spacing: spacing }, (theme ?? _styleTheme))}
      testID="landing-page"
    >
      {/* 1. PRIMARY BRAND IDENTIFICATION - Must match GCP App Name exactly */}
      <View style={themeStyle('components_LandingPage_3', { spacing: spacing }, (theme ?? _styleTheme))}>
        <Image
          source={logoSource}
          style={themeStyle('components_LandingPage_4', { spacing: spacing }, (theme ?? _styleTheme))}
          accessibilityLabel="WanderBunnies Logo"
        />
        <SemanticHeading
          level={1}
          style={themeStyle('components_LandingPage_5', { typography: typography, colors: colors }, (theme ?? _styleTheme))}
        >
          WanderBunnies
        </SemanticHeading>
        <Text
          style={themeStyle('components_LandingPage_6', { typography: typography, colors: colors, spacing: spacing }, (theme ?? _styleTheme))}
        >
          Collaborative Itinerary & Expense Management
        </Text>

        {/* 2. FUNCTIONAL PURPOSE STATEMENT - Describes mechanical operation for reviewers */}
        <View style={themeStyle('components_LandingPage_7', { colors: colors, spacing: spacing }, (theme ?? _styleTheme))}>
          <Text
            style={themeStyle('components_LandingPage_8', { typography: typography, colors: colors }, (theme ?? _styleTheme))}
          >
            WanderBunnies is a collaborative trip-planning app that helps friends, families and travel groups create
            shared itineraries, organize flights and lodging, track expenses, and maintain packing lists. The application
            integrates with <Text style={themeStyle('components_LandingPage_9', {  }, (theme ?? _styleTheme))}>Google APIs</Text> to provide secure authentication.
          </Text>
        </View>

        <View
          style={themeStyle('components_LandingPage_10', { spacing: spacing }, (theme ?? _styleTheme))}
        >
          <GoogleSignInButton onPress={onLoginWithGoogle} testID="landing-google-signin" />
          {onLoginWithApple && appleOAuthEnabled ? (
            <AppleSignInButton onPress={onLoginWithApple} testID="landing-apple-signin" />
          ) : null}

          <View style={themeStyle('components_LandingPage_11', { spacing: spacing }, (theme ?? _styleTheme))}>
            <TouchableOpacity
              onPress={onCreateAccount}
              accessibilityRole="button"
              testID="landing-create-account"
              style={themeStyle('components_LandingPage_12', { colors: colors, spacing: spacing }, (theme ?? _styleTheme))}
            >
              <Text style={themeStyle('components_LandingPage_13', { typography: typography }, (theme ?? _styleTheme))}>
                Create Account
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onLogin}
              accessibilityRole="button"
              testID="landing-login"
              style={themeStyle('components_LandingPage_14', { colors: colors, spacing: spacing }, (theme ?? _styleTheme))}
            >
              <Text style={themeStyle('components_LandingPage_15', { colors: colors, typography: typography }, (theme ?? _styleTheme))}>
                Log In
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={themeStyle('components_LandingPage_16', { spacing: spacing }, (theme ?? _styleTheme))}>
          <SemanticHeading level={2} style={themeStyle('components_LandingPage_17', { typography: typography, colors: colors }, (theme ?? _styleTheme))}>
            Core Application Features
          </SemanticHeading>
          {FEATURES.map((feature) => (
            <View key={feature} style={themeStyle('components_LandingPage_18', { colors: colors }, (theme ?? _styleTheme))}>
              <Text style={themeStyle('components_LandingPage_19', { colors: colors, typography: typography }, (theme ?? _styleTheme))}>{'✓'}</Text>
              <Text style={themeStyle('components_LandingPage_20', { colors: colors, typography: typography }, (theme ?? _styleTheme))}>{feature}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 3. TRANSPARENCY SECTION - Explicitly links app features to Google Scopes */}
      <View
        style={themeStyle('components_LandingPage_21', { spacing: spacing, colors: colors }, (theme ?? _styleTheme))}
        testID="landing-data-use"
      >
        <SemanticHeading
          level={2}
          style={themeStyle('components_LandingPage_22', { typography: typography, colors: colors, spacing: spacing }, (theme ?? _styleTheme))}
        >
          Google User Data Disclosure
        </SemanticHeading>
        <Text style={themeStyle('components_LandingPage_23', { typography: typography, colors: colors }, (theme ?? _styleTheme))}>
          WanderBunnies requests specific permissions from your Google Account to provide its core functionality.
          We adhere to the{' '}
          <PublicLink
            href="https://developers.google.com/terms/api-services-user-data-policy"
            onPress={() => Linking.openURL('https://developers.google.com/terms/api-services-user-data-policy')}
            style={themeStyle('components_LandingPage_24', {  }, (theme ?? _styleTheme))}
          >
            Google API Services User Data Policy
          </PublicLink>, including Limited Use requirements.
        </Text>

        <View style={themeStyle('components_LandingPage_25', {  }, (theme ?? _styleTheme))}>
          <View style={themeStyle('components_LandingPage_26', { colors: colors }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('components_LandingPage_27', { typography: typography, colors: colors }, (theme ?? _styleTheme))}>
              <Text style={themeStyle('components_LandingPage_28', { colors: colors }, (theme ?? _styleTheme))}>Google Identity:</Text> We use your Google profile (name and email) to uniquely identify you within your travel groups and to provide a secure, password-less sign-in experience.
            </Text>
          </View>

          <View style={themeStyle('components_LandingPage_29', { colors: colors }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('components_LandingPage_30', { typography: typography, colors: colors }, (theme ?? _styleTheme))}>
              <Text style={themeStyle('components_LandingPage_31', { colors: colors }, (theme ?? _styleTheme))}>Data Privacy:</Text> Your Google data is used exclusively for the features you authorize. We do not sell your data, use it for advertising, or allow any third-party access except as required to provide the service.
            </Text>
          </View>
        </View>

        <View style={themeStyle('components_LandingPage_32', { spacing: spacing, colors: colors }, (theme ?? _styleTheme))}>
          <Text style={themeStyle('components_LandingPage_33', { typography: typography, colors: colors }, (theme ?? _styleTheme))}>
            Full details are available in our{' '}
            <PublicLink
              href={PUBLIC_PRIVACY_URL}
              onPress={() => openLegal('privacy.html')}
              style={themeStyle('components_LandingPage_34', {  }, (theme ?? _styleTheme))}
            >
              Privacy Policy
            </PublicLink>.
          </Text>
        </View>
      </View>

      <View style={themeStyle('components_LandingPage_35', { spacing: spacing }, (theme ?? _styleTheme))}>
        <SemanticHeading
          level={2}
          style={themeStyle('components_LandingPage_36', { typography: typography, colors: colors, spacing: spacing }, (theme ?? _styleTheme))}
        >
          Visual Itinerary Preview
        </SemanticHeading>
        <View style={themeStyle('components_LandingPage_37', { spacing: spacing }, (theme ?? _styleTheme))}>
          {SAMPLE_DAYS((theme ?? _styleTheme)).map((day) => (
            <View
              key={day.label}
              style={themeStyle('components_LandingPage_38', { day: day, spacing: spacing }, (theme ?? _styleTheme))}
            >
              <View
                style={themeStyle('components_LandingPage_39', {  }, (theme ?? _styleTheme))}
              >
                <Text style={themeStyle('components_LandingPage_40', { typography: typography }, (theme ?? _styleTheme))}>
                  {day.label.toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={themeStyle('components_LandingPage_41', { typography: typography }, (theme ?? _styleTheme))}>
                  {day.title}
                </Text>
                <Text style={themeStyle('components_LandingPage_42', { typography: typography }, (theme ?? _styleTheme))}>
                  {day.subtitle}
                </Text>
              </View>
            </View>
          ))}
        </View>
        <Text
          style={themeStyle('components_LandingPage_43', { typography: typography, colors: colors, spacing: spacing }, (theme ?? _styleTheme))}
        >
          This is a sample itinerary preview. Log in to create your own custom trip plan.
        </Text>
      </View>

      <View style={themeStyle('components_LandingPage_44', { spacing: spacing, colors: colors }, (theme ?? _styleTheme))}>
        <View style={themeStyle('components_LandingPage_45', {  }, (theme ?? _styleTheme))}>
          <PublicLink
            href={PUBLIC_PRIVACY_URL}
            onPress={() => openLegal('privacy.html')}
            testID="landing-privacy-link"
            style={themeStyle('components_LandingPage_46', { typography: typography, colors: colors }, (theme ?? _styleTheme))}
          >
            Privacy Policy
          </PublicLink>
          <Text style={themeStyle('components_LandingPage_47', { typography: typography, colors: colors }, (theme ?? _styleTheme))}>·</Text>
          <PublicLink
            href={PUBLIC_TERMS_URL}
            onPress={() => openLegal('terms.html')}
            testID="landing-terms-link"
            style={themeStyle('components_LandingPage_48', { typography: typography, colors: colors }, (theme ?? _styleTheme))}
          >
            Terms of Service
          </PublicLink>
          <Text style={themeStyle('components_LandingPage_49', { typography: typography, colors: colors }, (theme ?? _styleTheme))}>·</Text>
          <PublicLink
            href={PUBLIC_COOKIES_URL}
            onPress={() => openLegal('cookies.html')}
            style={themeStyle('components_LandingPage_50', { typography: typography, colors: colors }, (theme ?? _styleTheme))}
          >
            Cookie Policy
          </PublicLink>
          <Text style={themeStyle('components_LandingPage_51', { typography: typography, colors: colors }, (theme ?? _styleTheme))}>·</Text>
          <PublicLink
            href={PUBLIC_PRIVACY_CHOICES_URL}
            onPress={() => openLegal('privacy-choices.html')}
            testID="landing-privacy-choices-link"
            style={themeStyle('components_LandingPage_52', { typography: typography, colors: colors }, (theme ?? _styleTheme))}
          >
            Your Privacy Choices
          </PublicLink>
        </View>

        {/* 4. CONTROLLER IDENTIFICATION - Aligns with Privacy Policy data controller */}
        <Text style={themeStyle('components_LandingPage_53', { typography: typography, colors: colors, spacing: spacing }, (theme ?? _styleTheme))}>
          &copy; 2026 WanderBunnies · Owned and operated by Tristan Duerk, all rights reserved
        </Text>
      </View>
    </ScrollView>
  );
};

export default LandingPage;
