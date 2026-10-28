import { resolveComponentTheme as resolveStyleTheme, themeStyle, getAppTheme as getStyleTheme, getAppTheme, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import { shadowStyle } from '../utils/shadowStyle';
import FeatureCohortEditor from '../components/FeatureCohortEditor';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';
import Modal from '../components/KeyboardAwareModal';
import HorizontalTableScroll from '../components/HorizontalTableScroll';

import { usePersistedState } from '../hooks/usePersistedState';
import PackingListTable from '../components/PackingListTable';
import { AiOperationsSection } from '../components/admin/aiOps/AiOperationsSection';
import { AnalyticsSection } from '../components/admin/AnalyticsSection';
import { PrivacyRequestsSection } from '../components/admin/PrivacyRequestsSection';
import type { AiOpsSection } from '../components/admin/aiOps/types';
export type { AiOpsSection } from '../components/admin/aiOps/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminSection = 'overview' | 'users' | 'user-detail' | 'tiers' | 'features' | 'ai-ops' | 'packing-defaults' | 'user-data' | 'audit-log' | 'ingestion' | 'api-limits' | 'cost-estimate' | 'metrics' | 'billing' | 'analytics' | 'privacy-requests';

type CacheRatioRow = { namespace: string; hits: number; misses: number; total: number; hitRate: number };
type MetricsSnapshot = {
  counters: Record<string, number>;
  cacheRatios: CacheRatioRow[];
  startedAtIso: string;
  snapshotAtIso: string;
};

type QueueDepthSnapshot = {
  countsByState: Record<string, number>;
  totalActive: number;
  totalTerminal: number;
  failedRetriable: number;
  snapshotAtIso: string;
};

type FeatureFlag = { key: string; enabled: boolean; description?: string | null; supportsCohort?: boolean };

type AiProviderOption = { id: string; configured: boolean; registered: boolean; certified?: boolean; supportedModels: string[] };
type AiProviderFeatureConfig = {
  featureKey: string;
  provider: string;
  model: string;
  enabled: boolean;
  updatedBy?: string | null;
  updatedAt?: string | null;
};
type AiRuntimeSetting = { key: string; value: string; updatedBy?: string | null; updatedAt?: string | null; source?: string };
type AiCaptureItem = {
  captureId: string;
  featureKey: string;
  capturedAt: string;
  correlationId?: string;
  jobId?: string;
  anonymousUserId?: string;
  provider?: string;
  model?: string;
  callerId?: string;
  outcome: string;
  latencyMs?: number;
  payloadSummary?: Record<string, unknown>;
};
type AiAnalyticsMetric = {
  table: string;
  periodStart: string;
  periodType: string;
  dimensions: Record<string, string>;
  metricKey: string;
  metricValue: number;
};
type AiExperiment = {
  experimentId: string;
  name: string;
  featureKey: string;
  experimentKind: string;
  status: string;
  variants: Array<{ variantId: string; trafficPercent: number; provider?: string; model?: string }>;
  createdAt: string;
  updatedAt: string;
};
type AiRecommendation = {
  recommendationId: string;
  recommendationType: string;
  featureKey: string;
  rationale: string;
  confidence: string;
  status: string;
  qualityDeltaEstimate: number;
  costDeltaEstimateUsdMonthly: number;
  createdAt: string;
};

type TierLimit = { limitKey: string; limitValue: number };
type TierEntitlement = { featureId: string; featureKey: string | null; isAllowed: boolean };
type Tier = {
  id: string;
  key: string;
  displayName: string;
  rank: number;
  limits: TierLimit[];
  entitlements: TierEntitlement[];
};

type LimitTableCell = {
  explicitValue: number | null;
};

type FeatureTableCell = {
  explicitValue: boolean | null;
  effectiveValue: boolean | null;
  isInherited: boolean;
  inheritedFromTierKey: string | null;
  inheritedFromTierDisplayName: string | null;
};

type AdminUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  tierKey: string | null;
  createdAt?: string | null;
};

type TierTableRow =
  | {
      kind: 'limit';
      key: string;
      label: string;
      values: Record<string, LimitTableCell>;
    }
  | {
      kind: 'feature';
      key: string;
      label: string;
      values: Record<string, FeatureTableCell>;
    };

type AdminUserDetail = AdminUser & {
  usage?: Array<{ metricKey: string; windowKey: string; count: number }>;
};

type UserDataRow = {
  id: string;
  email: string | null;
  role: string;
  tierKey: string | null;
  tripCount: number;
  tripCreations: number;
  aiGenerations: number;
  tokens: number;
  apiCalls?: Record<string, number>;
  createdAt: string;
};

type AuditEntry = {
  id: string;
  actorUserId: string | null;
  targetUserId: string | null;
  action: string;
  reason: string | null;
  beforeState: unknown;
  afterState: unknown;
  createdAt: string;
};

type BillingPlanConfig = {
  planKey: 'premium_monthly' | 'premium_annual';
  activeStripePriceId: string | null;
  unitAmountCents: number;
  currency: string;
  interval: 'month' | 'year';
  trialDays: number;
  pastDueGraceDays: number;
  automaticTaxEnabled: boolean;
  promotionCodesEnabled: boolean;
  isCheckoutEnabled: boolean;
  livemode: boolean | null;
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type AdminTabProps = {
  backendUrl: string;
  headers: Record<string, string>;
  initialSection?: AdminSection;
  initialAiOpsSection?: AiOpsSection;
  onSectionChange?: (section: AdminSection) => void;
  onAiOpsSectionChange?: (section: AiOpsSection) => void;
};

type IngestionMetrics = {
  ingestionVolumeBySourceAndTier: Array<{ sourceType: string; tierKey: string; count: number }>;
  parseRateByStage: Array<{ stageName: string; successCount: number; failureCount: number }>;
  duplicateRate: { duplicateCount: number; totalCount: number };
  lowConfidenceRate: { lowConfidenceCount: number; totalCount: number };
  averageLatencyByStage: Array<{ stageName: string; averageMs: number }>;
  retryAndDeadLetter: { retryCount: number; deadLetterCount: number };
  llmUsageByModel: Array<{ provider: string; modelName: string; tokensIn: number; tokensOut: number; estimatedCostUsd: number }>;
  quotaByUserTier: Array<{ userId: string; tierKey: string; uploadsUsed: number }>;
  gmailAuthFailures: number;
  webhookSignatureFailures: number;
  costPerUser: Array<{ userId: string; estimatedCostUsd: number }>;
};

type ShadowParseSummary = {
  sampleCount: number;
  comparedSampleCount: number;
  averageAgreementRate: number | null;
  byItemType: Array<{ itemType: string; sampleCount: number; averageAgreementRate: number }>;
  topMismatchedFields: Array<{ itemType: string; fieldName: string; mismatchCount: number }>;
  source: 'local_capture_archive';
};

type RetryPolicyConfig = {
  provider: string;
  maxAttempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  alertThresholdPercent: number;
  updatedAt: string;
};

type ThemedSectionProps = {
  theme: AppTheme;
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const apiFetch = async (backendUrl: string, headers: Record<string, string>, path: string, opts?: RequestInit) => {
  const res = await fetch(`${backendUrl}/api/admin${path}`, { headers, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
};

const getCardStyle = (theme: AppTheme, opacity = 0.06, y = 2, radius = 10) => (themeStyle('tabs_AdminTab_1', { theme: theme, shadowStyle: shadowStyle, opacity: opacity, y: y, radius: radius }, (theme ?? getStyleTheme('light', 'light'))));

const getInputStyle = (theme: AppTheme) => (themeStyle('tabs_AdminTab_2', { theme: theme }, (theme ?? getStyleTheme('light', 'light'))));

const getSecondaryPillStyle = (theme: AppTheme, active = false) => (themeStyle('tabs_AdminTab_3', { active: active, theme: theme }, (theme ?? getStyleTheme('light', 'light'))));

const getSecondaryPillTextStyle = (theme: AppTheme, active = false) => (themeStyle('tabs_AdminTab_4', { active: active, theme: theme }, (theme ?? getStyleTheme('light', 'light'))));

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// --- Overview ---
const OverviewSection: React.FC<{ onNav: (s: AdminSection) => void } & ThemedSectionProps> = ({ onNav, theme: _providedTheme }) => { const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme); return ((
  <View style={localStyles((theme ?? _styleTheme)).section}>
    <View style={[localStyles((theme ?? _styleTheme)).heroCard, getCardStyle(theme, 0, 0, 0), themeStyle('tabs_AdminTab_5', { theme: theme }, (theme ?? _styleTheme))]}>
      <Text style={[localStyles((theme ?? _styleTheme)).heroEyebrow, themeStyle('tabs_AdminTab_6', { theme: theme }, (theme ?? _styleTheme))]}>Operations</Text>
      <Text style={[localStyles((theme ?? _styleTheme)).heroTitle, themeStyle('tabs_AdminTab_7', { theme: theme }, (theme ?? _styleTheme))]}>Admin Panel</Text>
      <Text style={[localStyles((theme ?? _styleTheme)).heroBody, themeStyle('tabs_AdminTab_8', { theme: theme }, (theme ?? _styleTheme))]}>
        Manage users, access, entitlements, and audit visibility from one place.
      </Text>
    </View>
    {(
      [
        { label: 'Users', section: 'users' as AdminSection, desc: 'Search users, change tiers and roles' },
        { label: 'Tiers', section: 'tiers' as AdminSection, desc: 'View and edit tier limits and entitlements' },
        { label: 'Feature Flags', section: 'features' as AdminSection, desc: 'Enable or disable feature flags' },
        { label: 'AI Operations', section: 'ai-ops' as AdminSection, desc: 'Select providers and models per AI feature' },
        { label: 'Packing Defaults', section: 'packing-defaults' as AdminSection, desc: 'Edit the universal user packing list' },
        { label: 'User Data', section: 'user-data' as AdminSection, desc: 'Aggregate usage statistics' },
        { label: 'Audit Log', section: 'audit-log' as AdminSection, desc: 'History of admin actions' },
        { label: 'API Limits', section: 'api-limits' as AdminSection, desc: 'View API rate limits and current usage' },
        { label: 'Cost Estimator', section: 'cost-estimate' as AdminSection, desc: 'Projected monthly cost vs. actual recorded spend, hosting, and break-even' },
        { label: 'Billing', section: 'billing' as AdminSection, desc: 'Manage Premium pricing, trial, grace period, tax, and checkout' },
        { label: 'Ingestion Ops', section: 'ingestion' as AdminSection, desc: 'Review import throughput, duplicates, and cost' },
        { label: 'Metrics', section: 'metrics' as AdminSection, desc: 'In-process counters and cache hit rates' },
        { label: 'Analytics', section: 'analytics' as AdminSection, desc: 'Feature adoption, cost, reliability, platform mix and trip-phase engagement (consenting users)' },
        { label: 'Privacy Requests', section: 'privacy-requests' as AdminSection, desc: 'Rights requests with statutory due dates, and account/analytics erasure jobs' },
      ] as { label: string; section: AdminSection; desc: string }[]
    ).map((item) => (
      <TouchableOpacity key={item.section} style={[localStyles((theme ?? _styleTheme)).navCard, getCardStyle(theme, 0.07, 2, 6)]} onPress={() => onNav(item.section)}>
        <View style={[localStyles((theme ?? _styleTheme)).navAccent, themeStyle('tabs_AdminTab_9', { item: item, theme: theme }, (theme ?? _styleTheme))]} />
        <Text style={[localStyles((theme ?? _styleTheme)).navCardTitle, themeStyle('tabs_AdminTab_10', { theme: theme }, (theme ?? _styleTheme))]}>{item.label}</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).navCardDesc, themeStyle('tabs_AdminTab_11', { theme: theme }, (theme ?? _styleTheme))]}>{item.desc}</Text>
      </TouchableOpacity>
    ))}
  </View>
)); };

