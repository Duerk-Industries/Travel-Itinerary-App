import { themeStyle, getAppTheme as getStyleTheme, getAppTheme } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';

import { arePremiumTrialsEnabled } from '../config/premiumTrials';
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
import { createIdempotencyKey } from '../utils/idempotencyKey';

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

const generateIdempotencyKey = () => createIdempotencyKey('ck');

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
  const _styleTheme = useStyleTheme();
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
  const premiumTrialsEnabled = arePremiumTrialsEnabled();

  const periodEndLabel = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : null;
  const trialEndLabel = trialEnd
    ? new Date(trialEnd).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : periodEndLabel;
  const selectedPlanConfig = plans.find((p) => p.planKey === selectedPlan);
  const selectedPlanHasTrial = Boolean(premiumTrialsEnabled && selectedPlanConfig && selectedPlanConfig.trialDays > 0 && trialEligible);
  const checkoutCtaLabel = selectedPlanHasTrial ? 'Start free trial' : 'Subscribe to Premium';
  const renderTrialLabel = (planInfo: PlanInfo) => {
    if (!premiumTrialsEnabled || planInfo.trialDays <= 0) return null;
    return (
      <Text style={styles.planTrial}>
        {trialEligible ? `${planInfo.trialDays}-day free trial` : 'Trial already used'}
      </Text>
    );
  };
  const billingNotifications = billingStatus.notifications ?? [];

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
          {premiumTrialsEnabled && subscriptionStatus === 'trialing' && (
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

      {billingNotifications.length > 0 && (
        <View style={styles.notificationList}>
          {billingNotifications.map((notification) => (
            <View key={notification.id} style={styles.notificationItem}>
              <Text style={styles.notificationTitle}>{notification.title}</Text>
              <Text style={styles.notificationMessage}>{notification.message}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Upgrade UI — web only, for users not yet subscribed */}
      {!isPremium && canCheckout && (
        <View>
          <Text style={styles.pitch}>
            {premiumTrialsEnabled && trialEligible
              ? 'Unlock AI itineraries, cost tracking, and more with a free trial.'
              : 'Unlock AI itineraries, cost tracking, and more.'}
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
              <ActivityIndicator color={themeStyle('components_PremiumSubscriptionPanel_2', {  }, _styleTheme)} size="small" />
            ) : (
              <Text style={styles.ctaText}>{checkoutCtaLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Native: show status but no Stripe purchase button */}
      {!isPremium && !isCheckoutAllowedOnPlatform() && (
        <Text style={styles.statusNote}>
          Visit wanderbunnies.com on a web browser to subscribe or manage Premium.
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
  StyleSheet.create(themeStyle('components_PremiumSubscriptionPanel_1', { theme: theme }, (theme ?? getStyleTheme('light', 'light'))));

export default PremiumSubscriptionPanel;
