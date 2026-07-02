import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import DialogShell from './DialogShell';
import {
  createCheckoutSession,
  fetchBillingPlans,
  formatCents,
  isCheckoutAllowedOnPlatform,
  openBillingUrl,
  type BillingPlanKey,
  type PlanInfo,
} from '../utils/billing';
import { createIdempotencyKey } from '../utils/idempotencyKey';

type PremiumPlanComparisonDialogProps = {
  visible: boolean;
  backendUrl: string;
  token: string | null;
  styles: Record<string, any>;
  onMaybeLater: () => void;
};

const FREE_FEATURES = [
  '3 active trips',
  '6 travelers per trip',
  '5 AI itineraries per month',
  'Trip sharing and CSV exports',
];

const PREMIUM_FEATURES = [
  '250 active trips',
  '200 travelers per trip',
  'Unlimited AI itineraries',
  'Email import and cost tracking',
];

const planLabel = (planKey: BillingPlanKey) =>
  planKey === 'premium_annual' ? 'Premium Annual' : 'Premium Monthly';

const generateIdempotencyKey = (planKey: BillingPlanKey) =>
  createIdempotencyKey(`welcome_${planKey}`);

const getAnnualDiscountPercent = (monthlyPlan?: PlanInfo, annualPlan?: PlanInfo): number | null => {
  if (!monthlyPlan || !annualPlan || monthlyPlan.amountCents <= 0 || annualPlan.amountCents <= 0) {
    return null;
  }
  const annualizedMonthly = monthlyPlan.amountCents * 12;
  if (annualPlan.amountCents >= annualizedMonthly) return null;
  return Math.round((1 - annualPlan.amountCents / annualizedMonthly) * 100);
};

