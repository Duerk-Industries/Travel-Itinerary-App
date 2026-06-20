import { Platform, Linking } from 'react-native';

export type BillingPlanKey = 'premium_monthly' | 'premium_annual';

export interface BillingStatusResponse {
  effectiveTier: string;
  isBillingManaged: boolean;
  plan: 'monthly' | 'annual' | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  inGracePeriod: boolean;
  accessRevoked: boolean;
  checkoutAvailable: boolean;
  portalAvailable: boolean;
}

export interface PlanInfo {
  planKey: BillingPlanKey;
  amountCents: number;
  currency: string;
  interval: 'month' | 'year';
  trialDays: number;
}

export const fetchBillingStatus = async (
  backendUrl: string,
  token: string,
): Promise<BillingStatusResponse | null> => {
  try {
    const res = await fetch(`${backendUrl}/api/billing/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export const fetchBillingPlans = async (
  backendUrl: string,
  token: string,
): Promise<PlanInfo[]> => {
  try {
    const res = await fetch(`${backendUrl}/api/billing/plans`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.plans ?? [];
  } catch {
    return [];
  }
};

export const createCheckoutSession = async (
  backendUrl: string,
  token: string,
  planKey: BillingPlanKey,
  idempotencyKey: string,
): Promise<{ url: string } | { alreadySubscribed: true; message: string } | null> => {
  try {
    const res = await fetch(`${backendUrl}/api/billing/checkout-session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ planKey, idempotencyKey, clientPlatform: Platform.OS }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export const createPortalSession = async (
  backendUrl: string,
  token: string,
): Promise<{ url: string } | null> => {
  try {
    const res = await fetch(`${backendUrl}/api/billing/portal-session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export const refreshBillingStatus = async (
  backendUrl: string,
  token: string,
): Promise<BillingStatusResponse | null> => {
  try {
    const res = await fetch(`${backendUrl}/api/billing/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.status ?? null;
  } catch {
    return null;
  }
};

export const openBillingUrl = async (url: string): Promise<boolean> => {
  try {
    if (Platform.OS === 'web') {
      window.location.href = url;
      return true;
    }
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

/** Returns true when the current platform/context can show the Stripe purchase flow. */
export const isCheckoutAllowedOnPlatform = (): boolean =>
  Platform.OS === 'web';

export const formatCents = (cents: number, currency = 'usd'): string => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
};