// --- Feature Flags ---
const FeaturesSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [reasonInputs, setReasonInputs] = useState<Record<string, string>>({});
  const [reasonVisible, setReasonVisible] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(backendUrl, headers, '/features');
      setFlags(data.features ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (flag: FeatureFlag) => {
    const reason = (reasonInputs[flag.key] ?? '').trim();
    if (reason.length < 3) {
      setReasonVisible((v) => ({ ...v, [flag.key]: true }));
      return;
    }
    setPendingKey(flag.key);
    try {
      await apiFetch(backendUrl, headers, `/features/${flag.key}/flag`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !flag.enabled, reason }),
      });
      setReasonInputs((r) => ({ ...r, [flag.key]: '' }));
      setReasonVisible((v) => ({ ...v, [flag.key]: false }));
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPendingKey(null);
    }
  };

  if (loading) return <Text style={[localStyles((theme ?? _styleTheme)).loading, themeStyle('tabs_AdminTab_12', { theme: theme }, (theme ?? _styleTheme))]}>Loading...</Text>;
  if (error) return <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_13', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text>;

  return (
    <View style={localStyles((theme ?? _styleTheme)).section}>
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_14', { theme: theme }, (theme ?? _styleTheme))]}>Feature Flags</Text>
      {flags.length === 0 && <Text style={[localStyles((theme ?? _styleTheme)).emptyText, themeStyle('tabs_AdminTab_15', { theme: theme }, (theme ?? _styleTheme))]}>No feature flags found.</Text>}
      {flags.map((flag) => (
        <View key={flag.key} style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
          <View style={localStyles((theme ?? _styleTheme)).row}>
            <View style={localStyles((theme ?? _styleTheme)).flex}>
              <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_16', { theme: theme }, (theme ?? _styleTheme))]}>{flag.key}</Text>
              {flag.description ? <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_17', { theme: theme }, (theme ?? _styleTheme))]}>{flag.description}</Text> : null}
            </View>
            <View
              style={[
                localStyles((theme ?? _styleTheme)).badge,
                themeStyle('tabs_AdminTab_18', { flag: flag, theme: theme }, (theme ?? _styleTheme)),
              ]}
            >
              <Text style={localStyles((theme ?? _styleTheme)).badgeText}>{flag.enabled ? 'ON' : 'OFF'}</Text>
            </View>
          </View>
          {flag.supportsCohort && <FeatureCohortEditor featureKey={flag.key} backendUrl={backendUrl} headers={headers} theme={theme} />}
          {reasonVisible[flag.key] || true ? (
            <View style={localStyles((theme ?? _styleTheme)).inlineForm}>
              <TextInput
                style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
                placeholder="Reason (required)"
                placeholderTextColor={theme.colors.textMuted}
                value={reasonInputs[flag.key] ?? ''}
                onChangeText={(t: string) => setReasonInputs((r) => ({ ...r, [flag.key]: t }))}
              />
              <TouchableOpacity
                style={[
                  localStyles((theme ?? _styleTheme)).smallButton,
                  themeStyle('tabs_AdminTab_19', { theme: theme }, (theme ?? _styleTheme)),
                  pendingKey === flag.key && localStyles((theme ?? _styleTheme)).buttonDisabled,
                ]}
                disabled={pendingKey === flag.key}
                onPress={() => toggle(flag)}
              >
                <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>{flag.enabled ? 'Disable' : 'Enable'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
};

// --- Users ---
const UsersSection: React.FC<{
  backendUrl: string;
  headers: Record<string, string>;
  tiers: Tier[];
  onViewUser: (user: AdminUser) => void;
} & ThemedSectionProps> = ({ backendUrl, headers, tiers, onViewUser, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = usePersistedState<string>('admin.users.search', '');
  const [page, setPage] = usePersistedState<number>('admin.users.page', 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [availableTiers, setAvailableTiers] = useState<Tier[]>(tiers);
  const [bulkTierKey, setBulkTierKey] = useState<string>('');
  const [bulkTierDropdownOpen, setBulkTierDropdownOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState<string>('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkRole, setBulkRole] = useState<'admin' | 'user' | null>(null);
  const [bulkRoleApplying, setBulkRoleApplying] = useState(false);
  const limit = 20;

  const load = useCallback(async (q: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (q.trim()) params.set('search', q.trim());
      const data = await apiFetch(backendUrl, headers, `/users?${params}`);
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers]);

  useEffect(() => { load(search, page); }, [load, search, page]);

  useEffect(() => {
    if (availableTiers.length) return;
    if (tiers.length) { setAvailableTiers(tiers); return; }
    apiFetch(backendUrl, headers, '/tiers')
      .then((data: any) => setAvailableTiers(data?.tiers ?? []))
      .catch(() => undefined);
  }, [availableTiers.length, backendUrl, headers, tiers]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const sortedBulkTiers = [...availableTiers].sort((a, b) => a.rank - b.rank);
  const selectedTier = sortedBulkTiers.find((t) => t.key === bulkTierKey);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const applyBulkTier = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || !bulkTierKey || bulkReason.trim().length < 3) return;
    setBulkApplying(true);
    setError(null);
    try {
      const response = await fetch(`${backendUrl}/api/admin/users/bulk-tier`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, tierKey: bulkTierKey, reason: bulkReason.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 207) {
        setError((body as any)?.error ?? 'Bulk tier change failed.');
        return;
      }
      const failed = ((body as any)?.failed ?? []) as Array<{ id: string; reason: string }>;
      if (failed.length) {
        const summary = failed.slice(0, 3).map((f) => `${f.id.slice(0, 8)}: ${f.reason}`).join('; ');
        const overflow = failed.length > 3 ? ` (+${failed.length - 3} more)` : '';
        setError(`Some users could not be updated: ${summary}${overflow}`);
      }
      clearSelection();
      setBulkReason('');
      await load(search, page);
    } catch (e: any) {
      setError(e.message ?? 'Bulk tier change failed.');
    } finally {
      setBulkApplying(false);
    }
  };

  const applyBulkRole = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || !bulkRole || bulkReason.trim().length < 3) return;
    setBulkRoleApplying(true);
    setError(null);
    try {
      const response = await fetch(`${backendUrl}/api/admin/users/bulk-role`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, role: bulkRole, reason: bulkReason.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 207) {
        setError((body as any)?.error ?? 'Bulk role change failed.');
        return;
      }
      const failed = ((body as any)?.failed ?? []) as Array<{ id: string; reason: string }>;
      if (failed.length) {
        const summary = failed.slice(0, 3).map((f) => `${f.id.slice(0, 8)}: ${f.reason}`).join('; ');
        const overflow = failed.length > 3 ? ` (+${failed.length - 3} more)` : '';
        setError(`Some users could not be updated: ${summary}${overflow}`);
      }
      clearSelection();
      setBulkReason('');
      setBulkRole(null);
      await load(search, page);
    } catch (e: any) {
      setError(e.message ?? 'Bulk role change failed.');
    } finally {
      setBulkRoleApplying(false);
    }
  };

  return (
    <View style={localStyles((theme ?? _styleTheme)).section}>
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_20', { theme: theme }, (theme ?? _styleTheme))]}>Users</Text>
      <TextInput
        style={[localStyles((theme ?? _styleTheme)).input, getInputStyle(theme)]}
        placeholder="Search by email, name, or user ID..."
        placeholderTextColor={theme.colors.textMuted}
        value={search}
        onChangeText={(t: string) => { setSearch(t); setPage(1); }}
      />
      {error ? <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_21', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text> : null}
      {loading ? <Text style={[localStyles((theme ?? _styleTheme)).loading, themeStyle('tabs_AdminTab_22', { theme: theme }, (theme ?? _styleTheme))]}>Loading...</Text> : null}
      {!loading && users.length === 0 ? <Text style={[localStyles((theme ?? _styleTheme)).emptyText, themeStyle('tabs_AdminTab_23', { theme: theme }, (theme ?? _styleTheme))]}>No users found.</Text> : null}
      {selectedIds.size > 0 ? (
        <View
          style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}
          accessibilityLabel={`Bulk actions for ${selectedIds.size} selected user${selectedIds.size === 1 ? '' : 's'}`}
          testID="admin-users-bulk-action-bar"
        >
          <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_24', { theme: theme }, (theme ?? _styleTheme))]}>{selectedIds.size} selected</Text>
          <View style={[localStyles((theme ?? _styleTheme)).row, themeStyle('tabs_AdminTab_25', {  }, (theme ?? _styleTheme))]}>
            <TouchableOpacity
              style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_26', { theme: theme }, (theme ?? _styleTheme))]}
              onPress={() => setBulkTierDropdownOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Choose target tier"
              testID="admin-users-bulk-tier-dropdown-toggle"
            >
              <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('tabs_AdminTab_27', { theme: theme }, (theme ?? _styleTheme))]}>
                {selectedTier?.displayName ?? selectedTier?.key ?? 'Select tier'}
              </Text>
            </TouchableOpacity>
            {bulkTierDropdownOpen ? (
              <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme), themeStyle('tabs_AdminTab_28', {  }, (theme ?? _styleTheme))]}>
                {sortedBulkTiers.length === 0 ? (
                  <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_29', { theme: theme }, (theme ?? _styleTheme))]}>No tiers loaded.</Text>
                ) : null}
                {sortedBulkTiers.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_30', { theme: theme }, (theme ?? _styleTheme))]}
                    onPress={() => { setBulkTierKey(t.key); setBulkTierDropdownOpen(false); }}
                    accessibilityRole="menuitem"
                    testID={`admin-users-bulk-tier-option-${t.key}`}
                  >
                    <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('tabs_AdminTab_31', { theme: theme }, (theme ?? _styleTheme))]}>{t.displayName}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <TextInput
              style={[localStyles((theme ?? _styleTheme)).input, getInputStyle(theme), themeStyle('tabs_AdminTab_32', {  }, (theme ?? _styleTheme))]}
              placeholder="Reason (min 3 chars)"
              placeholderTextColor={theme.colors.textMuted}
              value={bulkReason}
              onChangeText={setBulkReason}
              accessibilityLabel="Reason for bulk tier change"
              testID="admin-users-bulk-reason"
            />
            <TouchableOpacity
              style={[
                localStyles((theme ?? _styleTheme)).smallButton,
                themeStyle('tabs_AdminTab_33', { theme: theme }, (theme ?? _styleTheme)),
                (!bulkTierKey || bulkReason.trim().length < 3 || bulkApplying) && localStyles((theme ?? _styleTheme)).buttonDisabled,
              ]}
              disabled={!bulkTierKey || bulkReason.trim().length < 3 || bulkApplying}
              onPress={applyBulkTier}
              accessibilityRole="button"
              accessibilityState={{ disabled: !bulkTierKey || bulkReason.trim().length < 3 || bulkApplying }}
              accessibilityLabel={`Apply ${selectedTier?.displayName ?? bulkTierKey} tier to ${selectedIds.size} selected user${selectedIds.size === 1 ? '' : 's'}`}
              testID="admin-users-bulk-apply"
            >
              <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('tabs_AdminTab_34', { theme: theme }, (theme ?? _styleTheme))]}>
                {bulkApplying ? 'Applying…' : 'Apply tier'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_35', { theme: theme }, (theme ?? _styleTheme))]}
              onPress={clearSelection}
              accessibilityRole="button"
              accessibilityLabel="Clear user selection"
              testID="admin-users-bulk-clear"
            >
              <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('tabs_AdminTab_36', { theme: theme }, (theme ?? _styleTheme))]}>Clear</Text>
            </TouchableOpacity>
          </View>
          <View
            style={[localStyles((theme ?? _styleTheme)).row, themeStyle('tabs_AdminTab_37', {  }, (theme ?? _styleTheme))]}
            testID="admin-users-bulk-role-row"
          >
            <TouchableOpacity
              style={[
                localStyles((theme ?? _styleTheme)).smallButton,
                bulkRole === 'admin'
                  ? themeStyle('tabs_AdminTab_38', { theme: theme }, (theme ?? _styleTheme))
                  : themeStyle('tabs_AdminTab_39', { theme: theme }, (theme ?? _styleTheme)),
              ]}
              onPress={() => setBulkRole((r) => (r === 'admin' ? null : 'admin'))}
              accessibilityRole="button"
              accessibilityLabel="Select role: admin"
              accessibilityState={{ selected: bulkRole === 'admin' }}
              testID="admin-users-bulk-role-admin"
            >
              <Text
                style={[
                  localStyles((theme ?? _styleTheme)).smallButtonText,
                  themeStyle('tabs_AdminTab_40', { bulkRole: bulkRole, theme: theme }, (theme ?? _styleTheme)),
                ]}
              >
                Admin
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                localStyles((theme ?? _styleTheme)).smallButton,
                bulkRole === 'user'
                  ? themeStyle('tabs_AdminTab_41', { theme: theme }, (theme ?? _styleTheme))
                  : themeStyle('tabs_AdminTab_42', { theme: theme }, (theme ?? _styleTheme)),
              ]}
              onPress={() => setBulkRole((r) => (r === 'user' ? null : 'user'))}
              accessibilityRole="button"
              accessibilityLabel="Select role: user"
              accessibilityState={{ selected: bulkRole === 'user' }}
              testID="admin-users-bulk-role-user"
            >
              <Text
                style={[
                  localStyles((theme ?? _styleTheme)).smallButtonText,
                  themeStyle('tabs_AdminTab_43', { bulkRole: bulkRole, theme: theme }, (theme ?? _styleTheme)),
                ]}
              >
                User
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                localStyles((theme ?? _styleTheme)).smallButton,
                themeStyle('tabs_AdminTab_44', { theme: theme }, (theme ?? _styleTheme)),
                (!bulkRole || bulkReason.trim().length < 3 || bulkRoleApplying) && localStyles((theme ?? _styleTheme)).buttonDisabled,
              ]}
              disabled={!bulkRole || bulkReason.trim().length < 3 || bulkRoleApplying}
              onPress={applyBulkRole}
              accessibilityRole="button"
              accessibilityState={{ disabled: !bulkRole || bulkReason.trim().length < 3 || bulkRoleApplying }}
              accessibilityLabel={`Apply ${bulkRole ?? 'role'} to ${selectedIds.size} selected user${selectedIds.size === 1 ? '' : 's'}`}
              testID="admin-users-bulk-role-apply"
            >
              <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('tabs_AdminTab_45', { theme: theme }, (theme ?? _styleTheme))]}>
                {bulkRoleApplying ? 'Applying…' : 'Apply role'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {users.map((u) => {
        const checked = selectedIds.has(u.id);
        return (
          <View key={u.id} style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
            <View style={localStyles((theme ?? _styleTheme)).row}>
              <TouchableOpacity
                onPress={() => toggleSelected(u.id)}
                style={themeStyle('tabs_AdminTab_46', {  }, (theme ?? _styleTheme))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={`${checked ? 'Deselect' : 'Select'} ${u.email ?? u.id}`}
                testID={`admin-users-row-select-${u.id}`}
              >
                <Text style={themeStyle('tabs_AdminTab_47', { theme: theme }, (theme ?? _styleTheme))}>{checked ? '☑' : '☐'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={localStyles((theme ?? _styleTheme)).flex} onPress={() => onViewUser(u)}>
                <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_48', { theme: theme }, (theme ?? _styleTheme))]}>{u.email ?? u.id}</Text>
                {(u.firstName || u.lastName) ? (
                  <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_49', { theme: theme }, (theme ?? _styleTheme))]}>
                    {[u.firstName, u.lastName].filter(Boolean).join(' ')}
                  </Text>
                ) : null}
              </TouchableOpacity>
              <View style={localStyles((theme ?? _styleTheme)).tagRow}>
                {u.role === 'admin' ? (
                  <View style={[localStyles((theme ?? _styleTheme)).tagAdmin, themeStyle('tabs_AdminTab_50', { theme: theme }, (theme ?? _styleTheme))]}>
                    <Text style={localStyles((theme ?? _styleTheme)).tagText}>admin</Text>
                  </View>
                ) : null}
                {u.tierKey ? (
                  <View style={[localStyles((theme ?? _styleTheme)).tagTier, themeStyle('tabs_AdminTab_51', { theme: theme }, (theme ?? _styleTheme))]}>
                    <Text style={localStyles((theme ?? _styleTheme)).tagText}>{u.tierKey}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
      {totalPages > 1 ? (
        <View style={localStyles((theme ?? _styleTheme)).pagination}>
          <TouchableOpacity
            style={[
              localStyles((theme ?? _styleTheme)).pageButton,
              themeStyle('tabs_AdminTab_52', { theme: theme }, (theme ?? _styleTheme)),
              page === 1 && localStyles((theme ?? _styleTheme)).buttonDisabled,
            ]}
            disabled={page === 1}
            onPress={() => setPage((p) => p - 1)}
          >
            <Text style={localStyles((theme ?? _styleTheme)).pageButtonText}>Prev</Text>
          </TouchableOpacity>
          <Text style={[localStyles((theme ?? _styleTheme)).pageInfo, themeStyle('tabs_AdminTab_53', { theme: theme }, (theme ?? _styleTheme))]}>{page} / {totalPages}</Text>
          <TouchableOpacity
            style={[
              localStyles((theme ?? _styleTheme)).pageButton,
              themeStyle('tabs_AdminTab_54', { theme: theme }, (theme ?? _styleTheme)),
              page === totalPages && localStyles((theme ?? _styleTheme)).buttonDisabled,
            ]}
            disabled={page === totalPages}
            onPress={() => setPage((p) => p + 1)}
          >
            <Text style={localStyles((theme ?? _styleTheme)).pageButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

// --- User Detail ---
const UserDetailSection: React.FC<{
  backendUrl: string;
  headers: Record<string, string>;
  userId: string;
  tiers: Tier[];
  onBack: () => void;
} & ThemedSectionProps> = ({ backendUrl, headers, userId, tiers, onBack, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [availableTiers, setAvailableTiers] = useState<Tier[]>(tiers);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tierKey, setTierKey] = useState('');
  const [tierDropdownOpen, setTierDropdownOpen] = useState(false);
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [tierReason, setTierReason] = useState('');
  const [roleReason, setRoleReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userData, tierData] = await Promise.all([
        apiFetch(backendUrl, headers, `/users/${userId}`),
        tiers.length ? Promise.resolve({ tiers }) : apiFetch(backendUrl, headers, '/tiers'),
      ]);
      const data = userData as AdminUserDetail;
      setUser(data);
      setTierKey(data.role === 'admin' ? 'pro' : (data.tierKey ?? ''));
      setRole(data.role === 'admin' ? 'admin' : 'user');
      setAvailableTiers((tierData as any).tiers ?? tiers);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers, tiers, userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tiers.length) setAvailableTiers(tiers);
  }, [tiers]);

  const saveTier = async () => {
    if (!tierKey.trim() || tierReason.trim().length < 3) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await apiFetch(backendUrl, headers, `/users/${userId}/tier`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierKey: tierKey.trim(), reason: tierReason.trim() }),
      });
      setSaveMsg('Tier updated.');
      setTierReason('');
      await load();
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveRole = async () => {
    if (roleReason.trim().length < 3) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await apiFetch(backendUrl, headers, `/users/${userId}/role`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, reason: roleReason.trim() }),
      });
      setSaveMsg('Role updated.');
      setRoleReason('');
      await load();
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Text style={[localStyles((theme ?? _styleTheme)).loading, themeStyle('tabs_AdminTab_55', { theme: theme }, (theme ?? _styleTheme))]}>Loading...</Text>;
  if (error) return <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_56', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text>;
  if (!user) return null;

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.id;
  const tierLocked = user.role === 'admin';
  const currentTierKey = tierLocked ? 'pro' : (user.tierKey ?? 'none');
  const sortedTiers = [...availableTiers].sort((a, b) => a.rank - b.rank);
  const selectedTierLabel = sortedTiers.find((tier) => tier.key === tierKey)?.displayName ?? tierKey ?? '';

  return (
    <View style={localStyles((theme ?? _styleTheme)).section}>
      <TouchableOpacity onPress={onBack} style={localStyles((theme ?? _styleTheme)).backLink}>
        <Text style={[localStyles((theme ?? _styleTheme)).backLinkText, themeStyle('tabs_AdminTab_57', { theme: theme }, (theme ?? _styleTheme))]}>Back to Users</Text>
      </TouchableOpacity>
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_58', { theme: theme }, (theme ?? _styleTheme))]}>{displayName}</Text>
      <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_59', { theme: theme }, (theme ?? _styleTheme))]}>{user.email}</Text>

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_60', { theme: theme }, (theme ?? _styleTheme))]}>Current Tier: {currentTierKey}</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).fieldLabel, themeStyle('tabs_AdminTab_61', { theme: theme }, (theme ?? _styleTheme))]}>Change Tier</Text>
        {!tierLocked ? (
          <TouchableOpacity
            testID="user-tier-dropdown-button"
            style={[localStyles((theme ?? _styleTheme)).dropdownButton, getInputStyle(theme)]}
            onPress={() => setTierDropdownOpen((open) => !open)}
          >
            <Text style={[localStyles((theme ?? _styleTheme)).dropdownButtonText, themeStyle('tabs_AdminTab_62', { theme: theme }, (theme ?? _styleTheme))]}>
              {selectedTierLabel || 'Select a tier'} v
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[localStyles((theme ?? _styleTheme)).dropdownButton, getInputStyle(theme), localStyles((theme ?? _styleTheme)).dropdownLocked]}>
            <Text style={[localStyles((theme ?? _styleTheme)).dropdownButtonText, themeStyle('tabs_AdminTab_63', { theme: theme }, (theme ?? _styleTheme))]}>Pro (locked for admins)</Text>
          </View>
        )}
        {tierDropdownOpen && !tierLocked ? (
          <View style={[localStyles((theme ?? _styleTheme)).dropdownMenu, getCardStyle(theme, 0.18, 8, 18)]}>
            {sortedTiers.map((tier) => (
              <Pressable
                key={tier.key}
                testID={`user-tier-option-${tier.key}`}
                style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                  localStyles((theme ?? _styleTheme)).dropdownOption,
                  hovered && themeStyle('tabs_AdminTab_64', { theme: theme }, (theme ?? _styleTheme)),
                  pressed && themeStyle('tabs_AdminTab_65', { theme: theme }, (theme ?? _styleTheme)),
                  tierKey === tier.key && themeStyle('tabs_AdminTab_66', { theme: theme }, (theme ?? _styleTheme)),
                ]}
                onPress={() => {
                  setTierKey(tier.key);
                  setTierDropdownOpen(false);
                }}
              >
                <Text style={[localStyles((theme ?? _styleTheme)).dropdownOptionText, themeStyle('tabs_AdminTab_67', { theme: theme }, (theme ?? _styleTheme))]}>
                  {tier.displayName}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {tierLocked ? (
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_68', { theme: theme }, (theme ?? _styleTheme))]}>Admin users are automatically assigned the Pro tier.</Text>
        ) : (
          <>
            <TextInput
              testID="user-tier-reason-input"
              style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
              placeholder="Reason (required)"
              placeholderTextColor={theme.colors.textMuted}
              value={tierReason}
              onChangeText={setTierReason}
            />
            <TouchableOpacity
              testID="user-tier-save-button"
              style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_69', { theme: theme }, (theme ?? _styleTheme)), saving && localStyles((theme ?? _styleTheme)).buttonDisabled]}
              disabled={saving}
              onPress={saveTier}
            >
              <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Save Tier</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_70', { theme: theme }, (theme ?? _styleTheme))]}>Current Role: {user.role}</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).fieldLabel, themeStyle('tabs_AdminTab_71', { theme: theme }, (theme ?? _styleTheme))]}>Change Role</Text>
        <View style={localStyles((theme ?? _styleTheme)).tierButtons}>
          {(['user', 'admin'] as const).map((r) => (
            <TouchableOpacity
              key={r}
              style={[localStyles((theme ?? _styleTheme)).tierButton, getSecondaryPillStyle(theme, role === r)]}
              onPress={() => setRole(r)}
            >
              <Text style={[localStyles((theme ?? _styleTheme)).tierButtonText, getSecondaryPillTextStyle(theme, role === r)]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {role === 'admin' ? (
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_72', { theme: theme }, (theme ?? _styleTheme))]}>Saving the admin role will also set the tier to Pro.</Text>
        ) : null}
        <TextInput
          testID="user-role-reason-input"
          style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
          placeholder="Reason (required)"
          placeholderTextColor={theme.colors.textMuted}
          value={roleReason}
          onChangeText={setRoleReason}
        />
        <TouchableOpacity
          testID="user-role-save-button"
          style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_73', { theme: theme }, (theme ?? _styleTheme)), saving && localStyles((theme ?? _styleTheme)).buttonDisabled]}
          disabled={saving}
          onPress={saveRole}
        >
          <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Save Role</Text>
        </TouchableOpacity>
      </View>

      {saveMsg ? <Text style={[localStyles((theme ?? _styleTheme)).saveMsg, themeStyle('tabs_AdminTab_74', { saveMsg: saveMsg, theme: theme }, (theme ?? _styleTheme))]}>{saveMsg}</Text> : null}

      {user.usage && user.usage.length > 0 ? (
        <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
          <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_75', { theme: theme }, (theme ?? _styleTheme))]}>Usage</Text>
          {user.usage.map((c, i) => (
            <View key={i} style={localStyles((theme ?? _styleTheme)).row}>
              <Text style={[localStyles((theme ?? _styleTheme)).flex, themeStyle('tabs_AdminTab_76', { theme: theme }, (theme ?? _styleTheme))]}>{c.metricKey} ({c.windowKey})</Text>
              <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_77', { theme: theme }, (theme ?? _styleTheme))]}>{c.count}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
};

// --- Tiers ---
const TiersSection: React.FC<{
  backendUrl: string;
  headers: Record<string, string>;
  onTiersLoaded: (tiers: Tier[]) => void;
  theme: AppTheme;
}> = ({ backendUrl, headers, onTiersLoaded, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingLimit, setEditingLimit] = useState<{ tierKey: string; limitKey: string } | null>(null);
  const [limitValue, setLimitValue] = useState('');
  const [limitReason, setLimitReason] = useState('');
  const [editingEntitlement, setEditingEntitlement] = useState<{ tierKey: string; featureKey: string } | null>(null);
  const [entitlementReason, setEntitlementReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const tierColumns = [...tiers].sort((a, b) => a.rank - b.rank);
  const nameColumnWidth = 220;
  const tierColumnWidth = 132;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(backendUrl, headers, '/tiers');
      setTiers(data.tiers ?? []);
      onTiersLoaded(data.tiers ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers, onTiersLoaded]);

  useEffect(() => { load(); }, [load]);

  const limitRows: TierTableRow[] = React.useMemo(() => {
    const allLimitKeys = Array.from(new Set(tiers.flatMap((tier) => tier.limits.map((limit) => limit.limitKey))));
    return allLimitKeys.map((limitKey) => ({
      kind: 'limit',
      key: limitKey,
      label: limitKey,
      values: Object.fromEntries(
        tierColumns.map((tier) => [
          tier.key,
          {
            explicitValue: tier.limits.find((limit) => limit.limitKey === limitKey)?.limitValue ?? null,
          },
        ])
      ),
    }));
  }, [tierColumns, tiers]);

  const featureRows: TierTableRow[] = React.useMemo(() => {
    const allFeatureKeys = Array.from(
      new Set(
        tiers.flatMap((tier) =>
          tier.entitlements
            .filter((entitlement) => Boolean(entitlement.featureKey))
            .map((entitlement) => entitlement.featureKey as string)
        )
      )
    );

    return allFeatureKeys.map((featureKey) => ({
      kind: 'feature',
      key: featureKey,
      label: featureKey,
      values: Object.fromEntries((() => {
        let inheritedSource: { tierKey: string; displayName: string; value: boolean } | null = null;
        return tierColumns.map((tier) => {
          const explicitValue =
            tier.entitlements.find((entitlement) => entitlement.featureKey === featureKey)?.isAllowed ?? null;
          if (explicitValue !== null) {
            inheritedSource = {
              tierKey: tier.key,
              displayName: tier.displayName,
              value: explicitValue,
            };
            return [
              tier.key,
              {
                explicitValue,
                effectiveValue: explicitValue,
                isInherited: false,
                inheritedFromTierKey: null,
                inheritedFromTierDisplayName: null,
              },
            ];
          }

          if (inheritedSource) {
            return [
              tier.key,
              {
                explicitValue: null,
                effectiveValue: inheritedSource.value,
                isInherited: true,
                inheritedFromTierKey: inheritedSource.tierKey,
                inheritedFromTierDisplayName: inheritedSource.displayName,
              },
            ];
          }

          return [
            tier.key,
            {
              explicitValue: null,
              effectiveValue: null,
              isInherited: false,
              inheritedFromTierKey: null,
              inheritedFromTierDisplayName: null,
            },
          ];
        });
      })()),
    }));
  }, [tierColumns, tiers]);

  const tableRows = [...limitRows, ...featureRows];
  const currentEditingLimitValue =
    editingLimit === null
      ? null
      : tiers
          .find((tier) => tier.key === editingLimit.tierKey)
          ?.limits.find((limit) => limit.limitKey === editingLimit.limitKey)?.limitValue ?? null;

  const resetLimitDialog = () => {
    setEditingLimit(null);
    setLimitValue('');
    setLimitReason('');
  };

  const resetEntitlementDialog = () => {
    setEditingEntitlement(null);
    setEntitlementReason('');
  };

  const saveLimit = async (tierKey: string, limitKey: string) => {
    if (limitReason.trim().length < 3) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await apiFetch(backendUrl, headers, `/tiers/${tierKey}/limits/${limitKey}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limitValue: Number(limitValue), reason: limitReason.trim() }),
      });
      setSaveMsg('Limit updated.');
      resetLimitDialog();
      await load();
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveEntitlement = async (tierKey: string, featureKey: string, isAllowed: boolean) => {
    if (entitlementReason.trim().length < 3) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await apiFetch(backendUrl, headers, `/tiers/${tierKey}/features/${featureKey}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAllowed, reason: entitlementReason.trim() }),
      });
      setSaveMsg('Entitlement updated.');
      resetEntitlementDialog();
      await load();
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Text style={[localStyles((theme ?? _styleTheme)).loading, themeStyle('tabs_AdminTab_78', { theme: theme }, (theme ?? _styleTheme))]}>Loading...</Text>;
  if (error) return <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_79', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text>;

  return (
    <View style={localStyles((theme ?? _styleTheme)).section}>
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_80', { theme: theme }, (theme ?? _styleTheme))]}>Tiers</Text>
      {saveMsg ? <Text style={[localStyles((theme ?? _styleTheme)).saveMsg, themeStyle('tabs_AdminTab_81', { theme: theme }, (theme ?? _styleTheme))]}>{saveMsg}</Text> : null}
      {tiers.length === 0 ? <Text style={[localStyles((theme ?? _styleTheme)).emptyText, themeStyle('tabs_AdminTab_82', { theme: theme }, (theme ?? _styleTheme))]}>No tiers found.</Text> : null}
      {tiers.length > 0 ? (
        <View
          style={[
            localStyles((theme ?? _styleTheme)).tableShell,
            themeStyle('tabs_AdminTab_83', { theme: theme, shadowStyle: shadowStyle }, (theme ?? _styleTheme)),
          ]}
        >
          <HorizontalTableScroll>
            <View>
              <View
                style={[
                  localStyles((theme ?? _styleTheme)).tableHeaderRow,
                  themeStyle('tabs_AdminTab_84', { theme: theme }, (theme ?? _styleTheme)),
                ]}
              >
                <View
                  style={[
                    localStyles((theme ?? _styleTheme)).tableNameCell,
                    localStyles((theme ?? _styleTheme)).tableHeaderCell,
                    themeStyle('tabs_AdminTab_85', { nameColumnWidth: nameColumnWidth, theme: theme }, (theme ?? _styleTheme)),
                  ]}
                >
                  <Text style={[localStyles((theme ?? _styleTheme)).tableHeaderText, themeStyle('tabs_AdminTab_86', { theme: theme }, (theme ?? _styleTheme))]}>Name</Text>
                </View>
                {tierColumns.map((tier) => (
                  <View
                    key={tier.key}
                    style={[
                      localStyles((theme ?? _styleTheme)).tableTierCell,
                      localStyles((theme ?? _styleTheme)).tableHeaderCell,
                      themeStyle('tabs_AdminTab_87', { tierColumnWidth: tierColumnWidth, theme: theme }, (theme ?? _styleTheme)),
                    ]}
                  >
                    <Text style={[localStyles((theme ?? _styleTheme)).tableHeaderText, themeStyle('tabs_AdminTab_88', { theme: theme }, (theme ?? _styleTheme))]}>
                      {tier.displayName}
                    </Text>
                  </View>
                ))}
              </View>

              <ScrollView style={localStyles((theme ?? _styleTheme)).tableBodyScroll} nestedScrollEnabled>
                {tableRows.map((row, index) => (
                  <View
                    key={row.key}
                    style={[
                      localStyles((theme ?? _styleTheme)).tableDataRow,
                      themeStyle('tabs_AdminTab_89', { index: index, theme: theme }, (theme ?? _styleTheme)),
                    ]}
                  >
                    <View
                      style={[
                        localStyles((theme ?? _styleTheme)).tableNameCell,
                        themeStyle('tabs_AdminTab_90', { nameColumnWidth: nameColumnWidth, theme: theme }, (theme ?? _styleTheme)),
                      ]}
                    >
                      <Text style={[localStyles((theme ?? _styleTheme)).tableNameText, themeStyle('tabs_AdminTab_91', { theme: theme }, (theme ?? _styleTheme))]}>{row.label}</Text>
                      <Text style={[localStyles((theme ?? _styleTheme)).tableMetaText, themeStyle('tabs_AdminTab_92', { theme: theme }, (theme ?? _styleTheme))]}>
                        {row.kind === 'limit' ? 'Limit' : 'Toggle'}
                      </Text>
                    </View>

                    {tierColumns.map((tier) => {
                      const cellValue = row.values[tier.key];

                      if (row.kind === 'limit') {
                        return (
                          <View
                            key={`${row.key}-${tier.key}`}
                            style={[
                              localStyles((theme ?? _styleTheme)).tableTierCell,
                              themeStyle('tabs_AdminTab_93', { tierColumnWidth: tierColumnWidth, theme: theme }, (theme ?? _styleTheme)),
                            ]}
                          >
                            <TouchableOpacity
                              accessibilityRole="button"
                              testID={`tier-limit-cell-${row.key}-${tier.key}`}
                              style={localStyles((theme ?? _styleTheme)).tableLinkButton}
                              onPress={() => {
                                setEditingLimit({ tierKey: tier.key, limitKey: row.key });
                                setLimitValue(cellValue.explicitValue === null ? '' : String(cellValue.explicitValue));
                                setLimitReason('');
                                setSaveMsg(null);
                              }}
                            >
                              <Text style={[localStyles((theme ?? _styleTheme)).tableLinkText, themeStyle('tabs_AdminTab_94', { theme: theme }, (theme ?? _styleTheme))]}>
                                {cellValue.explicitValue === null
                                  ? 'Not set'
                                  : cellValue.explicitValue === -1
                                    ? 'Unlimited'
                                    : String(cellValue.explicitValue)}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        );
                      }

                      const featureCell = cellValue as FeatureTableCell;
                      const isInherited = featureCell.isInherited;
                      const displayValue = featureCell.effectiveValue;
                      const isAllowed = displayValue === true;
                      const buttonBackgroundColor = isInherited
                        ? theme.colors.surfaceMuted
                        : isAllowed
                          ? theme.colors.success
                          : displayValue === false
                            ? theme.colors.alert
                            : theme.colors.backgroundAlt;
                      const buttonBorderColor = isInherited ? theme.colors.border : themeStyle('tabs_AdminTab_312', {  }, (theme ?? _styleTheme));
                      const primaryTextColor = isInherited
                        ? theme.colors.text
                        : displayValue === null
                          ? theme.colors.text
                          : themeStyle('tabs_AdminTab_313', {  }, (theme ?? _styleTheme));
                      const secondaryTextColor = isInherited ? theme.colors.textMuted : primaryTextColor;
                      const buttonLabel = isInherited
                        ? 'Inherited'
                        : displayValue === null
                          ? 'Not set'
                          : isAllowed
                            ? 'Enabled'
                            : 'Disabled';
                      const secondaryLabel = isInherited
                        ? `From ${featureCell.inheritedFromTierDisplayName ?? featureCell.inheritedFromTierKey ?? 'lower tier'}`
                        : null;

                      return (
                        <View
                          key={`${row.key}-${tier.key}`}
                          style={[
                            localStyles((theme ?? _styleTheme)).tableTierCell,
                            themeStyle('tabs_AdminTab_95', { tierColumnWidth: tierColumnWidth, theme: theme }, (theme ?? _styleTheme)),
                          ]}
                        >
                          <TouchableOpacity
                            accessibilityRole="button"
                            testID={`tier-feature-cell-${row.key}-${tier.key}`}
                            style={[
                              localStyles((theme ?? _styleTheme)).toggleCellButton,
                              themeStyle('tabs_AdminTab_96', { buttonBackgroundColor: buttonBackgroundColor, buttonBorderColor: buttonBorderColor, isInherited: isInherited }, (theme ?? _styleTheme)),
                            ]}
                            disabled={isInherited}
                            onPress={isInherited ? undefined : () => {
                              setEditingEntitlement({ tierKey: tier.key, featureKey: row.key });
                              setEntitlementReason('');
                              setSaveMsg(null);
                            }}
                          >
                            <Text style={[localStyles((theme ?? _styleTheme)).toggleCellText, themeStyle('tabs_AdminTab_97', { primaryTextColor: primaryTextColor }, (theme ?? _styleTheme))]}>
                              {buttonLabel}
                            </Text>
                            {secondaryLabel ? (
                              <Text style={[localStyles((theme ?? _styleTheme)).toggleCellSubtext, themeStyle('tabs_AdminTab_98', { secondaryTextColor: secondaryTextColor }, (theme ?? _styleTheme))]}>
                                {secondaryLabel}
                              </Text>
                            ) : null}
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>
            </View>
          </HorizontalTableScroll>
        </View>
      ) : null}

      <Modal
        transparent
        animationType="fade"
        visible={Boolean(editingLimit)}
        onRequestClose={resetLimitDialog}
      >
        {editingLimit ? (
          <View style={[localStyles((theme ?? _styleTheme)).modalBackdrop, themeStyle('tabs_AdminTab_99', {  }, (theme ?? _styleTheme))]}>
            <View
              style={[
                localStyles((theme ?? _styleTheme)).modalCard,
                themeStyle('tabs_AdminTab_100', { theme: theme }, (theme ?? _styleTheme)),
              ]}
            >
              <Text style={[localStyles((theme ?? _styleTheme)).modalTitle, themeStyle('tabs_AdminTab_101', { theme: theme }, (theme ?? _styleTheme))]}>Update limit</Text>
              <Text style={[localStyles((theme ?? _styleTheme)).modalBodyText, themeStyle('tabs_AdminTab_102', { theme: theme }, (theme ?? _styleTheme))]}>
                {editingLimit.limitKey} for {editingLimit.tierKey}
              </Text>
              <Text style={[localStyles((theme ?? _styleTheme)).modalBodyText, themeStyle('tabs_AdminTab_103', { theme: theme }, (theme ?? _styleTheme))]}>
                Current value:{' '}
                {currentEditingLimitValue === null
                  ? 'Not set'
                  : currentEditingLimitValue === -1
                    ? 'Unlimited'
                    : String(currentEditingLimitValue)}
              </Text>
              <TextInput
                testID="tier-limit-value-input"
                style={[
                  localStyles((theme ?? _styleTheme)).modalInput,
                  themeStyle('tabs_AdminTab_104', { theme: theme }, (theme ?? _styleTheme)),
                ]}
                placeholder="New number (-1 = unlimited)"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="numeric"
                value={limitValue}
                onChangeText={setLimitValue}
              />
              <TextInput
                testID="tier-limit-reason-input"
                style={[
                  localStyles((theme ?? _styleTheme)).modalInput,
                  localStyles((theme ?? _styleTheme)).modalTextArea,
                  themeStyle('tabs_AdminTab_105', { theme: theme }, (theme ?? _styleTheme)),
                ]}
                placeholder="Reason (required)"
                placeholderTextColor={theme.colors.textMuted}
                value={limitReason}
                onChangeText={setLimitReason}
                multiline
              />
              <View style={localStyles((theme ?? _styleTheme)).modalActions}>
                <TouchableOpacity
                  testID="tier-limit-cancel-button"
                  style={[
                    localStyles((theme ?? _styleTheme)).modalSecondaryButton,
                    themeStyle('tabs_AdminTab_106', { theme: theme }, (theme ?? _styleTheme)),
                  ]}
                  onPress={resetLimitDialog}
                >
                  <Text style={[localStyles((theme ?? _styleTheme)).modalSecondaryButtonText, themeStyle('tabs_AdminTab_107', { theme: theme }, (theme ?? _styleTheme))]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="tier-limit-save-button"
                  style={[
                    localStyles((theme ?? _styleTheme)).modalPrimaryButton,
                    themeStyle('tabs_AdminTab_108', { theme: theme }, (theme ?? _styleTheme)),
                    saving && localStyles((theme ?? _styleTheme)).buttonDisabled,
                  ]}
                  disabled={saving}
                  onPress={() => saveLimit(editingLimit.tierKey, editingLimit.limitKey)}
                >
                  <Text style={[[localStyles((theme ?? _styleTheme)).modalPrimaryButtonText, themeStyle('tabs_AdminTab_109', {  }, (theme ?? _styleTheme))], themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={Boolean(editingEntitlement)}
        onRequestClose={resetEntitlementDialog}
      >
        {editingEntitlement ? (
          <View style={[localStyles((theme ?? _styleTheme)).modalBackdrop, themeStyle('tabs_AdminTab_110', {  }, (theme ?? _styleTheme))]}>
            <View
              style={[
                localStyles((theme ?? _styleTheme)).modalCard,
                themeStyle('tabs_AdminTab_111', { theme: theme }, (theme ?? _styleTheme)),
              ]}
            >
              <Text style={[localStyles((theme ?? _styleTheme)).modalTitle, themeStyle('tabs_AdminTab_112', { theme: theme }, (theme ?? _styleTheme))]}>Change feature access</Text>
              <Text style={[localStyles((theme ?? _styleTheme)).modalBodyText, themeStyle('tabs_AdminTab_113', { theme: theme }, (theme ?? _styleTheme))]}>
                {editingEntitlement.featureKey} for {editingEntitlement.tierKey}
              </Text>
              <TextInput
                testID="tier-feature-reason-input"
                style={[
                  localStyles((theme ?? _styleTheme)).modalInput,
                  localStyles((theme ?? _styleTheme)).modalTextArea,
                  themeStyle('tabs_AdminTab_114', { theme: theme }, (theme ?? _styleTheme)),
                ]}
                placeholder="Reason (required)"
                placeholderTextColor={theme.colors.textMuted}
                value={entitlementReason}
                onChangeText={setEntitlementReason}
                multiline
              />
              <View style={localStyles((theme ?? _styleTheme)).modalActions}>
                <TouchableOpacity
                  testID="tier-feature-cancel-button"
                  style={[
                    localStyles((theme ?? _styleTheme)).modalSecondaryButton,
                    themeStyle('tabs_AdminTab_115', { theme: theme }, (theme ?? _styleTheme)),
                  ]}
                  onPress={resetEntitlementDialog}
                >
                  <Text style={[localStyles((theme ?? _styleTheme)).modalSecondaryButtonText, themeStyle('tabs_AdminTab_116', { theme: theme }, (theme ?? _styleTheme))]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="tier-feature-save-button"
                  style={[
                    localStyles((theme ?? _styleTheme)).modalPrimaryButton,
                    themeStyle('tabs_AdminTab_117', { theme: theme }, (theme ?? _styleTheme)),
                    saving && localStyles((theme ?? _styleTheme)).buttonDisabled,
                  ]}
                  disabled={saving}
                  onPress={() => {
                    const currentValue =
                      tiers
                        .find((tier) => tier.key === editingEntitlement.tierKey)
                        ?.entitlements.find((entitlement) => entitlement.featureKey === editingEntitlement.featureKey)
                        ?.isAllowed ?? false;
                    saveEntitlement(editingEntitlement.tierKey, editingEntitlement.featureKey, !currentValue);
                  }}
                >
                  <Text style={[[localStyles((theme ?? _styleTheme)).modalPrimaryButtonText, themeStyle('tabs_AdminTab_118', {  }, (theme ?? _styleTheme))], themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
};

// --- Metrics (in-process counters + cache hit-rates) ---
const MetricsSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [queueDepth, setQueueDepth] = useState<QueueDepthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [metricsData, queueData] = await Promise.all([
        apiFetch(backendUrl, headers, '/metrics') as Promise<MetricsSnapshot>,
        // Queue depth is a nice-to-have — if the sub-query fails we still want
        // the counters/cache snapshot to render rather than showing a
        // full-section error.
        (apiFetch(backendUrl, headers, '/ingestion-queue-depth') as Promise<QueueDepthSnapshot>).catch(() => null),
      ]);
      setSnapshot(metricsData);
      setQueueDepth(queueData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers]);

  useEffect(() => { load(); }, [load]);

  const fmtPct = (r: number) => `${(r * 100).toFixed(1)}%`;
  const nonCacheCounters = snapshot
    ? Object.entries(snapshot.counters)
        .filter(([name]) => !name.endsWith('.cache_hit') && !name.endsWith('.cache_miss'))
        .sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <View style={localStyles((theme ?? _styleTheme)).section} testID="admin-metrics-section">
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_119', { theme: theme }, (theme ?? _styleTheme))]}>Metrics</Text>
      <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_120', { theme: theme }, (theme ?? _styleTheme))]}>
        Per-instance in-process counters since process start. Multi-instance deployments will see per-instance numbers.
      </Text>
      <TouchableOpacity
        style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_121', { theme: theme }, (theme ?? _styleTheme))]}
        onPress={load}
        accessibilityRole="button"
        accessibilityLabel="Refresh metrics"
        testID="admin-metrics-refresh"
      >
        <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('tabs_AdminTab_122', { theme: theme }, (theme ?? _styleTheme))]}>Refresh</Text>
      </TouchableOpacity>
      {error ? <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_123', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text> : null}
      {loading && !snapshot ? <Text style={[localStyles((theme ?? _styleTheme)).loading, themeStyle('tabs_AdminTab_124', { theme: theme }, (theme ?? _styleTheme))]}>Loading...</Text> : null}

      {queueDepth ? (
        <View
          style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme), themeStyle('tabs_AdminTab_125', {  }, (theme ?? _styleTheme))]}
          testID="admin-metrics-queue-depth"
        >
          <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_126', { theme: theme }, (theme ?? _styleTheme))]}>
            Ingestion queue depth
          </Text>
          <View style={localStyles((theme ?? _styleTheme)).row}>
            <Text style={[localStyles((theme ?? _styleTheme)).cardSub, localStyles((theme ?? _styleTheme)).flex, themeStyle('tabs_AdminTab_127', { theme: theme }, (theme ?? _styleTheme))]}>Active</Text>
            <Text
              style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_128', { theme: theme }, (theme ?? _styleTheme))]}
              testID="admin-metrics-queue-active"
            >
              {queueDepth.totalActive}
            </Text>
          </View>
          <View style={localStyles((theme ?? _styleTheme)).row}>
            <Text style={[localStyles((theme ?? _styleTheme)).cardSub, localStyles((theme ?? _styleTheme)).flex, themeStyle('tabs_AdminTab_129', { theme: theme }, (theme ?? _styleTheme))]}>Failed (retriable)</Text>
            <Text
              style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_130', { theme: theme }, (theme ?? _styleTheme))]}
              testID="admin-metrics-queue-failed"
            >
              {queueDepth.failedRetriable}
            </Text>
          </View>
          <View style={localStyles((theme ?? _styleTheme)).row}>
            <Text style={[localStyles((theme ?? _styleTheme)).cardSub, localStyles((theme ?? _styleTheme)).flex, themeStyle('tabs_AdminTab_131', { theme: theme }, (theme ?? _styleTheme))]}>Terminal</Text>
            <Text
              style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_132', { theme: theme }, (theme ?? _styleTheme))]}
              testID="admin-metrics-queue-terminal"
            >
              {queueDepth.totalTerminal}
            </Text>
          </View>
          {Object.entries(queueDepth.countsByState).length > 0 ? (
            <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_133', { theme: theme }, (theme ?? _styleTheme))]}>
              {Object.entries(queueDepth.countsByState)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([state, n]) => `${state}:${n}`)
                .join(' • ')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {snapshot ? (
        <>
          <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_134', { theme: theme }, (theme ?? _styleTheme))]}>Cache hit rates</Text>
          {snapshot.cacheRatios.length === 0 ? (
            <Text style={[localStyles((theme ?? _styleTheme)).emptyText, themeStyle('tabs_AdminTab_135', { theme: theme }, (theme ?? _styleTheme))]}>
              No cache traffic observed yet on this instance.
            </Text>
          ) : (
            snapshot.cacheRatios.map((row) => (
              <View
                key={row.namespace}
                style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}
                testID={`admin-metrics-cache-row-${row.namespace}`}
              >
                <View style={localStyles((theme ?? _styleTheme)).row}>
                  <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, localStyles((theme ?? _styleTheme)).flex, themeStyle('tabs_AdminTab_136', { theme: theme }, (theme ?? _styleTheme))]}>{row.namespace}</Text>
                  <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_137', { theme: theme }, (theme ?? _styleTheme))]}>{fmtPct(row.hitRate)}</Text>
                </View>
                <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_138', { theme: theme }, (theme ?? _styleTheme))]}>
                  {row.hits} hits / {row.misses} misses ({row.total} total)
                </Text>
              </View>
            ))
          )}

          <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_139', { theme: theme }, (theme ?? _styleTheme))]}>Counters</Text>
          {nonCacheCounters.length === 0 ? (
            <Text style={[localStyles((theme ?? _styleTheme)).emptyText, themeStyle('tabs_AdminTab_140', { theme: theme }, (theme ?? _styleTheme))]}>No counter activity on this instance.</Text>
          ) : (
            nonCacheCounters.map(([name, value]) => (
              <View key={name} style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]} testID={`admin-metrics-counter-${name}`}>
                <View style={localStyles((theme ?? _styleTheme)).row}>
                  <Text style={[localStyles((theme ?? _styleTheme)).cardSub, localStyles((theme ?? _styleTheme)).flex, themeStyle('tabs_AdminTab_141', { theme: theme }, (theme ?? _styleTheme))]}>{name}</Text>
                  <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_142', { theme: theme }, (theme ?? _styleTheme))]}>{value}</Text>
                </View>
              </View>
            ))
          )}

          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_143', { theme: theme }, (theme ?? _styleTheme))]}>
            Accumulating since {new Date(snapshot.startedAtIso).toLocaleString()}
          </Text>
        </>
      ) : null}
    </View>
  );
};

// --- User Data ---
const UserDataSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [rows, setRows] = useState<UserDataRow[]>([]);
  const [total, setTotal] = useState(0);
  const [window, setWindow] = usePersistedState<'7d' | '30d' | 'all-time'>(
    'admin.userData.window',
    '30d'
  );
  const [page, setPage] = usePersistedState<number>('admin.userData.page', 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const load = useCallback(async (w: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ window: w, page: String(p), limit: String(limit) });
      const data = await apiFetch(backendUrl, headers, `/user-data?${params}`);
      setRows(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers]);

  useEffect(() => { load(window, page); }, [load, window, page]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <View style={localStyles((theme ?? _styleTheme)).section}>
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_144', { theme: theme }, (theme ?? _styleTheme))]}>User Data</Text>
      <View style={localStyles((theme ?? _styleTheme)).tierButtons}>
        {(['7d', '30d', 'all-time'] as const).map((w) => (
          <TouchableOpacity
            key={w}
            style={[localStyles((theme ?? _styleTheme)).tierButton, getSecondaryPillStyle(theme, window === w)]}
            onPress={() => { setWindow(w); setPage(1); }}
          >
            <Text style={[localStyles((theme ?? _styleTheme)).tierButtonText, getSecondaryPillTextStyle(theme, window === w)]}>{w}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_145', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text> : null}
      {loading ? <Text style={[localStyles((theme ?? _styleTheme)).loading, themeStyle('tabs_AdminTab_146', { theme: theme }, (theme ?? _styleTheme))]}>Loading...</Text> : null}
      {!loading && rows.length === 0 ? <Text style={[localStyles((theme ?? _styleTheme)).emptyText, themeStyle('tabs_AdminTab_147', { theme: theme }, (theme ?? _styleTheme))]}>No data.</Text> : null}
      {rows.map((row) => (
        <View key={row.id} style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
          <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_148', { theme: theme }, (theme ?? _styleTheme))]}>{row.email ?? row.id}</Text>
          <View style={localStyles((theme ?? _styleTheme)).tagRow}>
            {row.role === 'admin' ? <View style={[localStyles((theme ?? _styleTheme)).tagAdmin, themeStyle('tabs_AdminTab_149', { theme: theme }, (theme ?? _styleTheme))]}><Text style={localStyles((theme ?? _styleTheme)).tagText}>admin</Text></View> : null}
            {row.tierKey ? <View style={[localStyles((theme ?? _styleTheme)).tagTier, themeStyle('tabs_AdminTab_150', { theme: theme }, (theme ?? _styleTheme))]}><Text style={localStyles((theme ?? _styleTheme)).tagText}>{row.tierKey}</Text></View> : null}
          </View>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_151', { theme: theme }, (theme ?? _styleTheme))]}>Trips: {row.tripCount}</Text>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_152', { theme: theme }, (theme ?? _styleTheme))]}>Trip creations: {row.tripCreations}</Text>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_153', { theme: theme }, (theme ?? _styleTheme))]}>AI generations: {row.aiGenerations}</Text>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_154', { theme: theme }, (theme ?? _styleTheme))]}>Tokens: {row.tokens}</Text>
          {row.apiCalls ? (
            <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_155', { theme: theme }, (theme ?? _styleTheme))]}>
              API calls: {Object.entries(row.apiCalls).map(([key, value]) => `${key} ${value}`).join(' | ')}
            </Text>
          ) : null}
        </View>
      ))}
      {totalPages > 1 ? (
        <View style={localStyles((theme ?? _styleTheme)).pagination}>
          <TouchableOpacity
            style={[localStyles((theme ?? _styleTheme)).pageButton, themeStyle('tabs_AdminTab_156', { theme: theme }, (theme ?? _styleTheme)), page === 1 && localStyles((theme ?? _styleTheme)).buttonDisabled]}
            disabled={page === 1}
            onPress={() => setPage((p) => p - 1)}
          >
            <Text style={localStyles((theme ?? _styleTheme)).pageButtonText}>Prev</Text>
          </TouchableOpacity>
          <Text style={[localStyles((theme ?? _styleTheme)).pageInfo, themeStyle('tabs_AdminTab_157', { theme: theme }, (theme ?? _styleTheme))]}>{page} / {totalPages}</Text>
          <TouchableOpacity
            style={[localStyles((theme ?? _styleTheme)).pageButton, themeStyle('tabs_AdminTab_158', { theme: theme }, (theme ?? _styleTheme)), page === totalPages && localStyles((theme ?? _styleTheme)).buttonDisabled]}
            disabled={page === totalPages}
            onPress={() => setPage((p) => p + 1)}
          >
            <Text style={localStyles((theme ?? _styleTheme)).pageButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

// --- Audit Log ---
const AuditLogSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 25;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      const data = await apiFetch(backendUrl, headers, `/audit-log?${params}`);
      setEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers]);

  useEffect(() => { load(page); }, [load, page]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const fmt = (s: string) => new Date(s).toLocaleString();

  return (
    <View style={localStyles((theme ?? _styleTheme)).section}>
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_159', { theme: theme }, (theme ?? _styleTheme))]}>Audit Log</Text>
      {error ? <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_160', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text> : null}
      {loading ? <Text style={[localStyles((theme ?? _styleTheme)).loading, themeStyle('tabs_AdminTab_161', { theme: theme }, (theme ?? _styleTheme))]}>Loading...</Text> : null}
      {!loading && entries.length === 0 ? <Text style={[localStyles((theme ?? _styleTheme)).emptyText, themeStyle('tabs_AdminTab_162', { theme: theme }, (theme ?? _styleTheme))]}>No audit entries.</Text> : null}
      {entries.map((entry) => (
        <View key={entry.id} style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
          <View style={localStyles((theme ?? _styleTheme)).row}>
            <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, localStyles((theme ?? _styleTheme)).flex, themeStyle('tabs_AdminTab_163', { theme: theme }, (theme ?? _styleTheme))]}>{entry.action}</Text>
            <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_164', { theme: theme }, (theme ?? _styleTheme))]}>{fmt(entry.createdAt)}</Text>
          </View>
          {entry.reason ? <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_165', { theme: theme }, (theme ?? _styleTheme))]}>Reason: {entry.reason}</Text> : null}
          {entry.actorUserId ? <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_166', { theme: theme }, (theme ?? _styleTheme))]}>Actor: {entry.actorUserId}</Text> : null}
          {entry.targetUserId ? <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_167', { theme: theme }, (theme ?? _styleTheme))]}>Target: {entry.targetUserId}</Text> : null}
        </View>
      ))}
      {totalPages > 1 ? (
        <View style={localStyles((theme ?? _styleTheme)).pagination}>
          <TouchableOpacity
            style={[localStyles((theme ?? _styleTheme)).pageButton, themeStyle('tabs_AdminTab_168', { theme: theme }, (theme ?? _styleTheme)), page === 1 && localStyles((theme ?? _styleTheme)).buttonDisabled]}
            disabled={page === 1}
            onPress={() => setPage((p) => p - 1)}
          >
            <Text style={localStyles((theme ?? _styleTheme)).pageButtonText}>Prev</Text>
          </TouchableOpacity>
          <Text style={[localStyles((theme ?? _styleTheme)).pageInfo, themeStyle('tabs_AdminTab_169', { theme: theme }, (theme ?? _styleTheme))]}>{page} / {totalPages}</Text>
          <TouchableOpacity
            style={[localStyles((theme ?? _styleTheme)).pageButton, themeStyle('tabs_AdminTab_170', { theme: theme }, (theme ?? _styleTheme)), page === totalPages && localStyles((theme ?? _styleTheme)).buttonDisabled]}
            disabled={page === totalPages}
            onPress={() => setPage((p) => p + 1)}
          >
            <Text style={localStyles((theme ?? _styleTheme)).pageButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const IngestionSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [metrics, setMetrics] = useState<IngestionMetrics | null>(null);
  const [shadowParseSummary, setShadowParseSummary] = useState<ShadowParseSummary | null>(null);
  const [shadowParseError, setShadowParseError] = useState<string | null>(null);
  const [retryConfig, setRetryConfig] = useState<RetryPolicyConfig | null>(null);
  const [retryForm, setRetryForm] = useState({
    maxAttempts: '',
    baseDelaySeconds: '',
    maxDelaySeconds: '',
    alertThresholdPercent: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Every /ingestion/* route in this section 403s (code: none, just a flat "currently disabled"
  // message) when feature_ingest_admin_observability is off. Previously this panel auto-fetched
  // on mount with no awareness of that, so simply opening this admin tab while the flag was off
  // would surface the global "Permission Denied" popup with zero user action involved — same
  // failure mode as the trip-day map bug. `null` = still checking; only fetch (or render the
  // panel at all) once we know the flag is actually on.
  const [observabilityEnabled, setObservabilityEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch(backendUrl, headers, '/features');
        const flags = Array.isArray(data?.features) ? data.features : [];
        const flag = flags.find((f: any) => f?.key === 'feature_ingest_admin_observability');
        // No row for this key is the server's own fail-open default for it — see
        // isFeatureEnabled's FAIL_CLOSED_FLAGS exclusion list.
        if (!cancelled) setObservabilityEnabled(flag ? flag.enabled === true : true);
      } catch {
        // Best-effort: if the flags list itself can't be fetched, fall back to attempting the
        // real panel load rather than hiding it outright on an unrelated network hiccup.
        if (!cancelled) setObservabilityEnabled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, headers]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const [metricsData, retryConfigData] = await Promise.all([
        apiFetch(backendUrl, headers, '/ingestion/metrics'),
        apiFetch(backendUrl, headers, '/ingestion/retry-config'),
      ]);
      setMetrics(metricsData as IngestionMetrics);
      const config = retryConfigData as RetryPolicyConfig;
      setRetryConfig(config);
      setRetryForm({
        maxAttempts: String(config.maxAttempts),
        baseDelaySeconds: String(config.baseDelaySeconds),
        maxDelaySeconds: String(config.maxDelaySeconds),
        alertThresholdPercent: String(config.alertThresholdPercent),
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // Fetched independently: a shadow-parse read failure (e.g. no local capture
    // archive on this instance) shouldn't block the rest of the ingestion panel.
    try {
      setShadowParseError(null);
      const summary = await apiFetch(backendUrl, headers, '/ingestion/shadow-parse-summary');
      setShadowParseSummary(summary as ShadowParseSummary);
    } catch (e: any) {
      setShadowParseError(e.message);
    }
  }, [backendUrl, headers]);

  useEffect(() => {
    if (observabilityEnabled) load();
  }, [observabilityEnabled, load]);

  if (observabilityEnabled === false) {
    return (
      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_171', { theme: theme }, (theme ?? _styleTheme))]}>Ingestion</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_172', { theme: theme }, (theme ?? _styleTheme))]}>
          Ingestion observability is currently disabled (feature_ingest_admin_observability).
        </Text>
      </View>
    );
  }

  const saveRetryConfig = async () => {
    try {
      await apiFetch(backendUrl, headers, '/ingestion/retry-config', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxAttempts: Number(retryForm.maxAttempts),
          baseDelaySeconds: Number(retryForm.baseDelaySeconds),
          maxDelaySeconds: Number(retryForm.maxDelaySeconds),
          alertThresholdPercent: Number(retryForm.alertThresholdPercent),
        }),
      });
      setMessage('Retry policy updated.');
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const clearCache = async () => {
    try {
      const result = await apiFetch(backendUrl, headers, '/ingestion/clear-cache', {
        method: 'POST',
      });
      setMessage(`Extraction cache cleared: ${result.deleted ?? 0} entries removed.`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const redriveDeadLetters = async (provider: 'ALL' | 'MAILGUN' | 'GMAIL') => {
    try {
      const result = await apiFetch(backendUrl, headers, '/ingestion/dead-letter/re-drive', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      setMessage(`Re-drive queued for ${provider}: ${result.retried ?? 0} jobs.`);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (loading) return <Text style={[localStyles((theme ?? _styleTheme)).loading, themeStyle('tabs_AdminTab_173', { theme: theme }, (theme ?? _styleTheme))]}>Loading...</Text>;
  if (error) return <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_174', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text>;
  if (!metrics) return null;

  const duplicateRate = metrics.duplicateRate.totalCount
    ? `${Math.round((metrics.duplicateRate.duplicateCount / metrics.duplicateRate.totalCount) * 100)}%`
    : '0%';
  const lowConfidenceRate = metrics.lowConfidenceRate.totalCount
    ? `${Math.round((metrics.lowConfidenceRate.lowConfidenceCount / metrics.lowConfidenceRate.totalCount) * 100)}%`
    : '0%';

  return (
    <View style={localStyles((theme ?? _styleTheme)).section}>
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_175', { theme: theme }, (theme ?? _styleTheme))]}>Ingestion Operations</Text>
      {message ? <Text style={[localStyles((theme ?? _styleTheme)).saveMsg, themeStyle('tabs_AdminTab_176', { theme: theme }, (theme ?? _styleTheme))]}>{message}</Text> : null}
      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_177', { theme: theme }, (theme ?? _styleTheme))]}>Duplicate Rate</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_178', { theme: theme }, (theme ?? _styleTheme))]}>{duplicateRate}</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_179', { theme: theme }, (theme ?? _styleTheme))]}>Low Confidence Rate</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_180', { theme: theme }, (theme ?? _styleTheme))]}>{lowConfidenceRate}</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_181', { theme: theme }, (theme ?? _styleTheme))]}>Retries / Dead Letters</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_182', { theme: theme }, (theme ?? _styleTheme))]}>
          {metrics.retryAndDeadLetter.retryCount} retries • {metrics.retryAndDeadLetter.deadLetterCount} dead-lettered
        </Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_183', { theme: theme }, (theme ?? _styleTheme))]}>Gmail Auth Failures</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_184', { theme: theme }, (theme ?? _styleTheme))]}>{metrics.gmailAuthFailures}</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_185', { theme: theme }, (theme ?? _styleTheme))]}>Webhook Signature Failures</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_186', { theme: theme }, (theme ?? _styleTheme))]}>{metrics.webhookSignatureFailures}</Text>
      </View>

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_187', { theme: theme }, (theme ?? _styleTheme))]}>Ingestion Volume by Source and Tier</Text>
        {metrics.ingestionVolumeBySourceAndTier.map((row) => (
          <Text key={`${row.sourceType}-${row.tierKey}`} style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_188', { theme: theme }, (theme ?? _styleTheme))]}>
            {row.sourceType} • {row.tierKey}: {row.count}
          </Text>
        ))}
      </View>

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_189', { theme: theme }, (theme ?? _styleTheme))]}>Parse Success / Failure by Stage</Text>
        {metrics.parseRateByStage.map((row) => (
          <Text key={row.stageName} style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_190', { theme: theme }, (theme ?? _styleTheme))]}>
            {row.stageName}: {row.successCount} success • {row.failureCount} failure
          </Text>
        ))}
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_191', { theme: theme }, (theme ?? _styleTheme))]}>Average Processing Latency</Text>
        {metrics.averageLatencyByStage.map((row) => (
          <Text key={row.stageName} style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_192', { theme: theme }, (theme ?? _styleTheme))]}>
            {row.stageName}: {row.averageMs} ms
          </Text>
        ))}
      </View>

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_193', { theme: theme }, (theme ?? _styleTheme))]}>Shadow-Parse Quality (LLM vs. production)</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_194', { theme: theme }, (theme ?? _styleTheme))]}>
          How often a sampled shadow LLM extraction agreed with whatever strategy actually served the item. Reads this
          instance's local capture archive only, so numbers reflect recent traffic on this server, not a global total.
        </Text>
        {shadowParseError ? (
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_195', { theme: theme }, (theme ?? _styleTheme))]}>{shadowParseError}</Text>
        ) : !shadowParseSummary || shadowParseSummary.comparedSampleCount === 0 ? (
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_196', { theme: theme }, (theme ?? _styleTheme))]}>No shadow-parse samples captured on this instance yet.</Text>
        ) : (
          <>
            <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_197', { theme: theme }, (theme ?? _styleTheme))]}>
              Overall: {Math.round(shadowParseSummary.averageAgreementRate! * 100)}% agreement
            </Text>
            <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_198', { theme: theme }, (theme ?? _styleTheme))]}>
              {shadowParseSummary.comparedSampleCount} of {shadowParseSummary.sampleCount} sampled captures had a comparison
            </Text>
            {shadowParseSummary.byItemType.map((row) => (
              <Text key={row.itemType} style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_199', { theme: theme }, (theme ?? _styleTheme))]}>
                {row.itemType}: {Math.round(row.averageAgreementRate * 100)}% agreement ({row.sampleCount} samples)
              </Text>
            ))}
            {shadowParseSummary.topMismatchedFields.length ? (
              <>
                <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_200', { theme: theme }, (theme ?? _styleTheme))]}>Most-mismatched fields</Text>
                {shadowParseSummary.topMismatchedFields.map((row) => (
                  <Text key={`${row.itemType}-${row.fieldName}`} style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_201', { theme: theme }, (theme ?? _styleTheme))]}>
                    {row.itemType}.{row.fieldName}: {row.mismatchCount} mismatches
                  </Text>
                ))}
              </>
            ) : (
              <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_202', { theme: theme }, (theme ?? _styleTheme))]}>
                Per-field mismatch detail isn't retained in production captures (stripped for privacy before persisting) —
                only available when reading a local/dev capture archive.
              </Text>
            )}
          </>
        )}
      </View>

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_203', { theme: theme }, (theme ?? _styleTheme))]}>LLM Usage and Estimated Cost</Text>
        {metrics.llmUsageByModel.map((row) => (
          <Text key={`${row.provider}-${row.modelName}`} style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_204', { theme: theme }, (theme ?? _styleTheme))]}>
            {row.provider} / {row.modelName}: {row.tokensIn} in • {row.tokensOut} out • ${row.estimatedCostUsd.toFixed(2)}
          </Text>
        ))}
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_205', { theme: theme }, (theme ?? _styleTheme))]}>Cost per User</Text>
        {metrics.costPerUser.map((row) => (
          <Text key={row.userId} style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_206', { theme: theme }, (theme ?? _styleTheme))]}>
            {row.userId}: ${row.estimatedCostUsd.toFixed(2)}
          </Text>
        ))}
      </View>

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_207', { theme: theme }, (theme ?? _styleTheme))]}>Quota Consumption by User / Tier</Text>
        {metrics.quotaByUserTier.map((row) => (
          <Text key={row.userId} style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_208', { theme: theme }, (theme ?? _styleTheme))]}>
            {row.userId} • {row.tierKey}: {row.uploadsUsed}
          </Text>
        ))}
      </View>

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_209', { theme: theme }, (theme ?? _styleTheme))]}>Retry Policy</Text>
        {retryConfig ? (
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_210', { theme: theme }, (theme ?? _styleTheme))]}>
            Last updated: {new Date(retryConfig.updatedAt).toLocaleString()}
          </Text>
        ) : null}
        <TextInput
          style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
          value={retryForm.maxAttempts}
          onChangeText={(value: string) => setRetryForm((current) => ({ ...current, maxAttempts: value }))}
          placeholder="Max attempts"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TextInput
          style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
          value={retryForm.baseDelaySeconds}
          onChangeText={(value: string) => setRetryForm((current) => ({ ...current, baseDelaySeconds: value }))}
          placeholder="Base delay seconds"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TextInput
          style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
          value={retryForm.maxDelaySeconds}
          onChangeText={(value: string) => setRetryForm((current) => ({ ...current, maxDelaySeconds: value }))}
          placeholder="Max delay seconds"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TextInput
          style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
          value={retryForm.alertThresholdPercent}
          onChangeText={(value: string) => setRetryForm((current) => ({ ...current, alertThresholdPercent: value }))}
          placeholder="Alert threshold percent"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TouchableOpacity style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_211', { theme: theme }, (theme ?? _styleTheme))]} onPress={saveRetryConfig}>
          <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Save Retry Policy</Text>
        </TouchableOpacity>
      </View>

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_212', { theme: theme }, (theme ?? _styleTheme))]}>Clear Extraction Cache</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_213', { theme: theme }, (theme ?? _styleTheme))]}>
          Delete all cached extraction results so re-uploaded documents are re-parsed with the latest logic version.
        </Text>
        <TouchableOpacity
          style={[localStyles((theme ?? _styleTheme)).tierButton, getSecondaryPillStyle(theme)]}
          onPress={clearCache}
        >
          <Text style={[localStyles((theme ?? _styleTheme)).tierButtonText, getSecondaryPillTextStyle(theme)]}>Clear Cache</Text>
        </TouchableOpacity>
      </View>

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_214', { theme: theme }, (theme ?? _styleTheme))]}>Dead-Letter Re-drive</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_215', { theme: theme }, (theme ?? _styleTheme))]}>
          Move dead-lettered jobs back to `PENDING` and enqueue them again.
        </Text>
        <View style={localStyles((theme ?? _styleTheme)).tierButtons}>
          {(['ALL', 'MAILGUN', 'GMAIL'] as const).map((provider) => (
            <TouchableOpacity
              key={provider}
              style={[localStyles((theme ?? _styleTheme)).tierButton, getSecondaryPillStyle(theme)]}
              onPress={() => redriveDeadLetters(provider)}
            >
              <Text style={[localStyles((theme ?? _styleTheme)).tierButtonText, getSecondaryPillTextStyle(theme)]}>Re-drive {provider}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// API Limits section
// ---------------------------------------------------------------------------

type ApiLimitProvider = {
  provider: string;
  window: string;
  windowHours: number;
  overallLimit: number | null;
  monthlyBudgetUsd?: number | null;
  estimatedSpendUsd?: number;
  budgetWindowKey?: string | null;
  budgetUsagePercent?: number | null;
  budgetAlertThresholdPercent?: number | null;
  isBudgetExceeded?: boolean;
  budgetingModels?: Array<{
    model: string;
    inputCostPer1MTokensUsd: number;
    outputCostPer1MTokensUsd: number;
  }>;
  callers: Array<{ caller: string; limit: number; currentUsage: number }>;
  overallUsage: number;
};

type ApiLimitProviderForm = {
  window: 'hour' | 'day';
  windowHours: string;
  overallLimit: string;
  monthlyBudgetUsd: string;
  alertThresholdPercent: string;
  reason: string;
  budgetingModels: Record<string, { inputCostPer1MTokensUsd: string; outputCostPer1MTokensUsd: string }>;
  callers: Record<string, string>;
};

type GetYourGuideAdminStatus = {
  featureEnabled: boolean;
  partnerConfigured: boolean;
  apiConfigured: boolean;
  cachePermission: boolean;
  revenueDashboard: 'separate';
  circuit?: { open: boolean; consecutiveFailures: number; openedUntil: string | null };
  observability?: {
    requests: number;
    successes: number;
    failures: number;
    retries: number;
    rateLimited: number;
    clicks: number;
    cache: { hits: number; stale: number; negative: number; misses: number; total: number };
    suppressionByReason: Record<string, number>;
    failuresByCode: Record<string, number>;
    latencyMs: { p50: number | null; p95: number | null; sampleCount: number };
  };
};

const ApiLimitsSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [providers, setProviders] = useState<ApiLimitProvider[]>([]);
  const [getYourGuideStatus, setGetYourGuideStatus] = useState<GetYourGuideAdminStatus | null>(null);
  const [providerForms, setProviderForms] = useState<Record<string, ApiLimitProviderForm>>({});
  const [caching, setCaching] = useState<Record<string, Record<string, number>>>({});
  const [cachingForms, setCachingForms] = useState<Record<string, { values: Record<string, string>; reason: string }>>({});
  const [savingCachingGroup, setSavingCachingGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const data = await apiFetch(backendUrl, headers, '/api-limits');
      const nextProviders = ((data as any).providers ?? []) as ApiLimitProvider[];
      setProviders(nextProviders);
      setGetYourGuideStatus(((data as any).getYourGuide ?? null) as GetYourGuideAdminStatus | null);
      setProviderForms(
        Object.fromEntries(
          nextProviders.map((provider) => [
            provider.provider,
            {
              window: provider.window === 'hour' ? 'hour' : 'day',
              windowHours: String(provider.windowHours),
              overallLimit: provider.overallLimit === null ? '' : String(provider.overallLimit),
              monthlyBudgetUsd: provider.monthlyBudgetUsd == null ? '' : String(provider.monthlyBudgetUsd),
              alertThresholdPercent:
                provider.budgetAlertThresholdPercent == null ? '' : String(provider.budgetAlertThresholdPercent),
              reason: '',
              budgetingModels: Object.fromEntries(
                (provider.budgetingModels ?? []).map((model) => [
                  model.model,
                  {
                    inputCostPer1MTokensUsd: String(model.inputCostPer1MTokensUsd),
                    outputCostPer1MTokensUsd: String(model.outputCostPer1MTokensUsd),
                  },
                ])
              ),
              callers: Object.fromEntries(provider.callers.map((caller) => [caller.caller, String(caller.limit)])),
            },
          ])
        )
      );
      const nextCaching = ((data as any).caching ?? {}) as Record<string, Record<string, number>>;
      setCaching(nextCaching);
      setCachingForms(
        Object.fromEntries(
          Object.entries(nextCaching).map(([group, values]) => [
            group,
            {
              values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
              reason: '',
            },
          ])
        )
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers]);

  useEffect(() => { load(); }, [load]);

  const updateProviderForm = (providerKey: string, patch: Partial<ApiLimitProviderForm>) => {
    setProviderForms((current) => ({
      ...current,
      [providerKey]: {
        ...current[providerKey],
        ...patch,
      },
    }));
  };

  const updateCallerLimit = (providerKey: string, callerKey: string, value: string) => {
    setProviderForms((current) => ({
      ...current,
      [providerKey]: {
        ...current[providerKey],
        callers: {
          ...(current[providerKey]?.callers ?? {}),
          [callerKey]: value,
        },
      },
    }));
  };

  const updateBudgetingModel = (
    providerKey: string,
    modelKey: string,
    field: 'inputCostPer1MTokensUsd' | 'outputCostPer1MTokensUsd',
    value: string
  ) => {
    setProviderForms((current) => ({
      ...current,
      [providerKey]: {
        ...current[providerKey],
        budgetingModels: {
          ...(current[providerKey]?.budgetingModels ?? {}),
          [modelKey]: {
            ...(current[providerKey]?.budgetingModels?.[modelKey] ?? {
              inputCostPer1MTokensUsd: '',
              outputCostPer1MTokensUsd: '',
            }),
            [field]: value,
          },
        },
      },
    }));
  };

  const updateCachingValue = (group: string, key: string, value: string) => {
    setCachingForms((current) => ({
      ...current,
      [group]: {
        reason: current[group]?.reason ?? '',
        values: {
          ...(current[group]?.values ?? {}),
          [key]: value,
        },
      },
    }));
  };

  const updateCachingReason = (group: string, reason: string) => {
    setCachingForms((current) => ({
      ...current,
      [group]: {
        values: current[group]?.values ?? {},
        reason,
      },
    }));
  };

  const saveCachingGroup = async (group: string) => {
    const form = cachingForms[group];
    if (!form) return;
    if (form.reason.trim().length < 3) {
      setError('A reason with at least 3 characters is required.');
      return;
    }
    const parsedValues = Object.fromEntries(
      Object.entries(caching[group] ?? {}).map(([key]) => [key, Number(form.values[key] ?? '')])
    );
    const invalidValue = Object.entries(parsedValues).find(([, value]) => !Number.isFinite(value) || value <= 0);
    if (invalidValue) {
      setError(`${invalidValue[0]} must be a positive number.`);
      return;
    }

    setSavingCachingGroup(group);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(backendUrl, headers, `/api-limits/caching/${group}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: parsedValues, reason: form.reason.trim() }),
      });
      setMessage(`${group} caching settings updated.`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingCachingGroup(null);
    }
  };

  const saveProvider = async (provider: ApiLimitProvider) => {
    const form = providerForms[provider.provider];
    if (!form) return;
    if (form.reason.trim().length < 3) {
      setError('A reason with at least 3 characters is required.');
      return;
    }

    const parsedWindowHours = Number(form.windowHours);
    const parsedOverallLimit = form.overallLimit.trim() ? Number(form.overallLimit) : null;
    const parsedMonthlyBudgetUsd = form.monthlyBudgetUsd.trim() ? Number(form.monthlyBudgetUsd) : null;
    const parsedAlertThresholdPercent = form.alertThresholdPercent.trim() ? Number(form.alertThresholdPercent) : null;
    const parsedCallers = Object.fromEntries(
      provider.callers.map((caller) => [caller.caller, Number(form.callers[caller.caller] ?? '')])
    );
    const parsedBudgetingModels = Object.fromEntries(
      (provider.budgetingModels ?? []).map((model) => [
        model.model,
        {
          inputCostPer1MTokensUsd: Number(form.budgetingModels?.[model.model]?.inputCostPer1MTokensUsd ?? ''),
          outputCostPer1MTokensUsd: Number(form.budgetingModels?.[model.model]?.outputCostPer1MTokensUsd ?? ''),
        },
      ])
    );

    if (!Number.isFinite(parsedWindowHours) || parsedWindowHours <= 0) {
      setError(`Window hours for ${provider.provider} must be a positive number.`);
      return;
    }
    if (parsedOverallLimit !== null && (!Number.isFinite(parsedOverallLimit) || parsedOverallLimit <= 0)) {
      setError(`Overall limit for ${provider.provider} must be blank or a positive number.`);
      return;
    }
    if (parsedMonthlyBudgetUsd !== null && (!Number.isFinite(parsedMonthlyBudgetUsd) || parsedMonthlyBudgetUsd < 0)) {
      setError(`Monthly budget for ${provider.provider} must be blank or a non-negative number.`);
      return;
    }
    if (
      parsedAlertThresholdPercent !== null &&
      (!Number.isFinite(parsedAlertThresholdPercent) || parsedAlertThresholdPercent <= 0 || parsedAlertThresholdPercent > 100)
    ) {
      setError(`Budget alert threshold for ${provider.provider} must be blank or between 1 and 100.`);
      return;
    }
    const invalidCaller = Object.entries(parsedCallers).find(([, value]) => !Number.isFinite(value) || value <= 0);
    if (invalidCaller) {
      setError(`Caller limit ${invalidCaller[0]} must be a positive number.`);
      return;
    }
    const invalidModel = Object.entries(parsedBudgetingModels).find(
      ([, pricing]) =>
        !Number.isFinite(pricing.inputCostPer1MTokensUsd) ||
        pricing.inputCostPer1MTokensUsd <= 0 ||
        !Number.isFinite(pricing.outputCostPer1MTokensUsd) ||
        pricing.outputCostPer1MTokensUsd <= 0
    );
    if (invalidModel) {
      setError(`Model pricing for ${invalidModel[0]} must use positive numeric values.`);
      return;
    }

    setSavingProvider(provider.provider);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(backendUrl, headers, `/api-limits/${provider.provider}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          window: form.window,
          windowHours: parsedWindowHours,
          overallLimit: parsedOverallLimit,
          monthlyBudgetUsd: parsedMonthlyBudgetUsd,
          alertThresholdPercent: parsedAlertThresholdPercent,
          budgetingModels: parsedBudgetingModels,
          callers: parsedCallers,
          reason: form.reason.trim(),
        }),
      });
      setMessage(`${provider.provider} rate limits updated.`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingProvider(null);
    }
  };

  if (loading) return <Text style={[localStyles((theme ?? _styleTheme)).loading, themeStyle('tabs_AdminTab_216', { theme: theme }, (theme ?? _styleTheme))]}>Loading...</Text>;
  if (error) return <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_217', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text>;

  return (
    <ScrollView style={[localStyles((theme ?? _styleTheme)).section, localStyles((theme ?? _styleTheme)).apiLimitsScroll]} contentContainerStyle={localStyles((theme ?? _styleTheme)).apiLimitsScrollContent}>
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_218', { theme: theme }, (theme ?? _styleTheme))]}>API Rate Limits</Text>
      <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_219', { theme: theme }, (theme ?? _styleTheme))]}>
        Limits are configured in api-limits.yaml. Usage resets per window period, request counts are durable, and provider spend is estimated from recorded token usage.
      </Text>
      {message ? <Text style={[localStyles((theme ?? _styleTheme)).saveMsg, themeStyle('tabs_AdminTab_220', { theme: theme }, (theme ?? _styleTheme))]}>{message}</Text> : null}
      {getYourGuideStatus ? (
        <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]} testID="admin-getyourguide-status">
          <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_221', { theme: theme }, (theme ?? _styleTheme))]}>GetYourGuide operations</Text>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_222', { getYourGuideStatus: getYourGuideStatus, theme: theme }, (theme ?? _styleTheme))]}>Kill switch: {getYourGuideStatus.featureEnabled ? 'enabled' : 'disabled'} | Partner configuration: {getYourGuideStatus.partnerConfigured ? 'present' : 'missing'} | API: {getYourGuideStatus.apiConfigured ? 'configured' : 'not configured'}</Text>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_223', { getYourGuideStatus: getYourGuideStatus, theme: theme }, (theme ?? _styleTheme))]}>Partner circuit: {getYourGuideStatus.circuit?.open ? 'open' : 'closed'} | Consecutive failures: {getYourGuideStatus.circuit?.consecutiveFailures ?? 0}</Text>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_224', { theme: theme }, (theme ?? _styleTheme))]}>Cache permission: {getYourGuideStatus.cachePermission ? 'written permission recorded' : 'request-only (no persistence)'} | Revenue/commission: separate dashboard</Text>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_225', { theme: theme }, (theme ?? _styleTheme))]}>Requests: {getYourGuideStatus.observability?.requests ?? 0} | Successes: {getYourGuideStatus.observability?.successes ?? 0} | Failures: {getYourGuideStatus.observability?.failures ?? 0} | 429s: {getYourGuideStatus.observability?.rateLimited ?? 0} | Clicks: {getYourGuideStatus.observability?.clicks ?? 0}</Text>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_226', { theme: theme }, (theme ?? _styleTheme))]}>Cache fresh: {getYourGuideStatus.observability?.cache.hits ?? 0} | stale: {getYourGuideStatus.observability?.cache.stale ?? 0} | negative: {getYourGuideStatus.observability?.cache.negative ?? 0} | misses: {getYourGuideStatus.observability?.cache.misses ?? 0}</Text>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_227', { theme: theme }, (theme ?? _styleTheme))]}>Latency p95: {getYourGuideStatus.observability?.latencyMs.p95 == null ? 'n/a' : `${getYourGuideStatus.observability.latencyMs.p95} ms`} | Suppression reasons: {Object.keys(getYourGuideStatus.observability?.suppressionByReason ?? {}).length ? Object.entries(getYourGuideStatus.observability?.suppressionByReason ?? {}).map(([reason, count]) => `${reason}=${count}`).join(', ') : 'none'}</Text>
        </View>
      ) : null}
      {providers.map((provider) => (
        <View key={provider.provider} style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
          <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_228', { theme: theme }, (theme ?? _styleTheme))]}>
            {provider.provider}
          </Text>
          <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_229', { theme: theme }, (theme ?? _styleTheme))]}>
            Window: {provider.windowHours}h ({provider.window}) | Overall limit: {provider.overallLimit ?? 'none'} | Used: {provider.overallUsage}
          </Text>
          <Text
            style={[
              localStyles((theme ?? _styleTheme)).cardSub,
              themeStyle('tabs_AdminTab_230', { provider: provider, theme: theme }, (theme ?? _styleTheme)),
            ]}
          >
            Budget ({provider.budgetWindowKey ?? 'current'}): {provider.monthlyBudgetUsd == null ? 'not set' : `$${provider.monthlyBudgetUsd.toFixed(2)}`} | Estimated spend: ${(provider.estimatedSpendUsd ?? 0).toFixed(4)}
            {provider.budgetUsagePercent != null ? ` (${Math.round(provider.budgetUsagePercent)}%)` : ''}
          </Text>
          <Text style={[localStyles((theme ?? _styleTheme)).fieldLabel, themeStyle('tabs_AdminTab_231', { theme: theme }, (theme ?? _styleTheme))]}>Window</Text>
          <View style={localStyles((theme ?? _styleTheme)).tierButtons}>
            {(['hour', 'day'] as const).map((windowOption) => (
              <TouchableOpacity
                key={`${provider.provider}-${windowOption}`}
                style={[localStyles((theme ?? _styleTheme)).tierButton, getSecondaryPillStyle(theme, providerForms[provider.provider]?.window === windowOption)]}
                onPress={() => updateProviderForm(provider.provider, { window: windowOption })}
              >
                <Text style={[localStyles((theme ?? _styleTheme)).tierButtonText, getSecondaryPillTextStyle(theme, providerForms[provider.provider]?.window === windowOption)]}>
                  {windowOption}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
            placeholder="Window hours"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="numeric"
            value={providerForms[provider.provider]?.windowHours ?? ''}
            onChangeText={(value: string) => updateProviderForm(provider.provider, { windowHours: value })}
          />
          <TextInput
            style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
            placeholder="Overall limit (blank for none)"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="numeric"
            value={providerForms[provider.provider]?.overallLimit ?? ''}
            onChangeText={(value: string) => updateProviderForm(provider.provider, { overallLimit: value })}
          />
          <TextInput
            style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
            placeholder="Monthly budget USD (blank for none)"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="numeric"
            value={providerForms[provider.provider]?.monthlyBudgetUsd ?? ''}
            onChangeText={(value: string) => updateProviderForm(provider.provider, { monthlyBudgetUsd: value })}
          />
          <TextInput
            style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
            placeholder="Budget alert threshold %"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="numeric"
            value={providerForms[provider.provider]?.alertThresholdPercent ?? ''}
            onChangeText={(value: string) => updateProviderForm(provider.provider, { alertThresholdPercent: value })}
          />
          {(provider.budgetingModels ?? []).map((model) => (
            <View key={`${provider.provider}-${model.model}`} style={localStyles((theme ?? _styleTheme)).apiLimitCallerRow}>
              <View style={localStyles((theme ?? _styleTheme)).flex}>
                <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_232', { theme: theme }, (theme ?? _styleTheme))]}>{model.model}</Text>
                <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_233', { theme: theme }, (theme ?? _styleTheme))]}>USD / 1M tokens</Text>
              </View>
              <TextInput
                style={[localStyles((theme ?? _styleTheme)).apiLimitInput, getInputStyle(theme)]}
                placeholder="Input"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="numeric"
                value={providerForms[provider.provider]?.budgetingModels?.[model.model]?.inputCostPer1MTokensUsd ?? ''}
                onChangeText={(value: string) =>
                  updateBudgetingModel(provider.provider, model.model, 'inputCostPer1MTokensUsd', value)
                }
              />
              <TextInput
                style={[localStyles((theme ?? _styleTheme)).apiLimitInput, getInputStyle(theme)]}
                placeholder="Output"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="numeric"
                value={providerForms[provider.provider]?.budgetingModels?.[model.model]?.outputCostPer1MTokensUsd ?? ''}
                onChangeText={(value: string) =>
                  updateBudgetingModel(provider.provider, model.model, 'outputCostPer1MTokensUsd', value)
                }
              />
            </View>
          ))}
          {provider.callers.map((caller) => {
            const pct = caller.limit > 0 ? Math.round((caller.currentUsage / caller.limit) * 100) : 0;
            const isHigh = pct >= 75;
            return (
              <View key={caller.caller} style={localStyles((theme ?? _styleTheme)).apiLimitCallerRow}>
                <View style={localStyles((theme ?? _styleTheme)).flex}>
                  <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_234', { theme: theme }, (theme ?? _styleTheme))]}>
                    {caller.caller}
                  </Text>
                  <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_235', { isHigh: isHigh, theme: theme }, (theme ?? _styleTheme))]}>
                    Used: {caller.currentUsage} / {caller.limit} ({pct}%)
                  </Text>
                </View>
                <TextInput
                  style={[localStyles((theme ?? _styleTheme)).apiLimitInput, getInputStyle(theme)]}
                  placeholder="Limit"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="numeric"
                  value={providerForms[provider.provider]?.callers[caller.caller] ?? ''}
                  onChangeText={(value: string) => updateCallerLimit(provider.provider, caller.caller, value)}
                />
              </View>
            );
          })}
          <TextInput
            style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
            placeholder="Reason for change (required)"
            placeholderTextColor={theme.colors.textMuted}
            value={providerForms[provider.provider]?.reason ?? ''}
            onChangeText={(value: string) => updateProviderForm(provider.provider, { reason: value })}
          />
          <TouchableOpacity
            style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_236', { theme: theme }, (theme ?? _styleTheme)), savingProvider === provider.provider && localStyles((theme ?? _styleTheme)).buttonDisabled]}
            disabled={savingProvider === provider.provider}
            onPress={() => saveProvider(provider)}
          >
            <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Save {provider.provider}</Text>
          </TouchableOpacity>
        </View>
      ))}
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_237', { theme: theme }, (theme ?? _styleTheme))]}>Caching</Text>
      <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_238', { theme: theme }, (theme ?? _styleTheme))]}>
        Cache retention/refresh settings, in days unless otherwise noted.
      </Text>
      {Object.entries(caching).map(([group, values]) => (
        <View key={group} style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
          <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_239', { theme: theme }, (theme ?? _styleTheme))]}>{group}</Text>
          {Object.keys(values).map((key) => (
            <View key={key} style={localStyles((theme ?? _styleTheme)).apiLimitCallerRow}>
              <View style={localStyles((theme ?? _styleTheme)).flex}>
                <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_240', { theme: theme }, (theme ?? _styleTheme))]}>{key}</Text>
              </View>
              <TextInput
                style={[localStyles((theme ?? _styleTheme)).apiLimitInput, getInputStyle(theme)]}
                placeholder={key}
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="numeric"
                value={cachingForms[group]?.values[key] ?? ''}
                onChangeText={(value: string) => updateCachingValue(group, key, value)}
              />
            </View>
          ))}
          <TextInput
            style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
            placeholder="Reason for change (required)"
            placeholderTextColor={theme.colors.textMuted}
            value={cachingForms[group]?.reason ?? ''}
            onChangeText={(value: string) => updateCachingReason(group, value)}
          />
          <TouchableOpacity
            style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_241', { theme: theme }, (theme ?? _styleTheme)), savingCachingGroup === group && localStyles((theme ?? _styleTheme)).buttonDisabled]}
            disabled={savingCachingGroup === group}
            onPress={() => saveCachingGroup(group)}
          >
            <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Save {group}</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_242', { theme: theme }, (theme ?? _styleTheme))]} onPress={load}>
        <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Refresh</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

// --- Cost Estimator (Phase 4 of cost-estimator-admin-panel-plan.md) ---
type CostEstimatorAssumptions = {
  totalUsers: number;
  premiumConversionPercent: number;
  freeGenerationsPerMonth: number;
  premiumGenerationsPerMonth: number;
  costPerGenerationUsd: number;
  premiumMonthlyPriceUsdOverride: number | null;
  stripeFeePercent: number;
  stripeFeeFixedUsd: number;
  providerCallsPerUserPerMonth: Record<string, number>;
};
type HostingLineItem = { id: string; name: string; monthlyCostUsd: number };
type ProjectedCostBreakdown = {
  llmCostUsd: number;
  requestApiCostUsd: number;
  hostingCostUsd: number;
  totalCostUsd: number;
  premiumMonthlyPriceUsd: number;
  netRevenuePerPremiumUserUsd: number;
  breakEvenPremiumUsers: number | null;
  byProvider: Array<{ provider: string; costUsd: number }>;
};
type MonthlyProviderSpend = { windowKey: string; byProvider: Array<{ provider: string; spendUsd: number }>; totalUsd: number };
type CostEstimateData = {
  assumptions: CostEstimatorAssumptions;
  requestPricing: Record<string, number>;
  hostingLineItems: HostingLineItem[];
  projected: ProjectedCostBreakdown;
  actual: { months: MonthlyProviderSpend[] };
};

// Per-request provider spend (SerpAPI, Wikimedia, Google Routes, etc.) only started being recorded
// once Phase 1 shipped; months before that show $0 for those providers even though real usage
// occurred — say so explicitly rather than let it read as "these APIs were free until now." LLM
// (token-priced) provider spend has been tracked for longer and isn't affected by this caveat.
const COST_ESTIMATOR_TRACKING_STARTED_LABEL =
  'Per-request API cost tracking (SerpAPI, Wikimedia, Google Routes, etc.) started 2026-07 — months before that show $0 for those providers even though real usage occurred. LLM cost tracking is unaffected.';

type AssumptionsFormState = {
  totalUsers: string;
  premiumConversionPercent: string;
  freeGenerationsPerMonth: string;
  premiumGenerationsPerMonth: string;
  costPerGenerationUsd: string;
  premiumMonthlyPriceUsdOverride: string;
  stripeFeePercent: string;
  stripeFeeFixedUsd: string;
  providerCallsPerUserPerMonth: Record<string, string>;
  reason: string;
};
type HostingFormRow = { id: string; name: string; monthlyCostUsd: string };

const toAssumptionsForm = (assumptions: CostEstimatorAssumptions, providers: string[]): AssumptionsFormState => ({
  totalUsers: String(assumptions.totalUsers),
  premiumConversionPercent: String(assumptions.premiumConversionPercent),
  freeGenerationsPerMonth: String(assumptions.freeGenerationsPerMonth),
  premiumGenerationsPerMonth: String(assumptions.premiumGenerationsPerMonth),
  costPerGenerationUsd: String(assumptions.costPerGenerationUsd),
  premiumMonthlyPriceUsdOverride:
    assumptions.premiumMonthlyPriceUsdOverride == null ? '' : String(assumptions.premiumMonthlyPriceUsdOverride),
  stripeFeePercent: String(assumptions.stripeFeePercent),
  stripeFeeFixedUsd: String(assumptions.stripeFeeFixedUsd),
  providerCallsPerUserPerMonth: Object.fromEntries(
    providers.map((provider) => [provider, String(assumptions.providerCallsPerUserPerMonth[provider] ?? 0)])
  ),
  reason: '',
});

const newHostingRowId = (): string => `hosting-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const CostEstimateSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [data, setData] = useState<CostEstimateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [assumptionsForm, setAssumptionsForm] = useState<AssumptionsFormState | null>(null);
  const [savingAssumptions, setSavingAssumptions] = useState(false);

  const [hostingRows, setHostingRows] = useState<HostingFormRow[]>([]);
  const [hostingReason, setHostingReason] = useState('');
  const [savingHosting, setSavingHosting] = useState(false);

  const [pricingForm, setPricingForm] = useState<Record<string, string>>({});
  const [pricingReason, setPricingReason] = useState('');
  const [savingPricing, setSavingPricing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await apiFetch(backendUrl, headers, '/cost-estimate')) as CostEstimateData;
      setData(result);
      const providers = Object.keys(result.requestPricing).sort((a, b) => a.localeCompare(b));
      setAssumptionsForm(toAssumptionsForm(result.assumptions, providers));
      setHostingRows(
        result.hostingLineItems.map((item) => ({ id: item.id, name: item.name, monthlyCostUsd: String(item.monthlyCostUsd) }))
      );
      setPricingForm(Object.fromEntries(providers.map((provider) => [provider, String(result.requestPricing[provider])])));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers]);

  useEffect(() => {
    load();
  }, [load]);

  const saveAssumptions = async () => {
    if (!assumptionsForm) return;
    if (assumptionsForm.reason.trim().length < 3) {
      setError('A reason with at least 3 characters is required.');
      return;
    }
    const numericFields: Array<keyof AssumptionsFormState> = [
      'totalUsers',
      'premiumConversionPercent',
      'freeGenerationsPerMonth',
      'premiumGenerationsPerMonth',
      'costPerGenerationUsd',
      'stripeFeePercent',
      'stripeFeeFixedUsd',
    ];
    const parsed: Record<string, number> = {};
    for (const field of numericFields) {
      const value = Number(assumptionsForm[field] as string);
      if (!Number.isFinite(value) || value < 0) {
        setError(`${field} must be a non-negative number.`);
        return;
      }
      parsed[field] = value;
    }
    const overrideRaw = assumptionsForm.premiumMonthlyPriceUsdOverride.trim();
    const premiumMonthlyPriceUsdOverride = overrideRaw ? Number(overrideRaw) : null;
    if (premiumMonthlyPriceUsdOverride !== null && (!Number.isFinite(premiumMonthlyPriceUsdOverride) || premiumMonthlyPriceUsdOverride < 0)) {
      setError('Premium monthly price override must be blank or a non-negative number.');
      return;
    }
    const providerCallsPerUserPerMonth: Record<string, number> = {};
    for (const [provider, raw] of Object.entries(assumptionsForm.providerCallsPerUserPerMonth)) {
      const value = raw.trim() ? Number(raw) : 0;
      if (!Number.isFinite(value) || value < 0) {
        setError(`Call volume for ${provider} must be a non-negative number.`);
        return;
      }
      if (value > 0) providerCallsPerUserPerMonth[provider] = value;
    }

    setSavingAssumptions(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(backendUrl, headers, '/cost-estimate/assumptions', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsed,
          premiumMonthlyPriceUsdOverride,
          providerCallsPerUserPerMonth,
          reason: assumptionsForm.reason.trim(),
        }),
      });
      setMessage('Assumptions updated.');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingAssumptions(false);
    }
  };

  const saveHosting = async () => {
    if (hostingReason.trim().length < 3) {
      setError('A reason with at least 3 characters is required.');
      return;
    }
    const parsedItems: HostingLineItem[] = [];
    for (const row of hostingRows) {
      if (!row.name.trim()) {
        setError('Every hosting line item needs a name.');
        return;
      }
      const amount = Number(row.monthlyCostUsd);
      if (!Number.isFinite(amount) || amount < 0) {
        setError(`Monthly cost for ${row.name} must be a non-negative number.`);
        return;
      }
      parsedItems.push({ id: row.id, name: row.name.trim(), monthlyCostUsd: amount });
    }

    setSavingHosting(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(backendUrl, headers, '/cost-estimate/hosting', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostingLineItems: parsedItems, reason: hostingReason.trim() }),
      });
      setMessage('Hosting line items updated.');
      setHostingReason('');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingHosting(false);
    }
  };

  const savePricing = async () => {
    if (pricingReason.trim().length < 3) {
      setError('A reason with at least 3 characters is required.');
      return;
    }
    const requestPricing: Record<string, number> = {};
    for (const [provider, raw] of Object.entries(pricingForm)) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setError(`Price for ${provider} must be a non-negative number.`);
        return;
      }
      requestPricing[provider] = value;
    }

    setSavingPricing(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(backendUrl, headers, '/cost-estimate/request-pricing', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestPricing, reason: pricingReason.trim() }),
      });
      setMessage('Per-request pricing updated.');
      setPricingReason('');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingPricing(false);
    }
  };

  if (loading) return <Text style={[localStyles((theme ?? _styleTheme)).loading, themeStyle('tabs_AdminTab_243', { theme: theme }, (theme ?? _styleTheme))]}>Loading...</Text>;
  if (error && !data) return <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_244', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text>;
  if (!data || !assumptionsForm) return null;

  const { projected } = data;

  return (
    <ScrollView style={[localStyles((theme ?? _styleTheme)).section, localStyles((theme ?? _styleTheme)).apiLimitsScroll]} contentContainerStyle={localStyles((theme ?? _styleTheme)).apiLimitsScrollContent}>
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_245', { theme: theme }, (theme ?? _styleTheme))]}>Cost Estimator</Text>
      <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_246', { theme: theme }, (theme ?? _styleTheme))]}>
        Projected monthly cost from editable assumptions, versus actual recorded spend by month.
      </Text>
      {message ? <Text style={[localStyles((theme ?? _styleTheme)).saveMsg, themeStyle('tabs_AdminTab_247', { theme: theme }, (theme ?? _styleTheme))]}>{message}</Text> : null}
      {error ? <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_248', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text> : null}

      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_249', { theme: theme }, (theme ?? _styleTheme))]}>Projected monthly cost</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_250', { theme: theme }, (theme ?? _styleTheme))]}>LLM (itinerary generations): ${projected.llmCostUsd.toFixed(2)}</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_251', { theme: theme }, (theme ?? _styleTheme))]}>Per-request APIs: ${projected.requestApiCostUsd.toFixed(2)}</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_252', { theme: theme }, (theme ?? _styleTheme))]}>Hosting: ${projected.hostingCostUsd.toFixed(2)}</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_253', { theme: theme }, (theme ?? _styleTheme))]}>Total: ${projected.totalCostUsd.toFixed(2)}/mo</Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_254', { theme: theme }, (theme ?? _styleTheme))]}>
          Premium price: ${projected.premiumMonthlyPriceUsd.toFixed(2)} | Net of Stripe fees: ${projected.netRevenuePerPremiumUserUsd.toFixed(2)}/user
        </Text>
        <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_255', { theme: theme }, (theme ?? _styleTheme))]}>
          Break-even: {projected.breakEvenPremiumUsers == null ? 'not reachable at this price' : `${projected.breakEvenPremiumUsers} premium users`}
        </Text>
      </View>

      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_256', { theme: theme }, (theme ?? _styleTheme))]}>Assumptions</Text>
      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        {(
          [
            ['totalUsers', 'Total users'],
            ['premiumConversionPercent', 'Premium conversion %'],
            ['freeGenerationsPerMonth', 'Free generations / user / month'],
            ['premiumGenerationsPerMonth', 'Premium generations / user / month'],
            ['costPerGenerationUsd', 'LLM cost per generation (USD)'],
            ['premiumMonthlyPriceUsdOverride', 'Premium price override (blank = live Stripe price)'],
            ['stripeFeePercent', 'Stripe fee %'],
            ['stripeFeeFixedUsd', 'Stripe fixed fee (USD)'],
          ] as Array<[keyof AssumptionsFormState, string]>
        ).map(([field, label]) => (
          <View key={field}>
            <Text style={[localStyles((theme ?? _styleTheme)).fieldLabel, themeStyle('tabs_AdminTab_257', { theme: theme }, (theme ?? _styleTheme))]}>{label}</Text>
            <TextInput
              style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
              placeholder={label}
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="numeric"
              value={assumptionsForm[field] as string}
              onChangeText={(value: string) => setAssumptionsForm((current) => (current ? { ...current, [field]: value } : current))}
            />
          </View>
        ))}
        <Text style={[localStyles((theme ?? _styleTheme)).fieldLabel, themeStyle('tabs_AdminTab_258', { theme: theme }, (theme ?? _styleTheme))]}>Provider call volume (per user / month)</Text>
        {Object.keys(assumptionsForm.providerCallsPerUserPerMonth).map((provider) => (
          <View key={provider} style={localStyles((theme ?? _styleTheme)).apiLimitCallerRow}>
            <View style={localStyles((theme ?? _styleTheme)).flex}>
              <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_259', { theme: theme }, (theme ?? _styleTheme))]}>{provider}</Text>
            </View>
            <TextInput
              style={[localStyles((theme ?? _styleTheme)).apiLimitInput, getInputStyle(theme)]}
              placeholder="0"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="numeric"
              value={assumptionsForm.providerCallsPerUserPerMonth[provider] ?? ''}
              onChangeText={(value: string) =>
                setAssumptionsForm((current) =>
                  current
                    ? { ...current, providerCallsPerUserPerMonth: { ...current.providerCallsPerUserPerMonth, [provider]: value } }
                    : current
                )
              }
            />
          </View>
        ))}
        <TextInput
          style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
          placeholder="Reason for change (required)"
          placeholderTextColor={theme.colors.textMuted}
          value={assumptionsForm.reason}
          onChangeText={(value: string) => setAssumptionsForm((current) => (current ? { ...current, reason: value } : current))}
        />
        <TouchableOpacity
          style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_260', { theme: theme }, (theme ?? _styleTheme)), savingAssumptions && localStyles((theme ?? _styleTheme)).buttonDisabled]}
          disabled={savingAssumptions}
          onPress={saveAssumptions}
        >
          <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Save assumptions</Text>
        </TouchableOpacity>
      </View>

      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_261', { theme: theme }, (theme ?? _styleTheme))]}>Hosting line items</Text>
      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        {hostingRows.map((row, index) => (
          <View key={row.id} style={localStyles((theme ?? _styleTheme)).apiLimitCallerRow}>
            <TextInput
              style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme), localStyles((theme ?? _styleTheme)).flex]}
              placeholder="Name (e.g. Cloud Run)"
              placeholderTextColor={theme.colors.textMuted}
              value={row.name}
              onChangeText={(value: string) =>
                setHostingRows((current) => current.map((r, i) => (i === index ? { ...r, name: value } : r)))
              }
            />
            <TextInput
              style={[localStyles((theme ?? _styleTheme)).apiLimitInput, getInputStyle(theme)]}
              placeholder="USD / month"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="numeric"
              value={row.monthlyCostUsd}
              onChangeText={(value: string) =>
                setHostingRows((current) => current.map((r, i) => (i === index ? { ...r, monthlyCostUsd: value } : r)))
              }
            />
            <TouchableOpacity onPress={() => setHostingRows((current) => current.filter((_, i) => i !== index))}>
              <Text style={[localStyles((theme ?? _styleTheme)).breadcrumbLink, themeStyle('tabs_AdminTab_262', { theme: theme }, (theme ?? _styleTheme))]}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_263', { theme: theme }, (theme ?? _styleTheme))]}
          onPress={() => setHostingRows((current) => [...current, { id: newHostingRowId(), name: '', monthlyCostUsd: '0' }])}
        >
          <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('tabs_AdminTab_264', { theme: theme }, (theme ?? _styleTheme))]}>Add line item</Text>
        </TouchableOpacity>
        <TextInput
          style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
          placeholder="Reason for change (required)"
          placeholderTextColor={theme.colors.textMuted}
          value={hostingReason}
          onChangeText={setHostingReason}
        />
        <TouchableOpacity
          style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_265', { theme: theme }, (theme ?? _styleTheme)), savingHosting && localStyles((theme ?? _styleTheme)).buttonDisabled]}
          disabled={savingHosting}
          onPress={saveHosting}
        >
          <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Save hosting line items</Text>
        </TouchableOpacity>
      </View>

      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_266', { theme: theme }, (theme ?? _styleTheme))]}>Per-request API pricing</Text>
      <View style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
        {Object.keys(pricingForm).map((provider) => (
          <View key={provider} style={localStyles((theme ?? _styleTheme)).apiLimitCallerRow}>
            <View style={localStyles((theme ?? _styleTheme)).flex}>
              <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_267', { theme: theme }, (theme ?? _styleTheme))]}>{provider}</Text>
            </View>
            <TextInput
              style={[localStyles((theme ?? _styleTheme)).apiLimitInput, getInputStyle(theme)]}
              placeholder="USD / request"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="numeric"
              value={pricingForm[provider] ?? ''}
              onChangeText={(value: string) => setPricingForm((current) => ({ ...current, [provider]: value }))}
            />
          </View>
        ))}
        <TextInput
          style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
          placeholder="Reason for change (required)"
          placeholderTextColor={theme.colors.textMuted}
          value={pricingReason}
          onChangeText={setPricingReason}
        />
        <TouchableOpacity
          style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_268', { theme: theme }, (theme ?? _styleTheme)), savingPricing && localStyles((theme ?? _styleTheme)).buttonDisabled]}
          disabled={savingPricing}
          onPress={savePricing}
        >
          <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Save pricing</Text>
        </TouchableOpacity>
      </View>

      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_269', { theme: theme }, (theme ?? _styleTheme))]}>Actual spend by month</Text>
      <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_270', { theme: theme }, (theme ?? _styleTheme))]}>{COST_ESTIMATOR_TRACKING_STARTED_LABEL}</Text>
      {data.actual.months.map((month) => (
        <View key={month.windowKey} style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
          <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_271', { theme: theme }, (theme ?? _styleTheme))]}>
            {month.windowKey} — ${month.totalUsd.toFixed(2)}
          </Text>
          {month.byProvider.length === 0 && Object.keys(data.requestPricing).length === 0 ? (
            <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_272', { theme: theme }, (theme ?? _styleTheme))]}>No recorded spend.</Text>
          ) : (
            Array.from(new Set([
              ...Object.keys(data.requestPricing),
              ...data.projected.byProvider.map((entry) => entry.provider),
              ...month.byProvider.map((entry) => entry.provider),
            ])).sort().map((provider) => {
              const spend = month.byProvider.find((entry) => entry.provider === provider)?.spendUsd ?? 0;
              return (
                <Text key={provider} style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_273', { theme: theme }, (theme ?? _styleTheme))]}>
                  {provider}: ${spend.toFixed(2)}
                </Text>
              );
            })
          )}
        </View>
      ))}

      <TouchableOpacity style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_274', { theme: theme }, (theme ?? _styleTheme))]} onPress={load}>
        <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Refresh</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const BillingSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [plans, setPlans] = useState<BillingPlanConfig[]>([]);
  const [forms, setForms] = useState<Record<string, Record<string, string | boolean>>>({});
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch(backendUrl, headers, '/billing/config');
      const nextPlans = (data.plans ?? []) as BillingPlanConfig[];
      setPlans(nextPlans);
      setBillingEnabled(Boolean(data.billingEnabled));
      setForms(Object.fromEntries(nextPlans.map((plan) => [plan.planKey, {
        unitAmountCents: String(plan.unitAmountCents),
        trialDays: String(plan.trialDays),
        pastDueGraceDays: String(plan.pastDueGraceDays),
        automaticTaxEnabled: plan.automaticTaxEnabled,
        promotionCodesEnabled: plan.promotionCodesEnabled,
        isCheckoutEnabled: plan.isCheckoutEnabled,
      }])));
    } catch (e: any) {
      setError(e.message);
    }
  }, [backendUrl, headers]);

  useEffect(() => { load(); }, [load]);

  const update = (planKey: string, field: string, value: string | boolean) => {
    setForms((current) => ({
      ...current,
      [planKey]: { ...current[planKey], [field]: value },
    }));
  };

  const saveConfig = async (plan: BillingPlanConfig) => {
    const form = forms[plan.planKey];
    if (!form) return;
    setSaving(plan.planKey);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(backendUrl, headers, `/billing/config/${plan.planKey}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trialDays: Number(form.trialDays),
          pastDueGraceDays: Number(form.pastDueGraceDays),
          automaticTaxEnabled: form.automaticTaxEnabled,
          promotionCodesEnabled: form.promotionCodesEnabled,
          isCheckoutEnabled: form.isCheckoutEnabled,
        }),
      });
      if (!plan.activeStripePriceId || Number(form.unitAmountCents) !== plan.unitAmountCents) {
        await apiFetch(backendUrl, headers, `/billing/plans/${plan.planKey}/price`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ unitAmountCents: Number(form.unitAmountCents), currency: plan.currency }),
        });
      }
      setMessage(`${plan.interval === 'month' ? 'Monthly' : 'Annual'} plan updated.`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <View style={localStyles((theme ?? _styleTheme)).section} testID="admin-billing-section">
      <Text style={[localStyles((theme ?? _styleTheme)).sectionTitle, themeStyle('tabs_AdminTab_275', { theme: theme }, (theme ?? _styleTheme))]}>Billing</Text>
      <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_276', { billingEnabled: billingEnabled, theme: theme }, (theme ?? _styleTheme))]}>
        Stripe billing is {billingEnabled ? 'enabled' : 'disabled'} on this server.
      </Text>
      {error ? <Text style={[localStyles((theme ?? _styleTheme)).errorText, themeStyle('tabs_AdminTab_277', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text> : null}
      {message ? <Text style={[localStyles((theme ?? _styleTheme)).saveMsg, themeStyle('tabs_AdminTab_278', { theme: theme }, (theme ?? _styleTheme))]}>{message}</Text> : null}
      {plans.map((plan) => {
        const form = forms[plan.planKey];
        if (!form) return null;
        return (
          <View key={plan.planKey} style={[localStyles((theme ?? _styleTheme)).card, getCardStyle(theme)]}>
            <Text style={[localStyles((theme ?? _styleTheme)).cardTitle, themeStyle('tabs_AdminTab_279', { theme: theme }, (theme ?? _styleTheme))]}>
              Premium {plan.interval === 'month' ? 'Monthly' : 'Annual'}
            </Text>
            <Text style={[localStyles((theme ?? _styleTheme)).cardSub, themeStyle('tabs_AdminTab_280', { theme: theme }, (theme ?? _styleTheme))]}>
              Active Price: {plan.activeStripePriceId ?? 'Not published'} ({plan.livemode ? 'live' : 'test'})
            </Text>
            {([
              ['unitAmountCents', 'Price in cents'],
              ['trialDays', 'Trial days'],
              ['pastDueGraceDays', 'Past-due grace days'],
            ] as const).map(([field, label]) => (
              <View key={field}>
                <Text style={[localStyles((theme ?? _styleTheme)).fieldLabel, themeStyle('tabs_AdminTab_281', { theme: theme }, (theme ?? _styleTheme))]}>{label}</Text>
                <TextInput
                  style={[localStyles((theme ?? _styleTheme)).smallInput, getInputStyle(theme)]}
                  keyboardType="numeric"
                  value={String(form[field])}
                  onChangeText={(value) => update(plan.planKey, field, value)}
                  testID={`admin-billing-${plan.planKey}-${field}`}
                />
              </View>
            ))}
            {([
              ['automaticTaxEnabled', 'Stripe Tax'],
              ['promotionCodesEnabled', 'Promotion codes'],
              ['isCheckoutEnabled', 'New checkout'],
            ] as const).map(([field, label]) => {
              const active = Boolean(form[field]);
              return (
                <View key={field} style={[localStyles((theme ?? _styleTheme)).row, themeStyle('tabs_AdminTab_282', {  }, (theme ?? _styleTheme))]}>
                  <Text style={[localStyles((theme ?? _styleTheme)).flex, themeStyle('tabs_AdminTab_283', { theme: theme }, (theme ?? _styleTheme))]}>{label}</Text>
                  <TouchableOpacity
                    style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_284', { active: active, theme: theme }, (theme ?? _styleTheme))]}
                    onPress={() => update(plan.planKey, field, !active)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: active }}
                  >
                    <Text style={localStyles((theme ?? _styleTheme)).smallButtonText}>{active ? 'On' : 'Off'}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            <TouchableOpacity
              style={[localStyles((theme ?? _styleTheme)).smallButton, themeStyle('tabs_AdminTab_285', { theme: theme }, (theme ?? _styleTheme)), saving === plan.planKey && localStyles((theme ?? _styleTheme)).buttonDisabled]}
              disabled={saving === plan.planKey}
              onPress={() => saveConfig(plan)}
              testID={`admin-billing-save-${plan.planKey}`}
            >
              <Text style={[localStyles((theme ?? _styleTheme)).smallButtonText, themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>{saving === plan.planKey ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Main AdminTab
// ---------------------------------------------------------------------------

type PackingPresetItem = { category: string; label: string; position?: number };
type PackingPresetAdminRow = { key: string; label: string; isActive: boolean; items?: PackingPresetItem[] };

const PackingPresetAdminSection: React.FC<{ backendUrl: string; headers: Record<string, string>; theme: AppTheme }> = ({ backendUrl, headers, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [presets, setPresets] = useState<PackingPresetAdminRow[]>([]);
  const [filename, setFilename] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [editableItems, setEditableItems] = useState<PackingPresetItem[]>([]);
  const endpoint = `${backendUrl}/api/admin/packing-list-presets`;
  const load = useCallback(async () => {
    const res = await fetch(endpoint, { headers });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setPresets(data.presets ?? []);
    else setMessage(data.error ?? 'Unable to load presets');
  }, [endpoint, headers]);
  useEffect(() => { void load(); }, [load]);
  const upload = async () => {
    const res = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, markdown }) });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? 'Preset uploaded.' : data.error ?? 'Unable to upload preset');
    if (res.ok) { setFilename(''); setMarkdown(''); void load(); }
  };
  const remove = async (key: string) => {
    const res = await fetch(`${endpoint}/${encodeURIComponent(key)}`, { method: 'DELETE', headers });
    setMessage(res.ok ? 'Preset removed.' : 'Unable to remove preset');
    if (res.ok) void load();
  };
  const reactivate = async (key: string) => {
    const res = await fetch(`${endpoint}/${encodeURIComponent(key)}/reactivate`, { method: 'POST', headers });
    setMessage(res.ok ? 'Preset reactivated.' : 'Unable to reactivate preset');
    if (res.ok) void load();
  };
  const toggleEdit = (preset: PackingPresetAdminRow) => {
    if (expandedKey === preset.key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(preset.key);
    setEditableItems((preset.items ?? []).map((item) => ({ category: item.category, label: item.label })));
  };
  const updateEditableItem = (index: number, patch: Partial<PackingPresetItem>) => {
    setEditableItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const removeEditableItem = (index: number) => {
    setEditableItems((prev) => prev.filter((_, i) => i !== index));
  };
  const addEditableItem = () => {
    setEditableItems((prev) => [...prev, { category: '', label: '' }]);
  };
  const saveItems = async (key: string) => {
    const res = await fetch(`${endpoint}/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: editableItems }),
    });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? 'Preset items saved.' : data.error ?? 'Unable to save preset items');
    if (res.ok) { setExpandedKey(null); void load(); }
  };
  return <View style={themeStyle('tabs_AdminTab_286', {  }, (theme ?? _styleTheme))}>
    <Text style={themeStyle('tabs_AdminTab_287', { theme: theme }, (theme ?? _styleTheme))}>Preset catalog</Text>
    {message ? <Text style={themeStyle('tabs_AdminTab_288', { theme: theme }, (theme ?? _styleTheme))}>{message}</Text> : null}
    {presets.map((preset) => <View key={preset.key} testID={`admin-packing-preset-row-${preset.key}`}>
      <View style={themeStyle('tabs_AdminTab_289', {  }, (theme ?? _styleTheme))}>
        <Text style={themeStyle('tabs_AdminTab_290', { theme: theme }, (theme ?? _styleTheme))}>{preset.label} ({preset.key}){preset.isActive ? '' : ' — removed'}</Text>
        <View style={themeStyle('tabs_AdminTab_291', {  }, (theme ?? _styleTheme))}>
          {preset.key !== 'general' ? (
            <Pressable onPress={() => toggleEdit(preset)} testID={`admin-packing-preset-edit-${preset.key}`}>
              <Text style={themeStyle('tabs_AdminTab_292', { theme: theme }, (theme ?? _styleTheme))}>{expandedKey === preset.key ? 'Close' : 'Edit items'}</Text>
            </Pressable>
          ) : null}
          {preset.key !== 'general' ? <Pressable onPress={() => void (preset.isActive ? remove(preset.key) : reactivate(preset.key))}><Text style={themeStyle('tabs_AdminTab_293', { preset: preset, theme: theme }, (theme ?? _styleTheme))}>{preset.isActive ? 'Remove' : 'Reactivate'}</Text></Pressable> : null}
        </View>
      </View>
      {expandedKey === preset.key ? (
        <View style={themeStyle('tabs_AdminTab_294', {  }, (theme ?? _styleTheme))} testID={`admin-packing-preset-editor-${preset.key}`}>
          {editableItems.map((item, index) => (
            <View key={index} style={themeStyle('tabs_AdminTab_295', {  }, (theme ?? _styleTheme))}>
              <TextInput
                value={item.category}
                onChangeText={(text) => updateEditableItem(index, { category: text })}
                placeholder="Category"
                placeholderTextColor={theme.colors.textMuted}
                style={themeStyle('tabs_AdminTab_296', { theme: theme }, (theme ?? _styleTheme))}
                testID={`admin-packing-preset-item-category-${preset.key}-${index}`}
              />
              <TextInput
                value={item.label}
                onChangeText={(text) => updateEditableItem(index, { label: text })}
                placeholder="Item label"
                placeholderTextColor={theme.colors.textMuted}
                style={themeStyle('tabs_AdminTab_297', { theme: theme }, (theme ?? _styleTheme))}
                testID={`admin-packing-preset-item-label-${preset.key}-${index}`}
              />
              <Pressable onPress={() => removeEditableItem(index)} testID={`admin-packing-preset-item-remove-${preset.key}-${index}`}>
                <Text style={themeStyle('tabs_AdminTab_298', { theme: theme }, (theme ?? _styleTheme))}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <View style={themeStyle('tabs_AdminTab_299', {  }, (theme ?? _styleTheme))}>
            <Pressable onPress={addEditableItem} testID={`admin-packing-preset-item-add-${preset.key}`}>
              <Text style={themeStyle('tabs_AdminTab_300', { theme: theme }, (theme ?? _styleTheme))}>+ Add item</Text>
            </Pressable>
            <Pressable onPress={() => void saveItems(preset.key)} testID={`admin-packing-preset-save-${preset.key}`}>
              <Text style={themeStyle('tabs_AdminTab_301', { theme: theme }, (theme ?? _styleTheme))}>Save items</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>)}
    <TextInput value={filename} onChangeText={setFilename} placeholder="new_list.md" placeholderTextColor={theme.colors.textMuted} style={themeStyle('tabs_AdminTab_302', { theme: theme }, (theme ?? _styleTheme))} />
    <TextInput value={markdown} onChangeText={setMarkdown} multiline numberOfLines={8} placeholder="Paste preset markdown" placeholderTextColor={theme.colors.textMuted} style={themeStyle('tabs_AdminTab_303', { theme: theme }, (theme ?? _styleTheme))} />
    <Pressable onPress={() => void upload()} style={themeStyle('tabs_AdminTab_304', { theme: theme }, (theme ?? _styleTheme))}><Text style={[themeStyle('tabs_AdminTab_305', {  }, (theme ?? _styleTheme)), themeStyle('ctaLabel', {}, (theme ?? _styleTheme))]}>Upload preset</Text></Pressable>
  </View>;
};

const AdminTab: React.FC<AdminTabProps> = ({
  backendUrl,
  headers,
  initialSection = 'overview',
  initialAiOpsSection = 'overview',
  onSectionChange,
  onAiOpsSectionChange,
}) => {
  const _styleTheme = useStyleTheme();
  const colorScheme = useColorScheme();
  const theme = getAppTheme('auto', colorScheme);
  const [section, setSection] = useState<AdminSection>(initialSection);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [loadedTiers, setLoadedTiers] = useState<Tier[]>([]);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  const goTo = (s: AdminSection) => {
    setSection(s);
    onSectionChange?.(s);
  };

  const handleViewUser = (user: AdminUser) => {
    setSelectedUser(user);
    goTo('user-detail');
  };

  const renderSection = () => {
    switch (section) {
      case 'overview':
        return <OverviewSection onNav={goTo} theme={theme} />;
      case 'features':
        return <FeaturesSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'ai-ops':
        return (
          <AiOperationsSection
            backendUrl={backendUrl}
            headers={headers}
            initialAiOpsSection={initialAiOpsSection}
            onAiOpsSectionChange={onAiOpsSectionChange}
            theme={theme}
          />
        );
      case 'packing-defaults':
        return <View style={themeStyle('tabs_AdminTab_306', {  }, _styleTheme)}><PackingListTable backendUrl={backendUrl} headers={headers} theme={theme} variant="admin" title="Universal packing defaults" /><PackingPresetAdminSection backendUrl={backendUrl} headers={headers} theme={theme} /></View>;
      case 'users':
        return <UsersSection backendUrl={backendUrl} headers={headers} tiers={loadedTiers} onViewUser={handleViewUser} theme={theme} />;
      case 'user-detail':
        return selectedUser ? (
          <UserDetailSection
            backendUrl={backendUrl}
            headers={headers}
            userId={selectedUser.id}
            tiers={loadedTiers}
            onBack={() => goTo('users')}
            theme={theme}
          />
        ) : null;
      case 'tiers':
        return <TiersSection backendUrl={backendUrl} headers={headers} onTiersLoaded={setLoadedTiers} theme={theme} />;
      case 'user-data':
        return <UserDataSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'audit-log':
        return <AuditLogSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'ingestion':
        return <IngestionSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'api-limits':
        return <ApiLimitsSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'cost-estimate':
        return <CostEstimateSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'analytics':
        return <AnalyticsSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'privacy-requests':
        return <PrivacyRequestsSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'metrics':
        return <MetricsSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'billing':
        return <BillingSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      default:
        return null;
    }
  };

  const sectionLabel: Record<AdminSection, string> = {
    overview: 'Admin',
    users: 'Users',
    'user-detail': selectedUser?.email ?? 'User Detail',
    tiers: 'Tiers',
    features: 'Feature Flags',
    'ai-ops': 'AI Operations',
    'packing-defaults': 'Packing Defaults',
    'user-data': 'User Data',
    'audit-log': 'Audit Log',
    ingestion: 'Ingestion Ops',
    'api-limits': 'API Limits',
    'cost-estimate': 'Cost Estimator',
    metrics: 'Metrics',
    analytics: 'Analytics',
    'privacy-requests': 'Privacy Requests',
    billing: 'Billing',
  };

  return (
    <View style={[localStyles(_styleTheme).content, themeStyle('tabs_AdminTab_307', { theme: theme }, _styleTheme)]}>
      {section !== 'overview' ? (
        <View style={localStyles(_styleTheme).breadcrumb}>
          <TouchableOpacity onPress={() => goTo('overview')}>
            <Text style={[localStyles(_styleTheme).breadcrumbLink, themeStyle('tabs_AdminTab_308', { theme: theme }, _styleTheme)]}>Admin</Text>
          </TouchableOpacity>
          <Text style={[localStyles(_styleTheme).breadcrumbSep, themeStyle('tabs_AdminTab_309', { theme: theme }, _styleTheme)]}> / </Text>
          <Text style={[localStyles(_styleTheme).breadcrumbCurrent, themeStyle('tabs_AdminTab_310', { theme: theme }, _styleTheme)]}>{sectionLabel[section]}</Text>
        </View>
      ) : null}
      <View style={localStyles(_styleTheme).sectionHost}>
        {section === 'api-limits' || section === 'cost-estimate' ? (
          renderSection()
        ) : (
          <ScrollView style={localStyles(_styleTheme).sectionScroll} contentContainerStyle={localStyles(_styleTheme).sectionScrollContent}>
            {renderSection()}
          </ScrollView>
        )}
      </View>
    </View>
  );
};

export default AdminTab;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const localStyles = (_theme: import('../theme/theme').AppTheme) => themeStyle('tabs_AdminTab_311', { StyleSheet: StyleSheet, shadowStyle: shadowStyle }, _theme);
