import React from 'react';
import { Image, Linking, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../theme/theme';

export type LandingPageProps = {
  theme: AppTheme;
  logoSource: number;
  /** API base URL for resolving the static legal docs — same pattern as AuthForm's openLegal. */
  backendUrl?: string;
  onLogin: () => void;
  onCreateAccount: () => void;
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
  'Build a shared day-by-day itinerary with flights, lodging, activities, and car rentals',
  'Split and track shared expenses in a running cost ledger',
  'Generate AI-assisted itinerary suggestions from your destinations and dates',
  'Chat and see who else in your group is online, in real time',
  'Keep packing lists and trip notes in one place everyone can edit',
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
const LandingPage: React.FC<LandingPageProps> = ({ theme, logoSource, backendUrl, onLogin, onCreateAccount }) => {
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
          WanderBunnies is a collaborative trip planner: your group tracks flights, lodging, activities, and shared
          costs in one itinerary everyone can see and edit together.
        </Text>

        <View style={{ alignSelf: 'stretch', marginTop: spacing.lg, gap: 6 }}>
          {FEATURES.map((feature) => (
            <View key={feature} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ color: colors.link, fontSize: typography.body }}>{'•'}</Text>
              <Text style={{ color: colors.text, fontSize: typography.small, flex: 1 }}>{feature}</Text>
            </View>
          ))}
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: spacing.md,
            marginTop: spacing.xl,
            width: '100%',
            maxWidth: 420,
          }}
        >
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
              Create account
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

      <View style={{ width: '100%', maxWidth: 720, marginTop: spacing.xxl }}>
        <Text
          style={{
            fontSize: typography.h3,
            fontWeight: typography.weightBold,
            color: colors.text,
            marginBottom: spacing.sm,
          }}
        >
          What a shared itinerary looks like
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
          Sample itinerary shown for preview — sign in to build your own.
        </Text>
      </View>

      <View
        style={{
          width: '100%',
          maxWidth: 720,
          marginTop: spacing.xxl,
          padding: spacing.lg,
          borderRadius: 12,
          backgroundColor: colors.surfaceMuted,
          borderWidth: 1,
          borderColor: colors.border,
        }}
        testID="landing-data-use"
      >
        <Text
          style={{
            fontSize: typography.h3,
            fontWeight: typography.weightBold,
            color: colors.text,
            marginBottom: spacing.sm,
          }}
        >
          Why we ask for your info
        </Text>
        <Text style={{ fontSize: typography.small, color: colors.textMuted, marginBottom: 6 }}>
          Creating an account (with an email/password or Google Sign-In) only requests your name and email address —
          we use it to identify you to your travel group and secure your account. We never post on your behalf.
        </Text>
        <Text style={{ fontSize: typography.small, color: colors.textMuted, marginBottom: 6 }}>
          Everything else — trip dates, flights, lodging, activities, and costs — is information you or your group
          choose to add once you're signed in. Optional features, like importing itinerary details from Gmail,
          request additional permission separately and only when you turn them on.
        </Text>
        <Text style={{ fontSize: typography.small, color: colors.textMuted }}>
          We don't sell your data. Full details are in our{' '}
          <Text
            onPress={() => openLegal('privacy.html')}
            style={{ color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }}
          >
            Privacy Policy
          </Text>
          .
        </Text>
      </View>

      <View style={{ marginTop: spacing.xl, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <TouchableOpacity onPress={() => openLegal('privacy.html')} testID="landing-privacy-link">
            <Text
              style={{
                fontSize: typography.caption,
                color: colors.link,
                fontWeight: typography.weightSemibold,
                textDecorationLine: 'underline',
              }}
            >
              Privacy Policy
            </Text>
          </TouchableOpacity>
          <Text style={{ fontSize: typography.caption, color: colors.textMuted }}>·</Text>
          <TouchableOpacity onPress={() => openLegal('terms.html')} testID="landing-terms-link">
            <Text
              style={{
                fontSize: typography.caption,
                color: colors.link,
                fontWeight: typography.weightSemibold,
                textDecorationLine: 'underline',
              }}
            >
              Terms of Service
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};

export default LandingPage;