const PremiumPlanComparisonDialog: React.FC<PremiumPlanComparisonDialogProps> = ({
  visible,
  backendUrl,
  token,
  styles,
  onMaybeLater,
}) => {
  const { width, height } = useWindowDimensions();
  const isCompact = width < 480 || height < 700;
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [actionPlan, setActionPlan] = useState<BillingPlanKey | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadPlans = async () => {
      if (!visible || !token) return;
      setLoadingPlans(true);
      setErrorMessage(null);
      const nextPlans = await fetchBillingPlans(backendUrl, token);
      if (!cancelled) {
        setPlans(nextPlans);
        setLoadingPlans(false);
        if (nextPlans.length === 0) {
          setErrorMessage('Premium plan prices could not be loaded. Check your connection and try again.');
        }
      }
    };

    void loadPlans();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, token, visible]);

  const monthlyPlan = useMemo(
    () => plans.find((plan) => plan.planKey === 'premium_monthly'),
    [plans],
  );
  const annualPlan = useMemo(
    () => plans.find((plan) => plan.planKey === 'premium_annual'),
    [plans],
  );
  const annualDiscountPercent = getAnnualDiscountPercent(monthlyPlan, annualPlan);

  const handleSelectPlan = useCallback(
    async (planKey: BillingPlanKey) => {
      if (!token) {
        setErrorMessage('Sign in again before starting Premium checkout.');
        return;
      }
      const plan = plans.find((item) => item.planKey === planKey);
      if (!plan) {
        setErrorMessage(`${planLabel(planKey)} is not configured yet. Please try again later.`);
        return;
      }
      if (!isCheckoutAllowedOnPlatform()) {
        setErrorMessage('Premium checkout is available on the web. Open WanderBunnies in a browser to subscribe.');
        return;
      }

      setActionPlan(planKey);
      setErrorMessage(null);
      try {
        const result = await createCheckoutSession(
          backendUrl,
          token,
          planKey,
          generateIdempotencyKey(planKey),
        );
        if (!result) {
          setErrorMessage(`Unable to start Stripe checkout for ${planLabel(planKey)}. Please try again from Account.`);
          return;
        }
        if ('alreadySubscribed' in result) {
          setErrorMessage(result.message);
          return;
        }
        const opened = await openBillingUrl(result.url);
        if (!opened) {
          setErrorMessage(`Stripe checkout was created, but ${Platform.OS} could not open the checkout URL.`);
        }
      } finally {
        setActionPlan(null);
      }
    },
    [backendUrl, plans, token],
  );

  const renderFeatureList = (items: string[]) => (
    <View style={styles.planComparisonFeatureList}>
      {items.map((item) => (
        <Text key={item} style={styles.planComparisonFeature}>
          {`- ${item}`}
        </Text>
      ))}
    </View>
  );

  const renderPlanButton = (
    planKey: BillingPlanKey,
    heading: string,
    price: string,
    trialText: string | null,
    disabled: boolean,
  ) => (
    <TouchableOpacity
      key={planKey}
      style={[styles.planComparisonOption, disabled && styles.buttonDisabled]}
      onPress={() => handleSelectPlan(planKey)}
      disabled={disabled}
      testID={`premium-plan-option-${planKey}`}
      accessibilityRole="button"
      accessibilityLabel={`Start ${heading}`}
    >
      <Text style={styles.planComparisonOptionTitle}>{heading}</Text>
      <Text style={styles.planComparisonOptionPrice}>{price}</Text>
      {trialText ? <Text style={styles.planComparisonOptionTrial}>{trialText}</Text> : null}
      {actionPlan === planKey ? <ActivityIndicator size="small" color="#fff" /> : null}
    </TouchableOpacity>
  );

  const monthlyPrice = monthlyPlan
    ? `${formatCents(monthlyPlan.amountCents, monthlyPlan.currency)}/mo`
    : 'Monthly price loading';
  const annualPrice = annualPlan
    ? `${formatCents(annualPlan.amountCents, annualPlan.currency)}/yr${
        annualDiscountPercent ? ` (${annualDiscountPercent}% off monthly)` : ''
      }`
    : 'Annual price loading';
  const checkoutDisabled = loadingPlans || Boolean(actionPlan);

  return (
    <DialogShell
      visible={visible}
      title="Compare plans"
      message="Choose the plan that fits your trip planning needs."
      styles={styles}
      onClose={onMaybeLater}
      testID="premium-plan-comparison-dialog"
      accessibilityRole="alert"
      cardStyle={[styles.planComparisonModal, isCompact && { width: '100%', maxHeight: '92%' }]}
    >
      <ScrollView
        testID="premium-plan-comparison-scroll"
        style={{ maxHeight: isCompact ? 380 : 480 }}
        contentContainerStyle={{ paddingBottom: 8 }}
      >
        <View style={styles.planComparisonGrid}>
          <View style={styles.planComparisonTier}>
            <Text style={styles.planComparisonTierTitle}>Basic</Text>
            {renderFeatureList(FREE_FEATURES)}
          </View>
          <View style={[styles.planComparisonTier, styles.planComparisonTierPremium]}>
            <Text style={styles.planComparisonTierTitle}>Premium</Text>
            {renderFeatureList(PREMIUM_FEATURES)}
          </View>
        </View>

        <View style={styles.planComparisonOptions}>
          {renderPlanButton(
            'premium_monthly',
            'Monthly',
            monthlyPrice,
            monthlyPlan && monthlyPlan.trialDays > 0 ? `${monthlyPlan.trialDays}-day free trial` : null,
            checkoutDisabled || !monthlyPlan,
          )}
          {renderPlanButton(
            'premium_annual',
            'Annual',
            annualPrice,
            annualPlan && annualPlan.trialDays > 0 ? `${annualPlan.trialDays}-day free trial` : null,
            checkoutDisabled || !annualPlan,
          )}
        </View>

        {loadingPlans ? <Text style={styles.helperText}>Loading current Premium prices...</Text> : null}
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
      </ScrollView>

      <TouchableOpacity
        style={[styles.button, styles.secondaryButton, styles.planComparisonMaybeLater]}
        onPress={onMaybeLater}
        testID="premium-plan-maybe-later"
        accessibilityRole="button"
        accessibilityLabel="Maybe later"
      >
        <Text style={styles.secondaryButtonText}>Maybe later</Text>
      </TouchableOpacity>
    </DialogShell>
  );
};

export default PremiumPlanComparisonDialog;
