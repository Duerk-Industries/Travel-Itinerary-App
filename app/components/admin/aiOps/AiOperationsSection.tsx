import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { AppTheme } from '../../../theme/theme';
import { AiOpsAiAuditLog } from './AiOpsAiAuditLog';
import { AiOpsCaptures } from './AiOpsCaptures';
import { AiOpsExecutiveDashboard } from './AiOpsExecutiveDashboard';
import { AiOpsExperiments } from './AiOpsExperiments';
import { AiOpsOverview } from './AiOpsOverview';
import { AiOpsParserQuality } from './AiOpsParserQuality';
import { AiOpsProviders } from './AiOpsProviders';
import { AiOpsRecommendations } from './AiOpsRecommendations';
import { AiOpsRuntimeSettings } from './AiOpsRuntimeSettings';
import { AiOpsShadowReplay } from './AiOpsShadowReplay';
import { AiOpsNav, aiOpsStyles } from './shared';
import type {
  AiAnalyticsMetric,
  AiCaptureItem,
  AiExperiment,
  AiOpsSection,
  AiProviderFeatureConfig,
  AiProviderOption,
  AiRecommendation,
  AiRuntimeSetting,
} from './types';

const apiFetch = async (backendUrl: string, headers: Record<string, string>, path: string, opts?: RequestInit) => {
  const res = await fetch(`${backendUrl}/api/admin${path}`, { headers, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data;
};

export const AiOperationsSection: React.FC<{
  backendUrl: string;
  headers: Record<string, string>;
  initialAiOpsSection?: AiOpsSection;
  onAiOpsSectionChange?: (section: AiOpsSection) => void;
  theme: AppTheme;
}> = ({ backendUrl, headers, initialAiOpsSection = 'overview', onAiOpsSectionChange, theme }) => {
  const [aiOpsSection, setAiOpsSection] = useState<AiOpsSection>(initialAiOpsSection);
  const [features, setFeatures] = useState<AiProviderFeatureConfig[]>([]);
  const [providers, setProviders] = useState<AiProviderOption[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AiProviderFeatureConfig>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [runtimeSettings, setRuntimeSettings] = useState<AiRuntimeSetting[]>([]);
  const [runtimeDrafts, setRuntimeDrafts] = useState<Record<string, string>>({});
  const [runtimeReason, setRuntimeReason] = useState('');
  const [captures, setCaptures] = useState<AiCaptureItem[]>([]);
  const [captureQuery, setCaptureQuery] = useState('');
  const [captureAnonymousUserIdQuery, setCaptureAnonymousUserIdQuery] = useState('');
  const [analytics, setAnalytics] = useState<AiAnalyticsMetric[]>([]);
  const [experiments, setExperiments] = useState<AiExperiment[]>([]);
  const [recommendations, setRecommendations] = useState<AiRecommendation[]>([]);
  const [executiveSummary, setExecutiveSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => setAiOpsSection(initialAiOpsSection), [initialAiOpsSection]);

  const goToAiOps = (next: AiOpsSection) => {
    setAiOpsSection(next);
    onAiOpsSectionChange?.(next);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, runtimeData, capturesData, analyticsData, experimentsData, recommendationsData, executiveData] = await Promise.all([
        apiFetch(backendUrl, headers, '/ai-config'),
        apiFetch(backendUrl, headers, '/runtime-settings'),
        apiFetch(backendUrl, headers, '/ai-captures?limit=10'),
        apiFetch(backendUrl, headers, '/analytics?limit=40'),
        apiFetch(backendUrl, headers, '/experiments?limit=25'),
        apiFetch(backendUrl, headers, '/recommendations?limit=25'),
        apiFetch(backendUrl, headers, '/ai-ops/executive'),
      ]);
      const loadedFeatures = (Array.isArray(data.features) ? data.features : []) as AiProviderFeatureConfig[];
      const loadedSettings = (Array.isArray(runtimeData.settings) ? runtimeData.settings : []) as AiRuntimeSetting[];
      setFeatures(loadedFeatures);
      setProviders((Array.isArray(data.providers) ? data.providers : []) as AiProviderOption[]);
      setDrafts(Object.fromEntries(loadedFeatures.map((item) => [item.featureKey, item])));
      setRuntimeSettings(loadedSettings);
      setRuntimeDrafts(Object.fromEntries(loadedSettings.map((item) => [item.key, item.value])));
      setCaptures((Array.isArray(capturesData.captures) ? capturesData.captures : []) as AiCaptureItem[]);
      setAnalytics((Array.isArray(analyticsData.metrics) ? analyticsData.metrics : []) as AiAnalyticsMetric[]);
      setExperiments((Array.isArray(experimentsData.experiments) ? experimentsData.experiments : []) as AiExperiment[]);
      setRecommendations((Array.isArray(recommendationsData.recommendations) ? recommendationsData.recommendations : []) as AiRecommendation[]);
      setExecutiveSummary(executiveData.summary ?? null);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load AI config');
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers]);

  useEffect(() => { void load(); }, [load]);

  const saveProviderConfig = async (featureKey: string) => {
    const draft = drafts[featureKey];
    const reason = reasons[featureKey] ?? '';
    if (!draft) return;
    if (reason.trim().length < 3) {
      setError('Reason is required.');
      return;
    }
    setSaving(featureKey);
    setError(null);
    setSaveMsg(null);
    try {
      await apiFetch(backendUrl, headers, `/ai-config/${encodeURIComponent(featureKey)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: draft.provider, model: draft.model, enabled: draft.enabled, reason }),
      });
      setSaveMsg(`Saved ${featureKey}`);
      setReasons((prev) => ({ ...prev, [featureKey]: '' }));
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save AI config');
    } finally {
      setSaving(null);
    }
  };

  const saveRuntimeSettings = async () => {
    if (runtimeReason.trim().length < 3) {
      setError('Reason is required.');
      return;
    }
    setSaving('runtime-settings');
    setError(null);
    setSaveMsg(null);
    try {
      await apiFetch(backendUrl, headers, '/runtime-settings', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: runtimeDrafts, reason: runtimeReason }),
      });
      setSaveMsg('Saved runtime settings');
      setRuntimeReason('');
      await load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save runtime settings');
    } finally {
      setSaving(null);
    }
  };

  const searchCaptures = async () => {
    setSaving('capture-search');
    setError(null);
    try {
      const params = new URLSearchParams();
      if (captureQuery.trim()) params.set('captureId', captureQuery.trim());
      if (captureAnonymousUserIdQuery.trim()) params.set('anonymousUserId', captureAnonymousUserIdQuery.trim());
      const suffix = params.toString() ? `&${params.toString()}` : '';
      const data = await apiFetch(backendUrl, headers, `/ai-captures?limit=25${suffix}`);
      setCaptures((Array.isArray(data.captures) ? data.captures : []) as AiCaptureItem[]);
    } catch (err: any) {
      setError(err.message ?? 'Failed to search captures');
    } finally {
      setSaving(null);
    }
  };

  const refreshAnalytics = async () => {
    setSaving('analytics-refresh');
    setError(null);
    try {
      const data = await apiFetch(backendUrl, headers, '/analytics?run=1&limit=60');
      setAnalytics((Array.isArray(data.metrics) ? data.metrics : []) as AiAnalyticsMetric[]);
      setSaveMsg('Analytics refreshed');
    } catch (err: any) {
      setError(err.message ?? 'Failed to refresh analytics');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <Text style={[aiOpsStyles.cardSub, { color: theme.colors.textMuted }]}>Loading...</Text>;

  return (
    <View style={aiOpsStyles.section}>
      <Text style={[aiOpsStyles.sectionTitle, { color: theme.colors.text }]}>AI Operations</Text>
      {error ? <Text style={[aiOpsStyles.error, { color: theme.colors.error }]}>{error}</Text> : null}
      {saveMsg ? <Text style={[aiOpsStyles.save, { color: theme.colors.success }]}>{saveMsg}</Text> : null}
      <AiOpsNav active={aiOpsSection} theme={theme} onSelect={goToAiOps} />
      {aiOpsSection === 'overview' ? <AiOpsOverview theme={theme} providerCount={providers.length} experimentCount={experiments.length} recommendationCount={recommendations.length} metricCount={analytics.length} /> : null}
      {aiOpsSection === 'providers' ? <AiOpsProviders theme={theme} features={features} providers={providers} drafts={drafts} reasons={reasons} saving={saving} setDrafts={setDrafts} setReasons={setReasons} onSave={saveProviderConfig} /> : null}
      {aiOpsSection === 'runtime-settings' ? <AiOpsRuntimeSettings theme={theme} settings={runtimeSettings} drafts={runtimeDrafts} reason={runtimeReason} saving={saving} setDrafts={setRuntimeDrafts} setReason={setRuntimeReason} onSave={saveRuntimeSettings} /> : null}
      {aiOpsSection === 'captures' ? <AiOpsCaptures theme={theme} captures={captures} captureQuery={captureQuery} anonymousUserIdQuery={captureAnonymousUserIdQuery} saving={saving} setCaptureQuery={setCaptureQuery} setAnonymousUserIdQuery={setCaptureAnonymousUserIdQuery} onSearch={searchCaptures} /> : null}
      {aiOpsSection === 'parser-quality' ? <AiOpsParserQuality theme={theme} analytics={analytics} saving={saving} onRefresh={refreshAnalytics} /> : null}
      {aiOpsSection === 'shadow-replay' ? <AiOpsShadowReplay theme={theme} analytics={analytics} saving={saving} onRefresh={refreshAnalytics} title="Shadow Replay" /> : null}
      {aiOpsSection === 'experiments' ? <AiOpsExperiments theme={theme} experiments={experiments} /> : null}
      {aiOpsSection === 'recommendations' ? <AiOpsRecommendations theme={theme} recommendations={recommendations} /> : null}
      {aiOpsSection === 'executive' ? <AiOpsExecutiveDashboard theme={theme} summary={executiveSummary} /> : null}
      {aiOpsSection === 'ai-audit-log' ? <AiOpsAiAuditLog theme={theme} /> : null}
    </View>
  );
};
