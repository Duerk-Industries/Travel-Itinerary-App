import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { closeSentry, initSentry } from '../utils/sentry';
import {
  applyLocalPrivacySignal, localPrivacySignalActive, needsPrivacyChoice, privacyPlatform,
  type PrivacyChoice, type PrivacyStatus,
} from '../utils/privacyConsent';

export interface PrivacyController {
  status: PrivacyStatus | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  showPrompt: boolean;
  refresh: () => Promise<void>;
  save: (choice: PrivacyChoice) => Promise<void>;
}

export const usePrivacyConsent = (backendUrl: string, token: string | null): PrivacyController => {
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [statusToken, setStatusToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(token);
  const requestVersionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  tokenRef.current = token;
  const activeStatus = statusToken === token ? status : null;

  const refresh = useCallback(async () => {
    if (saveInFlightRef.current) return;
    const requestVersion = ++requestVersionRef.current;
    if (!token) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${backendUrl}/api/account/privacy-preferences`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Privacy settings are unavailable');
      const next = applyLocalPrivacySignal(await response.json() as PrivacyStatus);
      if (tokenRef.current === token && requestVersionRef.current === requestVersion) {
        setStatus(next);
        setStatusToken(token);
        setError(null);
      }
    } catch {
      if (tokenRef.current === token && requestVersionRef.current === requestVersion) {
        setStatus(null); // Unknown fails closed.
        setStatusToken(null);
        setError('Privacy settings are unavailable. Optional collection is off.');
      }
    } finally {
      if (tokenRef.current === token && requestVersionRef.current === requestVersion) setLoading(false);
    }
  }, [backendUrl, token]);

  useEffect(() => {
    requestVersionRef.current += 1;
    saveInFlightRef.current = false;
    setStatus(null);
    setStatusToken(null);
    void closeSentry();
    void refresh();
    return () => { void closeSentry(); };
  }, [refresh]);

  useEffect(() => {
    const onForeground = () => { void refresh(); };
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') onForeground();
    });
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onForeground);
    }
    return () => {
      subscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onForeground);
      }
    };
  }, [refresh]);

  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => { void refresh(); }, 60_000);
    return () => clearInterval(timer);
  }, [token, refresh]);

  useEffect(() => {
    let cancelled = false;
    void closeSentry().then(() => {
      if (!cancelled && activeStatus?.optionalDiagnosticsAllowed && activeStatus.diagnosticPseudonym && token) {
        initSentry({ pseudonym: activeStatus.diagnosticPseudonym });
      }
    });
    return () => { cancelled = true; };
  }, [activeStatus?.optionalDiagnosticsAllowed, activeStatus?.diagnosticPseudonym, token]);

  const save = useCallback(async (choice: PrivacyChoice) => {
    if (!token || !activeStatus) throw new Error('Privacy settings are unavailable');
    if (saveInFlightRef.current) throw new Error('Privacy choice is already being saved');
    if (choice.optionalDiagnostics === false) void closeSentry();
    if (choice.productAnalytics === true && localPrivacySignalActive()) {
      throw new Error('Your browser privacy signal keeps product analytics off');
    }
    requestVersionRef.current += 1;
    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const response = await fetch(`${backendUrl}/api/account/privacy-preferences`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...choice, revision: activeStatus.revision, platform: privacyPlatform() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) {
          saveInFlightRef.current = false;
          await refresh();
        }
        throw new Error(body.error || 'Unable to save privacy settings');
      }
      if (tokenRef.current === token) {
        setStatus(applyLocalPrivacySignal(body as PrivacyStatus));
        setStatusToken(token);
        setError(null);
      }
    } catch (cause) {
      setError((cause as Error).message);
      throw cause;
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }, [backendUrl, token, activeStatus, refresh]);

  return { status: activeStatus, loading, saving, error, showPrompt: needsPrivacyChoice(activeStatus), refresh, save };
};
