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
      style={{ flex: 1, width: '100%' }}
      contentContainerStyle={{ alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
      testID="landing-page"
    >
      <View style={{ width: '100%', maxWidth: 720, alignItems: 'center', marginTop: spacing.xl }}>
        <Image
          source={logoSource}
          style={{ width: 72, height: 72, marginBottom: spacing.md }}
          accessibilityLabel="WanderBunnies logo"
        />
        <Text
          style={{
            fontSize: typography.h1,
            fontWeight: typography.weightBold,
            color: colors.text,
            textAlign: 'center',
          }}
        >
          WanderBunnies
        </Text>
        <Text
          style={{
            fontSize: typography.h3,
            color: colors.textMuted,
            textAlign: 'center',
            marginBottom: spacing.md,
          }}
        >
          Plan trips together, without the group-chat chaos
        </Text>
        <Text
          style={{
            fontSize: typography.body,
            color: colors.textMuted,
            textAlign: 'center',
            marginTop: spacing.sm,
            maxWidth: 560,
          }}
        >
          WanderBunnies is a professional-grade collaborative trip planner. We help groups organize itineraries,
          track transportation and lodging, and manage shared costs in one unified platform.
        </Text>

        <View
          style={{
            marginTop: spacing.xl,
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
                Get Started
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
                Log in
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ alignSelf: 'stretch', marginTop: spacing.xxl, gap: 16 }}>
          <Text style={{ fontSize: typography.h3, fontWeight: typography.weightBold, color: colors.text }}>
            Core Functionality
          </Text>
          {FEATURES.map((feature) => (
            <View key={feature} style={{ flexDirection: 'row', gap: 12, backgroundColor: colors.surfaceMuted, padding: 12, borderRadius: 8 }}>
              <Text style={{ color: colors.link, fontSize: typography.h3 }}>{'✓'}</Text>
              <Text style={{ color: colors.text, fontSize: typography.small, flex: 1, lineHeight: 20 }}>{feature}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ width: '100%', maxWidth: 720, marginTop: spacing.xxl }}>
        <Text
          style={{
            fontSize: typography.h3,
            fontWeight: typography.weightBold,
            color: colors.text,
            marginBottom: spacing.sm,
          }}
        >
          Visual Itinerary Preview
        </Text>
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

      <View
        style={{
          width: '100%',
          maxWidth: 720,
          marginTop: spacing.xxl,
          padding: spacing.xl,
          borderRadius: 12,
          backgroundColor: '#eff6ff',
          borderWidth: 1,
          borderColor: '#bfdbfe',
        }}
        testID="landing-data-use"
      >
        <Text
          style={{
            fontSize: typography.h3,
            fontWeight: typography.weightBold,
            color: '#1e3a8a',
            marginBottom: spacing.md,
          }}
        >
          Google Data Usage & Transparency
        </Text>
        <Text style={{ fontSize: typography.small, color: '#1e40af', marginBottom: 12, lineHeight: 20 }}>
          WanderBunnies uses Google User Data to enhance your trip planning experience. We prioritize transparency and security:
        </Text>
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: typography.small, color: '#1e40af', lineHeight: 20 }}>
            <Text style={{ fontWeight: typography.weightBold }}>• Identity:</Text> When you sign in with Google, we request your name and email address to create your account, identify you to your travel group, and secure your personal data.
          </Text>
          <Text style={{ fontSize: typography.small, color: '#1e40af', lineHeight: 20 }}>
            <Text style={{ fontWeight: typography.weightBold }}>• Gmail Integration (Optional):</Text> If you choose to enable the Gmail import feature, WanderBunnies requests read-only access to your emails to specifically identify travel confirmations (flights, hotels, activities). This data is used only to automatically populate your itinerary.
          </Text>
          <Text style={{ fontSize: typography.small, color: '#1e40af', lineHeight: 20 }}>
            <Text style={{ fontWeight: typography.weightBold }}>• Privacy:</Text> We do not use Google data for advertising, we do not sell your information to third parties, and we only access the data you explicitly authorize.
          </Text>
        </View>
        <View style={{ marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: '#bfdbfe' }}>
          <Text style={{ fontSize: typography.small, color: '#1e40af' }}>
            For more information, please read our{' '}
            <Text
              href="/privacy.html"
              accessibilityRole="link"
              onPress={() => openLegal('privacy.html')}
              style={{ color: '#2563eb', fontWeight: typography.weightBold, textDecorationLine: 'underline' }}
            >
              Privacy Policy
            </Text>.
          </Text>
        </View>
      </View>

      <View style={{ marginTop: spacing.xxl, alignItems: 'center', width: '100%' }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
          <Text
            href="/privacy.html"
            accessibilityRole="link"
            onPress={() => openLegal('privacy.html')}
            testID="landing-privacy-link"
            style={{ fontSize: typography.small, color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }}
          >
            Privacy Policy
          </Text>
          <Text style={{ fontSize: typography.small, color: colors.textMuted }}>·</Text>
          <Text
            href="/terms.html"
            accessibilityRole="link"
            onPress={() => openLegal('terms.html')}
            testID="landing-terms-link"
            style={{ fontSize: typography.small, color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }}
          >
            Terms of Service
          </Text>
          <Text style={{ fontSize: typography.small, color: colors.textMuted }}>·</Text>
          <Text
            href="/cookies.html"
            accessibilityRole="link"
            onPress={() => openLegal('cookies.html')}
            style={{ fontSize: typography.small, color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }}
          >
            Cookie Policy
          </Text>
        </View>
        <Text style={{ fontSize: typography.caption, color: colors.textMuted, marginTop: spacing.lg }}>
          &copy; 2026 WanderBunnies Travel · Owned and Operated by Bryan Duerk
        </Text>
      </View>
    </ScrollView>
  );
};

export default LandingPage;
