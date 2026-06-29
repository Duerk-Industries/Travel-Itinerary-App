import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { getAppTheme } from '../theme/theme';
import {
  createCheckoutSession,
  createPortalSession,
  openBillingUrl,
  isCheckoutAllowedOnPlatform,
  formatCents,
  type BillingStatusResponse,
  type PlanInfo,
  type BillingPlanKey,
} from '../utils/billing';

interface Props {
  backendUrl: string;
  token: string | null;
  billingStatus: BillingStatusResponse | null;
  plans: PlanInfo[];
  onRefresh: () => Promise<void>;
  checkoutSuccessMessage?: string | null;
  onDismissCheckoutSuccess?: () => void;
  appearancePreference?: string;
  systemColorScheme?: 'light' | 'dark' | null;
}

const generateIdempotencyKey = () =>
  `ck_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const PremiumSubscriptionPanel: React.FC<Props> = ({
  backendUrl,
  token,
  billingStatus,
  plans,
  onRefresh,
  checkoutSuccessMessage = null,
  onDismissCheckoutSuccess,
  appearancePreference = 'auto',
  systemColorScheme,
}) => {
  const theme = getAppTheme(appearancePreference as any, systemColorScheme);
  const styles = makeStyles(theme);

  const [selectedPlan, setSelectedPlan] = useState<BillingPlanKey>('premium_monthly');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const monthlyPlan = plans.find((p) => p.planKey === 'premium_monthly');
  const annualPlan = plans.find((p) => p.planKey === 'premium_annual');

  const handleUpgrade = useCallback(async () => {
    if (!token) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await createCheckoutSession(
        backendUrl,
        token,
        selectedPlan,
        generateIdempotencyKey(),
      );
      if (!result) {
        setActionError('Unable to start checkout. Please try again.');
        return;
      }
      if ('alreadySubscribed' in result) {
        setActionError(result.message);
        await onRefresh();
        return;
      }
      const opened = await openBillingUrl(result.url);
      if (!opened) {
        setActionError('Could not open checkout. Please try again.');
      }
    } finally {
      setActionLoading(false);
    }
  }, [backendUrl, token, selectedPlan, onRefresh]);

  const handleManage = useCallback(async () => {
    if (!token) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await createPortalSession(backendUrl, token);
      if (!result) {
        setActionError('Unable to open subscription management. Please try again.');
        return;
      }
      const opened = await openBillingUrl(result.url);
      if (!opened) {
        setActionError('Could not open the subscription portal. Please try again.');
      }
    } finally {
      setActionLoading(false);
    }
  }, [backendUrl, token]);

  if (!billingStatus) return null;

  const {
    effectiveTier,
    subscriptionStatus,
    plan,
    currentPeriodEnd,
    trialEnd,
    trialEligible,
    trialEndingSoon,
    cancelAtPeriodEnd,
    inGracePeriod,
    accessRevoked,
    checkoutAvailable,
    portalAvailable,
  } = billingStatus;

  const isPremium = effectiveTier === 'premium' || effectiveTier === 'pro';
  const canCheckout = checkoutAvailable && isCheckoutAllowedOnPlatform();

  const periodEndLabel = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : null;
  const trialEndLabel = trialEnd
    ? new Date(trialEnd).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : periodEndLabel;
  const selectedPlanConfig = plans.find((p) => p.planKey === selectedPlan);
  const selectedPlanHasTrial = Boolean(selectedPlanConfig && selectedPlanConfig.trialDays > 0 && trialEligible);
  const checkoutCtaLabel = selectedPlanHasTrial ? 'Start free trial' : 'Subscribe to Premium';
  const renderTrialLabel = (planInfo: PlanInfo) => {
    if (planInfo.trialDays <= 0) return null;
    return (
      <Text style={styles.planTrial}>
        {trialEligible ? `${planInfo.trialDays}-day free trial` : 'Trial already used'}
      </Text>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Premium</Text>

      {checkoutSuccessMessage && (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{checkoutSuccessMessage}</Text>
          {onDismissCheckoutSuccess && (
            <TouchableOpacity
              onPress={onDismissCheckoutSuccess}
              accessibilityRole="button"
              accessibilityLabel="Dismiss billing confirmation"
            >
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Active subscription status */}
      {isPremium && (
        <View style={styles.statusRow}>
          <View style={[styles.badge, styles.badgeActive]}>
            <Text style={styles.badgeText}>
              {effectiveTier === 'pro' ? 'Pro' : plan === 'annual' ? 'Annual' : 'Monthly'}
            </Text>
          </View>
          {subscriptionStatus === 'trialing' && (
            <Text style={[styles.statusNote, trialEndingSoon && styles.warning]}>
              {trialEndingSoon && trialEndLabel
                ? `Trial ends ${trialEndLabel}`
                : 'Free trial active'}
            </Text>
          )}
          {inGracePeriod && (
            <Text style={[styles.statusNote, styles.warning]}>Payment issue — grace period active</Text>
          )}
          {cancelAtPeriodEnd && periodEndLabel && (
            <Text style={[styles.statusNote, styles.warning]}>
              Cancels {periodEndLabel}
            </Text>
          )}
          {accessRevoked && (
            <Text style={[styles.statusNote, styles.error]}>Access revoked</Text>
          )}
          {!cancelAtPeriodEnd && periodEndLabel && !inGracePeriod && (
            <Text style={styles.statusNote}>Renews {periodEndLabel}</Text>
          )}
        </View>
      )}

      {/* Upgrade UI — web only, for users not yet subscribed */}
      {!isPremium && canCheckout && (
        <View>
          <Text style={styles.pitch}>
            {trialEligible
              ? 'Unlock AI itineraries, email import, cost tracking, and more with a free trial.'
              : 'Unlock AI itineraries, email import, cost tracking, and more.'}
          </Text>

          {/* Plan selector */}
          {(monthlyPlan || annualPlan) && (
            <View style={styles.planRow}>
              {monthlyPlan && (
                <TouchableOpacity
                  style={[styles.planCard, selectedPlan === 'premium_monthly' && styles.planCardSelected]}
                  onPress={() => setSelectedPlan('premium_monthly')}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedPlan === 'premium_monthly' }}
                >
                  <Text style={styles.planInterval}>Monthly</Text>
                  <Text style={styles.planPrice}>
                    {formatCents(monthlyPlan.amountCents, monthlyPlan.currency)}/mo
                  </Text>
                  {renderTrialLabel(monthlyPlan)}
                </TouchableOpacity>
              )}
              {annualPlan && (
                <TouchableOpacity
                  style={[styles.planCard, selectedPlan === 'premium_annual' && styles.planCardSelected]}
                  onPress={() => setSelectedPlan('premium_annual')}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedPlan === 'premium_annual' }}
                >
                  <Text style={styles.planInterval}>Annual</Text>
                  <Text style={styles.planPrice}>
                    {formatCents(annualPlan.amountCents, annualPlan.currency)}/yr
                  </Text>
                  {renderTrialLabel(annualPlan)}
                </TouchableOpacity>
              )}
            </View>
          )}

          <TouchableOpacity
            style={[styles.ctaButton, actionLoading && styles.ctaButtonDisabled]}
            onPress={handleUpgrade}
            disabled={actionLoading}
            accessibilityRole="button"
            accessibilityLabel={checkoutCtaLabel}
          >
            {actionLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.ctaText}>{checkoutCtaLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Native: show status but no Stripe purchase button */}
      {!isPremium && !isCheckoutAllowedOnPlatform() && (
        <Text style={styles.statusNote}>
          Visit wanderbunnies.com on a web browser to upgrade to Premium.
        </Text>
      )}

      {/* Manage subscription */}
      {portalAvailable && (
        <TouchableOpacity
          style={styles.manageButton}
          onPress={handleManage}
          disabled={actionLoading}
          accessibilityRole="button"
          accessibilityLabel="Manage subscription"
        >
          <Text style={styles.manageText}>Manage subscription</Text>
        </TouchableOpacity>
      )}

      {actionError && (
        <Text style={styles.errorText}>{actionError}</Text>
      )}
    </View>
  );
};

const makeStyles = (theme: ReturnType<typeof getAppTheme>) =>
  StyleSheet.create({
    container: {
      marginVertical: 12,
      padding: 16,
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    sectionTitle: {
      fontSize: theme.typography.h3,
      fontWeight: theme.typography.weightSemibold,
      color: theme.colors.text,
      marginBottom: 10,
    },
    statusRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    badge: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 12,
    },
    badgeActive: {
      backgroundColor: theme.colors.premium,
    },
    badgeText: {
      color: '#fff',
      fontSize: theme.typography.small,
      fontWeight: theme.typography.weightSemibold,
    },
    statusNote: {
      fontSize: theme.typography.small,
      color: theme.colors.textMuted,
    },
    successBanner: {
      borderWidth: 1,
      borderColor: theme.colors.success,
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: 8,
      padding: 10,
      marginBottom: 12,
      gap: 8,
    },
    successText: {
      fontSize: theme.typography.small,
      color: theme.colors.text,
    },
    dismissText: {
      fontSize: theme.typography.small,
      color: theme.colors.link,
      fontWeight: theme.typography.weightSemibold,
    },
    warning: {
      color: theme.colors.warning,
    },
    error: {
      color: theme.colors.error,
    },
    pitch: {
      fontSize: theme.typography.body,
      color: theme.colors.text,
      marginBottom: 12,
      lineHeight: 22,
    },
    planRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 14,
    },
    planCard: {
      flex: 1,
      minWidth: 180,
      maxWidth: '100%',
      borderWidth: 2,
      borderColor: theme.colors.border,
      borderRadius: 10,
      padding: 12,
      alignItems: 'center',
    },
    planCardSelected: {
      borderColor: theme.colors.premium,
    },
    planInterval: {
      fontSize: theme.typography.small,
      fontWeight: theme.typography.weightSemibold,
      color: theme.colors.text,
      marginBottom: 2,
    },
    planPrice: {
      fontSize: theme.typography.h3,
      fontWeight: theme.typography.weightBold,
      color: theme.colors.text,
    },
    planTrial: {
      fontSize: theme.typography.caption,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    ctaButton: {
      backgroundColor: theme.colors.premium,
      borderRadius: 8,
      paddingVertical: 13,
      alignItems: 'center',
      marginBottom: 10,
    },
    ctaButtonDisabled: {
      opacity: 0.6,
    },
    ctaText: {
      color: '#fff',
      fontSize: theme.typography.body,
      fontWeight: theme.typography.weightSemibold,
    },
    manageButton: {
      marginTop: 4,
      alignItems: 'center',
      paddingVertical: 8,
    },
    manageText: {
      color: theme.colors.link,
      fontSize: theme.typography.small,
    },
    errorText: {
      marginTop: 8,
      color: theme.colors.error,
      fontSize: theme.typography.small,
    },
  });

export default PremiumSubscriptionPanel;
