import React from 'react';
import { Image, Linking, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../theme/theme';
import GoogleSignInButton from './GoogleSignInButton';

export type LandingPageProps = {
  theme: AppTheme;
  logoSource: number;
  /** API base URL for resolving the static legal docs — same pattern as AuthForm's openLegal. */
  backendUrl?: string;
  onLogin: () => void;
  onCreateAccount: () => void;
  onLoginWithGoogle: () => void;
};

type SampleDay = {
  label: string;
  title: string;
  subtitle: string;
  color: string;
};

// Static, clearly-labeled sample data — this is a product preview, never real
// trip content, so the copy and the day badges both make that explicit.
const SAMPLE_DAYS: SampleDay[] = [
  { label: 'Day 1', title: 'Arrive in Seattle', subtitle: 'Pike Place Market · check in to hotel', color: '#2F6690' },
  { label: 'Day 2', title: 'Olympic National Park', subtitle: 'Hurricane Ridge · Sol Duc Falls Trail', color: '#3A7D63' },
  { label: 'Day 3', title: 'Hoh Rainforest', subtitle: 'Ruby Beach · sunset drive back', color: '#8A6D3B' },
];

// Enumerated so the homepage fully describes app functionality, not just a
// one-line tagline — a stated requirement for Google OAuth consent-screen
// homepage review.
const FEATURES: string[] = [
  'Collaborative Planning: Build a shared day-by-day itinerary with flights, lodging, activities, and car rentals that everyone in your group can see and edit.',
  'Shared Expenses: Split and track shared costs in a running ledger with automated total calculations for each traveler.',
  'AI Itinerary Generation: Generate intelligent itinerary suggestions based on your destinations and dates using state-of-the-art AI models.',
  'Real-time Collaboration: Chat with your group and see presence indicators to know who is online and planning with you.',
  'Packing & Notes: Manage shared packing lists and trip-wide notes to keep all your travel details in one central location.',
];

const PUBLIC_PRIVACY_URL = 'https://wander-bunnies.com/privacy.html';
const PUBLIC_TERMS_URL = 'https://wander-bunnies.com/terms.html';
const PUBLIC_COOKIES_URL = 'https://wander-bunnies.com/cookies.html';

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
  theme,
  logoSource,
  backendUrl,
  onLogin,
  onCreateAccount,
  onLoginWithGoogle,
}) => {
  const { colors, typography, spacing } = theme;

  const openLegal = (path: string) => {
    const baseUrl = Platform.OS === 'web' ? window.location.origin : (backendUrl || '').replace(/\/api$/, '');
    void Linking.openURL(`${baseUrl}/${path}`);
  };

  return (
    <ScrollView
      style={{ flex: 1, width: '100%', backgroundColor: colors.background }}
      contentContainerStyle={{ alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
      testID="landing-page"
    >
      {/* 1. PRIMARY BRAND IDENTIFICATION - Must match GCP App Name exactly */}
      <View style={{ width: '100%', maxWidth: 800, alignItems: 'center', marginTop: spacing.xl }}>
        <Image
          source={logoSource}
          style={{ width: 80, height: 80, marginBottom: spacing.sm }}
          accessibilityLabel="WanderBunnies Logo"
        />
        <SemanticHeading
          level={1}
          style={{
            fontSize: typography.display,
            fontWeight: typography.weightBold,
            color: colors.text,
            textAlign: 'center',
            marginBottom: 4,
          }}
        >
          WanderBunnies
        </SemanticHeading>
        <Text
          style={{
            fontSize: typography.h2,
            fontWeight: typography.weightMedium,
            color: colors.textMuted,
            textAlign: 'center',
            marginBottom: spacing.lg,
          }}
        >
          Collaborative Itinerary & Expense Management
        </Text>

        {/* 2. FUNCTIONAL PURPOSE STATEMENT - Describes mechanical operation for reviewers */}
        <View style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xl }}>
          <Text
            style={{
              fontSize: typography.body,
              color: colors.text,
              textAlign: 'center',
              lineHeight: 24,
            }}
          >
            WanderBunnies is a collaborative trip-planning app that helps friends, families and travel groups create
            shared itineraries, organize flights and lodging, track expenses, maintain packing lists and optionally
            import travel confirmations from Gmail. The application integrates with <Text style={{ fontWeight: 'bold' }}>Google APIs</Text>{' '}
            to provide secure authentication and optional automated travel document ingestion.
          </Text>
        </View>

        <View
          style={{
            width: '100%',
            maxWidth: 420,
            gap: spacing.md,
          }}
        >
          <GoogleSignInButton onPress={onLoginWithGoogle} testID="landing-google-signin" />

          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <TouchableOpacity
              onPress={onCreateAccount}
              accessibilityRole="button"
              testID="landing-create-account"
              style={{
                flex: 1,
                backgroundColor: colors.cta,
                paddingVertical: spacing.md,
                borderRadius: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#0B1726', fontWeight: typography.weightBold, fontSize: typography.body }}>
                Create Account
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onLogin}
              accessibilityRole="button"
              testID="landing-login"
              style={{
                flex: 1,
                backgroundColor: colors.surfaceMuted,
                borderWidth: 1,
                borderColor: colors.border,
                paddingVertical: spacing.md,
                borderRadius: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.text, fontWeight: typography.weightBold, fontSize: typography.body }}>
                Log In
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ alignSelf: 'stretch', marginTop: spacing.xxl, gap: 16 }}>
          <SemanticHeading level={2} style={{ fontSize: typography.h3, fontWeight: typography.weightBold, color: colors.text }}>
            Core Application Features
          </SemanticHeading>
          {FEATURES.map((feature) => (
            <View key={feature} style={{ flexDirection: 'row', gap: 12, backgroundColor: colors.surface, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.link, fontSize: typography.h3, fontWeight: 'bold' }}>{'✓'}</Text>
              <Text style={{ color: colors.text, fontSize: typography.small, flex: 1, lineHeight: 20 }}>{feature}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 3. TRANSPARENCY SECTION - Explicitly links app features to Google Scopes */}
      <View
        style={{
          width: '100%',
          maxWidth: 800,
          marginTop: spacing.xxl,
          padding: spacing.xl,
          borderRadius: 12,
          backgroundColor: '#f0f7ff',
          borderWidth: 1,
          borderColor: '#bae6fd',
        }}
        testID="landing-data-use"
      >
        <SemanticHeading
          level={2}
          style={{
            fontSize: typography.h3,
            fontWeight: typography.weightBold,
            color: '#0369a1',
            marginBottom: spacing.md,
            textAlign: 'center',
          }}
        >
          Google User Data Disclosure
        </SemanticHeading>
        <Text style={{ fontSize: typography.small, color: '#0c4a6e', marginBottom: 16, lineHeight: 22 }}>
          WanderBunnies requests specific permissions from your Google Account to provide its core functionality.
          We adhere to the{' '}
          <PublicLink
            href="https://developers.google.com/terms/api-services-user-data-policy"
            onPress={() => Linking.openURL('https://developers.google.com/terms/api-services-user-data-policy')}
            style={{ fontWeight: 'bold', textDecorationLine: 'underline' }}
          >
            Google API Services User Data Policy
          </PublicLink>, including Limited Use requirements.
        </Text>

        <View style={{ gap: 12 }}>
          <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 8 }}>
            <Text style={{ fontSize: typography.small, color: '#0c4a6e', lineHeight: 20 }}>
              <Text style={{ fontWeight: 'bold', color: '#0369a1' }}>Google Identity:</Text> We use your Google profile (name and email) to uniquely identify you within your travel groups and to provide a secure, password-less sign-in experience.
            </Text>
          </View>

          <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 8 }}>
            <Text style={{ fontSize: typography.small, color: '#0c4a6e', lineHeight: 20 }}>
              <Text style={{ fontWeight: 'bold', color: '#0369a1' }}>Gmail API (Optional):</Text> If you enable the "Email Import" feature, the app requests read-only access to your inbox. WanderBunnies filters for and processes only travel-related confirmation emails (e.g., flight and hotel bookings) to automatically populate your trip itinerary.
            </Text>
          </View>

          <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 8 }}>
            <Text style={{ fontSize: typography.small, color: '#0c4a6e', lineHeight: 20 }}>
              <Text style={{ fontWeight: 'bold', color: '#0369a1' }}>Data Privacy:</Text> Your Google data is used exclusively for the features you authorize. We do not sell your data, use it for advertising, or allow any third-party access except as required to provide the service.
            </Text>
          </View>
        </View>

        <View style={{ marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: '#bae6fd' }}>
          <Text style={{ fontSize: typography.small, color: '#0369a1', textAlign: 'center' }}>
            Full details are available in our{' '}
            <PublicLink
              href={PUBLIC_PRIVACY_URL}
              onPress={() => openLegal('privacy.html')}
              style={{ fontWeight: 'bold', textDecorationLine: 'underline' }}
            >
              Privacy Policy
            </PublicLink>.
          </Text>
        </View>
      </View>

      <View style={{ width: '100%', maxWidth: 800, marginTop: spacing.xxl }}>
        <SemanticHeading
          level={2}
          style={{
            fontSize: typography.h3,
            fontWeight: typography.weightBold,
            color: colors.text,
            marginBottom: spacing.sm,
          }}
        >
          Visual Itinerary Preview
        </SemanticHeading>
        <View style={{ gap: spacing.md }}>
          {SAMPLE_DAYS.map((day) => (
            <View
              key={day.label}
              style={{
                height: 140,
                borderRadius: 12,
                backgroundColor: day.color,
                padding: spacing.md,
                justifyContent: 'space-between',
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  alignSelf: 'flex-start',
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999,
                  backgroundColor: 'rgba(15, 23, 42, 0.55)',
                }}
              >
                <Text style={{ color: '#fff', fontSize: typography.caption, fontWeight: typography.weightSemibold }}>
                  {day.label.toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={{ color: '#fff', fontSize: typography.h3, fontWeight: typography.weightBold }}>
                  {day.title}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: typography.small, marginTop: 2 }}>
                  {day.subtitle}
                </Text>
              </View>
            </View>
          ))}
        </View>
        <Text
          style={{
            fontSize: typography.caption,
            color: colors.textMuted,
            textAlign: 'center',
            marginTop: spacing.sm,
          }}
        >
          This is a sample itinerary preview. Log in to create your own custom trip plan.
        </Text>
      </View>

      <View style={{ marginTop: spacing.xxl, alignItems: 'center', width: '100%', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xl }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
          <PublicLink
            href={PUBLIC_PRIVACY_URL}
            onPress={() => openLegal('privacy.html')}
            testID="landing-privacy-link"
            style={{ fontSize: typography.small, color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }}
          >
            Privacy Policy
          </PublicLink>
          <Text style={{ fontSize: typography.small, color: colors.textMuted }}>·</Text>
          <PublicLink
            href={PUBLIC_TERMS_URL}
            onPress={() => openLegal('terms.html')}
            testID="landing-terms-link"
            style={{ fontSize: typography.small, color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }}
          >
            Terms of Service
          </PublicLink>
          <Text style={{ fontSize: typography.small, color: colors.textMuted }}>·</Text>
          <PublicLink
            href={PUBLIC_COOKIES_URL}
            onPress={() => openLegal('cookies.html')}
            style={{ fontSize: typography.small, color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }}
          >
            Cookie Policy
          </PublicLink>
        </View>

        {/* 4. CONTROLLER IDENTIFICATION - Aligns with Privacy Policy data controller */}
        <Text style={{ fontSize: typography.caption, color: colors.textMuted, marginTop: spacing.lg, textAlign: 'center' }}>
          &copy; 2026 WanderBunnies · Owned and operated by Bryan Duerk
        </Text>
      </View>
    </ScrollView>
  );
};

export default LandingPage;
