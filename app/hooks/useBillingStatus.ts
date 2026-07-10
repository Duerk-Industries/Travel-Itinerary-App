import { useState, useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { fetchBillingStatus, refreshBillingStatus, type BillingStatusResponse } from '../utils/billing';

interface UseBillingStatusOptions {
  backendUrl: string;
  token: string | null;
  enabled?: boolean;
}

interface UseBillingStatusResult {
  billingStatus: BillingStatusResponse | null;
  loading: boolean;
  error: boolean;
  checkoutSuccessMessage: string | null;
  clearCheckoutSuccessMessage: () => void;
  refresh: () => Promise<void>;
  triggerPostCheckoutRefresh: () => Promise<void>;
}

export const useBillingStatus = ({
  backendUrl,
  token,
  enabled = true,
}: UseBillingStatusOptions): UseBillingStatusResult => {
  const [billingStatus, setBillingStatus] = useState<BillingStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [checkoutSuccessMessage, setCheckoutSuccessMessage] = useState<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const load = useCallback(async () => {
    if (!token || !enabled) return;
    setLoading(true);
    setError(false);
    try {
      const status = await fetchBillingStatus(backendUrl, token);
      setBillingStatus(status);
      if (!status) setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, token, enabled]);

  // Refresh billing status when the app comes back to the foreground (e.g. after
  // the user returns from Stripe Checkout or Customer Portal in the system browser).
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        await load();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const triggerPostCheckoutRefresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const status = await refreshBillingStatus(backendUrl, token);
      if (status) {
        setBillingStatus(status);
        setCheckoutSuccessMessage(
          status.subscriptionStatus === 'trialing'
            ? 'Premium trial is active.'
            : 'Premium subscription is active.',
        );
      } else {
        setCheckoutSuccessMessage('Checkout completed. Billing status is syncing.');
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl, token]);

  useEffect(() => {
    if (!token || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('billing') !== 'success') return;
    triggerPostCheckoutRefresh().finally(() => {
      url.searchParams.delete('billing');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    });
  }, [token, triggerPostCheckoutRefresh]);

  const clearCheckoutSuccessMessage = useCallback(() => {
    setCheckoutSuccessMessage(null);
  }, []);

  return {
    billingStatus,
    loading,
    error,
    checkoutSuccessMessage,
    clearCheckoutSuccessMessage,
    refresh: load,
    triggerPostCheckoutRefresh,
  };
};
