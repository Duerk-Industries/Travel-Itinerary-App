import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';
import HorizontalTableScroll from '../components/HorizontalTableScroll';
import { getAppTheme, type AppTheme } from '../theme/theme';
import { usePersistedState } from '../hooks/usePersistedState';
import PackingListTable from '../components/PackingListTable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminSection = 'overview' | 'users' | 'user-detail' | 'tiers' | 'features' | 'ai-ops' | 'packing-defaults' | 'user-data' | 'audit-log' | 'ingestion' | 'api-limits' | 'metrics' | 'billing';
export type AiOpsSection = 'overview' | 'providers' | 'experiments' | 'recommendations' | 'captures' | 'parser-quality' | 'shadow-replay' | 'executive' | 'runtime-settings' | 'ai-audit-log';

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

type FeatureFlag = { key: string; enabled: boolean; description?: string | null };

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

const getCardStyle = (theme: AppTheme) => ({
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  shadowColor: theme.mode === 'dark' ? '#000000' : theme.colors.primary,
});

const getInputStyle = (theme: AppTheme) => ({
  backgroundColor: theme.mode === 'dark' ? theme.colors.backgroundAlt : theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  color: theme.colors.text,
});

const getSecondaryPillStyle = (theme: AppTheme, active = false) => ({
  backgroundColor: active ? theme.colors.primary : theme.colors.backgroundAlt,
  borderColor: active ? theme.colors.primary : theme.colors.border,
});

const getSecondaryPillTextStyle = (theme: AppTheme, active = false) => ({
  color: active ? theme.colors.onPrimary : theme.colors.text,
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// --- Overview ---
const OverviewSection: React.FC<{ onNav: (s: AdminSection) => void } & ThemedSectionProps> = ({ onNav, theme }) => (
  <View style={localStyles.section}>
    <View style={[localStyles.heroCard, getCardStyle(theme), { backgroundColor: theme.colors.primary }]}>
      <Text style={[localStyles.heroEyebrow, { color: theme.colors.link }]}>Operations</Text>
      <Text style={[localStyles.heroTitle, { color: theme.colors.onPrimary }]}>Admin Panel</Text>
      <Text style={[localStyles.heroBody, { color: theme.colors.onPrimary }]}>
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
        { label: 'Billing', section: 'billing' as AdminSection, desc: 'Manage Premium pricing, trial, grace period, tax, and checkout' },
        { label: 'Ingestion Ops', section: 'ingestion' as AdminSection, desc: 'Review import throughput, duplicates, and cost' },
        { label: 'Metrics', section: 'metrics' as AdminSection, desc: 'In-process counters and cache hit rates' },
      ] as { label: string; section: AdminSection; desc: string }[]
    ).map((item) => (
      <TouchableOpacity key={item.section} style={[localStyles.navCard, getCardStyle(theme)]} onPress={() => onNav(item.section)}>
        <View style={[localStyles.navAccent, { backgroundColor: item.section === 'features' ? theme.colors.link : item.section === 'tiers' ? theme.colors.premium : theme.colors.cta }]} />
        <Text style={[localStyles.navCardTitle, { color: theme.colors.text }]}>{item.label}</Text>
        <Text style={[localStyles.navCardDesc, { color: theme.colors.textMuted }]}>{item.desc}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

// --- Feature Flags ---
const FeaturesSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme,
}) => {
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

  if (loading) return <Text style={[localStyles.loading, { color: theme.colors.textMuted }]}>Loading...</Text>;
  if (error) return <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text>;

  return (
    <View style={localStyles.section}>
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>Feature Flags</Text>
      {flags.length === 0 && <Text style={[localStyles.emptyText, { color: theme.colors.textMuted }]}>No feature flags found.</Text>}
      {flags.map((flag) => (
        <View key={flag.key} style={[localStyles.card, getCardStyle(theme)]}>
          <View style={localStyles.row}>
            <View style={localStyles.flex}>
              <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>{flag.key}</Text>
              {flag.description ? <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>{flag.description}</Text> : null}
            </View>
            <View
              style={[
                localStyles.badge,
                { backgroundColor: flag.enabled ? theme.colors.success : theme.colors.alert },
              ]}
            >
              <Text style={localStyles.badgeText}>{flag.enabled ? 'ON' : 'OFF'}</Text>
            </View>
          </View>
          {reasonVisible[flag.key] || true ? (
            <View style={localStyles.inlineForm}>
              <TextInput
                style={[localStyles.smallInput, getInputStyle(theme)]}
                placeholder="Reason (required)"
                placeholderTextColor={theme.colors.textMuted}
                value={reasonInputs[flag.key] ?? ''}
                onChangeText={(t: string) => setReasonInputs((r) => ({ ...r, [flag.key]: t }))}
              />
              <TouchableOpacity
                style={[
                  localStyles.smallButton,
                  { backgroundColor: theme.colors.cta },
                  pendingKey === flag.key && localStyles.buttonDisabled,
                ]}
                disabled={pendingKey === flag.key}
                onPress={() => toggle(flag)}
              >
                <Text style={localStyles.smallButtonText}>{flag.enabled ? 'Disable' : 'Enable'}</Text>
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
} & ThemedSectionProps> = ({ backendUrl, headers, tiers, onViewUser, theme }) => {
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
    <View style={localStyles.section}>
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>Users</Text>
      <TextInput
        style={[localStyles.input, getInputStyle(theme)]}
        placeholder="Search by email, name, or user ID..."
        placeholderTextColor={theme.colors.textMuted}
        value={search}
        onChangeText={(t: string) => { setSearch(t); setPage(1); }}
      />
      {error ? <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text> : null}
      {loading ? <Text style={[localStyles.loading, { color: theme.colors.textMuted }]}>Loading...</Text> : null}
      {!loading && users.length === 0 ? <Text style={[localStyles.emptyText, { color: theme.colors.textMuted }]}>No users found.</Text> : null}
      {selectedIds.size > 0 ? (
        <View
          style={[localStyles.card, getCardStyle(theme)]}
          accessibilityLabel={`Bulk actions for ${selectedIds.size} selected user${selectedIds.size === 1 ? '' : 's'}`}
          testID="admin-users-bulk-action-bar"
        >
          <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>{selectedIds.size} selected</Text>
          <View style={[localStyles.row, { flexWrap: 'wrap', gap: 8, marginTop: 8 }]}>
            <TouchableOpacity
              style={[localStyles.smallButton, { backgroundColor: theme.colors.surfaceMuted }]}
              onPress={() => setBulkTierDropdownOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Choose target tier"
              testID="admin-users-bulk-tier-dropdown-toggle"
            >
              <Text style={[localStyles.smallButtonText, { color: theme.colors.text }]}>
                {selectedTier?.displayName ?? selectedTier?.key ?? 'Select tier'}
              </Text>
            </TouchableOpacity>
            {bulkTierDropdownOpen ? (
              <View style={[localStyles.card, getCardStyle(theme), { padding: 8 }]}>
                {sortedBulkTiers.length === 0 ? (
                  <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>No tiers loaded.</Text>
                ) : null}
                {sortedBulkTiers.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[localStyles.smallButton, { backgroundColor: theme.colors.surfaceMuted, marginBottom: 4 }]}
                    onPress={() => { setBulkTierKey(t.key); setBulkTierDropdownOpen(false); }}
                    accessibilityRole="menuitem"
                    testID={`admin-users-bulk-tier-option-${t.key}`}
                  >
                    <Text style={[localStyles.smallButtonText, { color: theme.colors.text }]}>{t.displayName}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <TextInput
              style={[localStyles.input, getInputStyle(theme), { flex: 1, minWidth: 200 }]}
              placeholder="Reason (min 3 chars)"
              placeholderTextColor={theme.colors.textMuted}
              value={bulkReason}
              onChangeText={setBulkReason}
              accessibilityLabel="Reason for bulk tier change"
              testID="admin-users-bulk-reason"
            />
            <TouchableOpacity
              style={[
                localStyles.smallButton,
                { backgroundColor: theme.colors.primary },
                (!bulkTierKey || bulkReason.trim().length < 3 || bulkApplying) && localStyles.buttonDisabled,
              ]}
              disabled={!bulkTierKey || bulkReason.trim().length < 3 || bulkApplying}
              onPress={applyBulkTier}
              accessibilityRole="button"
              accessibilityState={{ disabled: !bulkTierKey || bulkReason.trim().length < 3 || bulkApplying }}
              accessibilityLabel={`Apply ${selectedTier?.displayName ?? bulkTierKey} tier to ${selectedIds.size} selected user${selectedIds.size === 1 ? '' : 's'}`}
              testID="admin-users-bulk-apply"
            >
              <Text style={[localStyles.smallButtonText, { color: theme.colors.onPrimary }]}>
                {bulkApplying ? 'Applying…' : 'Apply tier'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[localStyles.smallButton, { backgroundColor: theme.colors.surfaceMuted }]}
              onPress={clearSelection}
              accessibilityRole="button"
              accessibilityLabel="Clear user selection"
              testID="admin-users-bulk-clear"
            >
              <Text style={[localStyles.smallButtonText, { color: theme.colors.text }]}>Clear</Text>
            </TouchableOpacity>
          </View>
          <View
            style={[localStyles.row, { flexWrap: 'wrap', gap: 8, marginTop: 8 }]}
            testID="admin-users-bulk-role-row"
          >
            <TouchableOpacity
              style={[
                localStyles.smallButton,
                bulkRole === 'admin'
                  ? { backgroundColor: theme.colors.primary }
                  : { backgroundColor: theme.colors.surfaceMuted },
              ]}
              onPress={() => setBulkRole((r) => (r === 'admin' ? null : 'admin'))}
              accessibilityRole="button"
              accessibilityLabel="Select role: admin"
              accessibilityState={{ selected: bulkRole === 'admin' }}
              testID="admin-users-bulk-role-admin"
            >
              <Text
                style={[
                  localStyles.smallButtonText,
                  { color: bulkRole === 'admin' ? theme.colors.onPrimary : theme.colors.text },
                ]}
              >
                Admin
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                localStyles.smallButton,
                bulkRole === 'user'
                  ? { backgroundColor: theme.colors.primary }
                  : { backgroundColor: theme.colors.surfaceMuted },
              ]}
              onPress={() => setBulkRole((r) => (r === 'user' ? null : 'user'))}
              accessibilityRole="button"
              accessibilityLabel="Select role: user"
              accessibilityState={{ selected: bulkRole === 'user' }}
              testID="admin-users-bulk-role-user"
            >
              <Text
                style={[
                  localStyles.smallButtonText,
                  { color: bulkRole === 'user' ? theme.colors.onPrimary : theme.colors.text },
                ]}
              >
                User
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                localStyles.smallButton,
                { backgroundColor: theme.colors.primary },
                (!bulkRole || bulkReason.trim().length < 3 || bulkRoleApplying) && localStyles.buttonDisabled,
              ]}
              disabled={!bulkRole || bulkReason.trim().length < 3 || bulkRoleApplying}
              onPress={applyBulkRole}
              accessibilityRole="button"
              accessibilityState={{ disabled: !bulkRole || bulkReason.trim().length < 3 || bulkRoleApplying }}
              accessibilityLabel={`Apply ${bulkRole ?? 'role'} to ${selectedIds.size} selected user${selectedIds.size === 1 ? '' : 's'}`}
              testID="admin-users-bulk-role-apply"
            >
              <Text style={[localStyles.smallButtonText, { color: theme.colors.onPrimary }]}>
                {bulkRoleApplying ? 'Applying…' : 'Apply role'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {users.map((u) => {
        const checked = selectedIds.has(u.id);
        return (
          <View key={u.id} style={[localStyles.card, getCardStyle(theme)]}>
            <View style={localStyles.row}>
              <TouchableOpacity
                onPress={() => toggleSelected(u.id)}
                style={{ paddingRight: 10, paddingVertical: 4 }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={`${checked ? 'Deselect' : 'Select'} ${u.email ?? u.id}`}
                testID={`admin-users-row-select-${u.id}`}
              >
                <Text style={{ fontSize: 18, color: theme.colors.text }}>{checked ? '☑' : '☐'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={localStyles.flex} onPress={() => onViewUser(u)}>
                <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>{u.email ?? u.id}</Text>
                {(u.firstName || u.lastName) ? (
                  <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
                    {[u.firstName, u.lastName].filter(Boolean).join(' ')}
                  </Text>
                ) : null}
              </TouchableOpacity>
              <View style={localStyles.tagRow}>
                {u.role === 'admin' ? (
                  <View style={[localStyles.tagAdmin, { backgroundColor: theme.colors.primary }]}>
                    <Text style={localStyles.tagText}>admin</Text>
                  </View>
                ) : null}
                {u.tierKey ? (
                  <View style={[localStyles.tagTier, { backgroundColor: theme.colors.premium }]}>
                    <Text style={localStyles.tagText}>{u.tierKey}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
      {totalPages > 1 ? (
        <View style={localStyles.pagination}>
          <TouchableOpacity
            style={[
              localStyles.pageButton,
              { backgroundColor: theme.colors.primary },
              page === 1 && localStyles.buttonDisabled,
            ]}
            disabled={page === 1}
            onPress={() => setPage((p) => p - 1)}
          >
            <Text style={localStyles.pageButtonText}>Prev</Text>
          </TouchableOpacity>
          <Text style={[localStyles.pageInfo, { color: theme.colors.textMuted }]}>{page} / {totalPages}</Text>
          <TouchableOpacity
            style={[
              localStyles.pageButton,
              { backgroundColor: theme.colors.primary },
              page === totalPages && localStyles.buttonDisabled,
            ]}
            disabled={page === totalPages}
            onPress={() => setPage((p) => p + 1)}
          >
            <Text style={localStyles.pageButtonText}>Next</Text>
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
} & ThemedSectionProps> = ({ backendUrl, headers, userId, tiers, onBack, theme }) => {
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

  if (loading) return <Text style={[localStyles.loading, { color: theme.colors.textMuted }]}>Loading...</Text>;
  if (error) return <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text>;
  if (!user) return null;

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.id;
  const tierLocked = user.role === 'admin';
  const currentTierKey = tierLocked ? 'pro' : (user.tierKey ?? 'none');
  const sortedTiers = [...availableTiers].sort((a, b) => a.rank - b.rank);
  const selectedTierLabel = sortedTiers.find((tier) => tier.key === tierKey)?.displayName ?? tierKey ?? '';

  return (
    <View style={localStyles.section}>
      <TouchableOpacity onPress={onBack} style={localStyles.backLink}>
        <Text style={[localStyles.backLinkText, { color: theme.colors.link }]}>Back to Users</Text>
      </TouchableOpacity>
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>{displayName}</Text>
      <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>{user.email}</Text>

      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Current Tier: {currentTierKey}</Text>
        <Text style={[localStyles.fieldLabel, { color: theme.colors.textMuted }]}>Change Tier</Text>
        {!tierLocked ? (
          <TouchableOpacity
            testID="user-tier-dropdown-button"
            style={[localStyles.dropdownButton, getInputStyle(theme)]}
            onPress={() => setTierDropdownOpen((open) => !open)}
          >
            <Text style={[localStyles.dropdownButtonText, { color: theme.colors.text }]}>
              {selectedTierLabel || 'Select a tier'} v
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={[localStyles.dropdownButton, getInputStyle(theme), localStyles.dropdownLocked]}>
            <Text style={[localStyles.dropdownButtonText, { color: theme.colors.textMuted }]}>Pro (locked for admins)</Text>
          </View>
        )}
        {tierDropdownOpen && !tierLocked ? (
          <View style={[localStyles.dropdownMenu, getCardStyle(theme)]}>
            {sortedTiers.map((tier) => (
              <Pressable
                key={tier.key}
                testID={`user-tier-option-${tier.key}`}
                style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                  localStyles.dropdownOption,
                  hovered && { backgroundColor: theme.mode === 'dark' ? '#2C4356' : '#F4F8FB' },
                  pressed && { backgroundColor: theme.mode === 'dark' ? '#35516A' : '#E8F0F6' },
                  tierKey === tier.key && { backgroundColor: theme.colors.backgroundAlt },
                ]}
                onPress={() => {
                  setTierKey(tier.key);
                  setTierDropdownOpen(false);
                }}
              >
                <Text style={[localStyles.dropdownOptionText, { color: theme.colors.text }]}>
                  {tier.displayName}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {tierLocked ? (
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>Admin users are automatically assigned the Pro tier.</Text>
        ) : (
          <>
            <TextInput
              testID="user-tier-reason-input"
              style={[localStyles.smallInput, getInputStyle(theme)]}
              placeholder="Reason (required)"
              placeholderTextColor={theme.colors.textMuted}
              value={tierReason}
              onChangeText={setTierReason}
            />
            <TouchableOpacity
              testID="user-tier-save-button"
              style={[localStyles.smallButton, { backgroundColor: theme.colors.cta }, saving && localStyles.buttonDisabled]}
              disabled={saving}
              onPress={saveTier}
            >
              <Text style={localStyles.smallButtonText}>Save Tier</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Current Role: {user.role}</Text>
        <Text style={[localStyles.fieldLabel, { color: theme.colors.textMuted }]}>Change Role</Text>
        <View style={localStyles.tierButtons}>
          {(['user', 'admin'] as const).map((r) => (
            <TouchableOpacity
              key={r}
              style={[localStyles.tierButton, getSecondaryPillStyle(theme, role === r)]}
              onPress={() => setRole(r)}
            >
              <Text style={[localStyles.tierButtonText, getSecondaryPillTextStyle(theme, role === r)]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {role === 'admin' ? (
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>Saving the admin role will also set the tier to Pro.</Text>
        ) : null}
        <TextInput
          testID="user-role-reason-input"
          style={[localStyles.smallInput, getInputStyle(theme)]}
          placeholder="Reason (required)"
          placeholderTextColor={theme.colors.textMuted}
          value={roleReason}
          onChangeText={setRoleReason}
        />
        <TouchableOpacity
          testID="user-role-save-button"
          style={[localStyles.smallButton, { backgroundColor: theme.colors.cta }, saving && localStyles.buttonDisabled]}
          disabled={saving}
          onPress={saveRole}
        >
          <Text style={localStyles.smallButtonText}>Save Role</Text>
        </TouchableOpacity>
      </View>

      {saveMsg ? <Text style={[localStyles.saveMsg, { color: saveMsg.startsWith('Error:') ? theme.colors.error : theme.colors.success }]}>{saveMsg}</Text> : null}

      {user.usage && user.usage.length > 0 ? (
        <View style={[localStyles.card, getCardStyle(theme)]}>
          <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Usage</Text>
          {user.usage.map((c, i) => (
            <View key={i} style={localStyles.row}>
              <Text style={[localStyles.flex, { color: theme.colors.text }]}>{c.metricKey} ({c.windowKey})</Text>
              <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>{c.count}</Text>
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
}> = ({ backendUrl, headers, onTiersLoaded }) => {
  const colorScheme = useColorScheme();
  const theme = getAppTheme('auto', colorScheme);
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

  if (loading) return <Text style={[localStyles.loading, { color: theme.colors.textMuted }]}>Loading...</Text>;
  if (error) return <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text>;

  return (
    <View style={localStyles.section}>
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>Tiers</Text>
      {saveMsg ? <Text style={[localStyles.saveMsg, { color: theme.colors.success }]}>{saveMsg}</Text> : null}
      {tiers.length === 0 ? <Text style={[localStyles.emptyText, { color: theme.colors.textMuted }]}>No tiers found.</Text> : null}
      {tiers.length > 0 ? (
        <View
          style={[
            localStyles.tableShell,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              shadowColor: theme.mode === 'dark' ? '#000000' : theme.colors.primary,
            },
          ]}
        >
          <HorizontalTableScroll>
            <View>
              <View
                style={[
                  localStyles.tableHeaderRow,
                  { backgroundColor: theme.colors.primary, borderBottomColor: theme.colors.border },
                ]}
              >
                <View
                  style={[
                    localStyles.tableNameCell,
                    localStyles.tableHeaderCell,
                    { width: nameColumnWidth, borderRightColor: theme.colors.border },
                  ]}
                >
                  <Text style={[localStyles.tableHeaderText, { color: theme.colors.onPrimary }]}>Name</Text>
                </View>
                {tierColumns.map((tier) => (
                  <View
                    key={tier.key}
                    style={[
                      localStyles.tableTierCell,
                      localStyles.tableHeaderCell,
                      { width: tierColumnWidth, borderRightColor: theme.colors.border },
                    ]}
                  >
                    <Text style={[localStyles.tableHeaderText, { color: theme.colors.onPrimary }]}>
                      {tier.displayName}
                    </Text>
                  </View>
                ))}
              </View>

              <ScrollView style={localStyles.tableBodyScroll} nestedScrollEnabled>
                {tableRows.map((row, index) => (
                  <View
                    key={row.key}
                    style={[
                      localStyles.tableDataRow,
                      {
                        backgroundColor: index % 2 === 0 ? theme.colors.surface : theme.colors.surfaceMuted,
                        borderBottomColor: theme.colors.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        localStyles.tableNameCell,
                        { width: nameColumnWidth, borderRightColor: theme.colors.border },
                      ]}
                    >
                      <Text style={[localStyles.tableNameText, { color: theme.colors.text }]}>{row.label}</Text>
                      <Text style={[localStyles.tableMetaText, { color: theme.colors.textMuted }]}>
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
                              localStyles.tableTierCell,
                              { width: tierColumnWidth, borderRightColor: theme.colors.border },
                            ]}
                          >
                            <TouchableOpacity
                              accessibilityRole="button"
                              testID={`tier-limit-cell-${row.key}-${tier.key}`}
                              style={localStyles.tableLinkButton}
                              onPress={() => {
                                setEditingLimit({ tierKey: tier.key, limitKey: row.key });
                                setLimitValue(cellValue.explicitValue === null ? '' : String(cellValue.explicitValue));
                                setLimitReason('');
                                setSaveMsg(null);
                              }}
                            >
                              <Text style={[localStyles.tableLinkText, { color: theme.colors.link }]}>
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
                      const buttonBorderColor = isInherited ? theme.colors.border : 'transparent';
                      const primaryTextColor = isInherited
                        ? theme.colors.text
                        : displayValue === null
                          ? theme.colors.text
                          : '#FFFFFF';
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
                            localStyles.tableTierCell,
                            { width: tierColumnWidth, borderRightColor: theme.colors.border },
                          ]}
                        >
                          <TouchableOpacity
                            accessibilityRole="button"
                            testID={`tier-feature-cell-${row.key}-${tier.key}`}
                            style={[
                              localStyles.toggleCellButton,
                              {
                                backgroundColor: buttonBackgroundColor,
                                borderColor: buttonBorderColor,
                                borderWidth: isInherited ? 1 : 0,
                              },
                            ]}
                            disabled={isInherited}
                            onPress={isInherited ? undefined : () => {
                              setEditingEntitlement({ tierKey: tier.key, featureKey: row.key });
                              setEntitlementReason('');
                              setSaveMsg(null);
                            }}
                          >
                            <Text style={[localStyles.toggleCellText, { color: primaryTextColor }]}>
                              {buttonLabel}
                            </Text>
                            {secondaryLabel ? (
                              <Text style={[localStyles.toggleCellSubtext, { color: secondaryTextColor }]}>
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
          <View style={[localStyles.modalBackdrop, { backgroundColor: 'rgba(0, 0, 0, 0.45)' }]}>
            <View
              style={[
                localStyles.modalCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Text style={[localStyles.modalTitle, { color: theme.colors.text }]}>Update limit</Text>
              <Text style={[localStyles.modalBodyText, { color: theme.colors.textMuted }]}>
                {editingLimit.limitKey} for {editingLimit.tierKey}
              </Text>
              <Text style={[localStyles.modalBodyText, { color: theme.colors.textMuted }]}>
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
                  localStyles.modalInput,
                  {
                    backgroundColor: theme.colors.backgroundAlt,
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  },
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
                  localStyles.modalInput,
                  localStyles.modalTextArea,
                  {
                    backgroundColor: theme.colors.backgroundAlt,
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  },
                ]}
                placeholder="Reason (required)"
                placeholderTextColor={theme.colors.textMuted}
                value={limitReason}
                onChangeText={setLimitReason}
                multiline
              />
              <View style={localStyles.modalActions}>
                <TouchableOpacity
                  testID="tier-limit-cancel-button"
                  style={[
                    localStyles.modalSecondaryButton,
                    { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
                  ]}
                  onPress={resetLimitDialog}
                >
                  <Text style={[localStyles.modalSecondaryButtonText, { color: theme.colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="tier-limit-save-button"
                  style={[
                    localStyles.modalPrimaryButton,
                    { backgroundColor: theme.colors.cta },
                    saving && localStyles.buttonDisabled,
                  ]}
                  disabled={saving}
                  onPress={() => saveLimit(editingLimit.tierKey, editingLimit.limitKey)}
                >
                  <Text style={[localStyles.modalPrimaryButtonText, { color: '#FFFFFF' }]}>Save</Text>
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
          <View style={[localStyles.modalBackdrop, { backgroundColor: 'rgba(0, 0, 0, 0.45)' }]}>
            <View
              style={[
                localStyles.modalCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Text style={[localStyles.modalTitle, { color: theme.colors.text }]}>Change feature access</Text>
              <Text style={[localStyles.modalBodyText, { color: theme.colors.textMuted }]}>
                {editingEntitlement.featureKey} for {editingEntitlement.tierKey}
              </Text>
              <TextInput
                testID="tier-feature-reason-input"
                style={[
                  localStyles.modalInput,
                  localStyles.modalTextArea,
                  {
                    backgroundColor: theme.colors.backgroundAlt,
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  },
                ]}
                placeholder="Reason (required)"
                placeholderTextColor={theme.colors.textMuted}
                value={entitlementReason}
                onChangeText={setEntitlementReason}
                multiline
              />
              <View style={localStyles.modalActions}>
                <TouchableOpacity
                  testID="tier-feature-cancel-button"
                  style={[
                    localStyles.modalSecondaryButton,
                    { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
                  ]}
                  onPress={resetEntitlementDialog}
                >
                  <Text style={[localStyles.modalSecondaryButtonText, { color: theme.colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="tier-feature-save-button"
                  style={[
                    localStyles.modalPrimaryButton,
                    { backgroundColor: theme.colors.cta },
                    saving && localStyles.buttonDisabled,
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
                  <Text style={[localStyles.modalPrimaryButtonText, { color: '#FFFFFF' }]}>Save</Text>
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
  theme,
}) => {
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
    <View style={localStyles.section} testID="admin-metrics-section">
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>Metrics</Text>
      <Text style={[localStyles.cardSub, { color: theme.colors.textMuted, marginBottom: 8 }]}>
        Per-instance in-process counters since process start. Multi-instance deployments will see per-instance numbers.
      </Text>
      <TouchableOpacity
        style={[localStyles.smallButton, { backgroundColor: theme.colors.primary, alignSelf: 'flex-start', marginBottom: 12 }]}
        onPress={load}
        accessibilityRole="button"
        accessibilityLabel="Refresh metrics"
        testID="admin-metrics-refresh"
      >
        <Text style={[localStyles.smallButtonText, { color: theme.colors.onPrimary }]}>Refresh</Text>
      </TouchableOpacity>
      {error ? <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text> : null}
      {loading && !snapshot ? <Text style={[localStyles.loading, { color: theme.colors.textMuted }]}>Loading...</Text> : null}

      {queueDepth ? (
        <View
          style={[localStyles.card, getCardStyle(theme), { marginBottom: 12 }]}
          testID="admin-metrics-queue-depth"
        >
          <Text style={[localStyles.cardTitle, { color: theme.colors.text, marginBottom: 4 }]}>
            Ingestion queue depth
          </Text>
          <View style={localStyles.row}>
            <Text style={[localStyles.cardSub, localStyles.flex, { color: theme.colors.text }]}>Active</Text>
            <Text
              style={[localStyles.cardTitle, { color: theme.colors.text }]}
              testID="admin-metrics-queue-active"
            >
              {queueDepth.totalActive}
            </Text>
          </View>
          <View style={localStyles.row}>
            <Text style={[localStyles.cardSub, localStyles.flex, { color: theme.colors.text }]}>Failed (retriable)</Text>
            <Text
              style={[localStyles.cardTitle, { color: theme.colors.text }]}
              testID="admin-metrics-queue-failed"
            >
              {queueDepth.failedRetriable}
            </Text>
          </View>
          <View style={localStyles.row}>
            <Text style={[localStyles.cardSub, localStyles.flex, { color: theme.colors.textMuted }]}>Terminal</Text>
            <Text
              style={[localStyles.cardSub, { color: theme.colors.textMuted }]}
              testID="admin-metrics-queue-terminal"
            >
              {queueDepth.totalTerminal}
            </Text>
          </View>
          {Object.entries(queueDepth.countsByState).length > 0 ? (
            <Text style={[localStyles.cardSub, { color: theme.colors.textMuted, marginTop: 6 }]}>
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
          <Text style={[localStyles.cardTitle, { color: theme.colors.text, marginBottom: 4 }]}>Cache hit rates</Text>
          {snapshot.cacheRatios.length === 0 ? (
            <Text style={[localStyles.emptyText, { color: theme.colors.textMuted }]}>
              No cache traffic observed yet on this instance.
            </Text>
          ) : (
            snapshot.cacheRatios.map((row) => (
              <View
                key={row.namespace}
                style={[localStyles.card, getCardStyle(theme)]}
                testID={`admin-metrics-cache-row-${row.namespace}`}
              >
                <View style={localStyles.row}>
                  <Text style={[localStyles.cardTitle, localStyles.flex, { color: theme.colors.text }]}>{row.namespace}</Text>
                  <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>{fmtPct(row.hitRate)}</Text>
                </View>
                <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
                  {row.hits} hits / {row.misses} misses ({row.total} total)
                </Text>
              </View>
            ))
          )}

          <Text style={[localStyles.cardTitle, { color: theme.colors.text, marginTop: 16, marginBottom: 4 }]}>Counters</Text>
          {nonCacheCounters.length === 0 ? (
            <Text style={[localStyles.emptyText, { color: theme.colors.textMuted }]}>No counter activity on this instance.</Text>
          ) : (
            nonCacheCounters.map(([name, value]) => (
              <View key={name} style={[localStyles.card, getCardStyle(theme)]} testID={`admin-metrics-counter-${name}`}>
                <View style={localStyles.row}>
                  <Text style={[localStyles.cardSub, localStyles.flex, { color: theme.colors.text }]}>{name}</Text>
                  <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>{value}</Text>
                </View>
              </View>
            ))
          )}

          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted, marginTop: 12 }]}>
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
  theme,
}) => {
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
    <View style={localStyles.section}>
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>User Data</Text>
      <View style={localStyles.tierButtons}>
        {(['7d', '30d', 'all-time'] as const).map((w) => (
          <TouchableOpacity
            key={w}
            style={[localStyles.tierButton, getSecondaryPillStyle(theme, window === w)]}
            onPress={() => { setWindow(w); setPage(1); }}
          >
            <Text style={[localStyles.tierButtonText, getSecondaryPillTextStyle(theme, window === w)]}>{w}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text> : null}
      {loading ? <Text style={[localStyles.loading, { color: theme.colors.textMuted }]}>Loading...</Text> : null}
      {!loading && rows.length === 0 ? <Text style={[localStyles.emptyText, { color: theme.colors.textMuted }]}>No data.</Text> : null}
      {rows.map((row) => (
        <View key={row.id} style={[localStyles.card, getCardStyle(theme)]}>
          <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>{row.email ?? row.id}</Text>
          <View style={localStyles.tagRow}>
            {row.role === 'admin' ? <View style={[localStyles.tagAdmin, { backgroundColor: theme.colors.primary }]}><Text style={localStyles.tagText}>admin</Text></View> : null}
            {row.tierKey ? <View style={[localStyles.tagTier, { backgroundColor: theme.colors.premium }]}><Text style={localStyles.tagText}>{row.tierKey}</Text></View> : null}
          </View>
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>Trips: {row.tripCount}</Text>
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>Trip creations: {row.tripCreations}</Text>
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>AI generations: {row.aiGenerations}</Text>
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>Tokens: {row.tokens}</Text>
          {row.apiCalls ? (
            <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
              API calls: {Object.entries(row.apiCalls).map(([key, value]) => `${key} ${value}`).join(' | ')}
            </Text>
          ) : null}
        </View>
      ))}
      {totalPages > 1 ? (
        <View style={localStyles.pagination}>
          <TouchableOpacity
            style={[localStyles.pageButton, { backgroundColor: theme.colors.primary }, page === 1 && localStyles.buttonDisabled]}
            disabled={page === 1}
            onPress={() => setPage((p) => p - 1)}
          >
            <Text style={localStyles.pageButtonText}>Prev</Text>
          </TouchableOpacity>
          <Text style={[localStyles.pageInfo, { color: theme.colors.textMuted }]}>{page} / {totalPages}</Text>
          <TouchableOpacity
            style={[localStyles.pageButton, { backgroundColor: theme.colors.primary }, page === totalPages && localStyles.buttonDisabled]}
            disabled={page === totalPages}
            onPress={() => setPage((p) => p + 1)}
          >
            <Text style={localStyles.pageButtonText}>Next</Text>
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
  theme,
}) => {
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
    <View style={localStyles.section}>
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>Audit Log</Text>
      {error ? <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text> : null}
      {loading ? <Text style={[localStyles.loading, { color: theme.colors.textMuted }]}>Loading...</Text> : null}
      {!loading && entries.length === 0 ? <Text style={[localStyles.emptyText, { color: theme.colors.textMuted }]}>No audit entries.</Text> : null}
      {entries.map((entry) => (
        <View key={entry.id} style={[localStyles.card, getCardStyle(theme)]}>
          <View style={localStyles.row}>
            <Text style={[localStyles.cardTitle, localStyles.flex, { color: theme.colors.text }]}>{entry.action}</Text>
            <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>{fmt(entry.createdAt)}</Text>
          </View>
          {entry.reason ? <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>Reason: {entry.reason}</Text> : null}
          {entry.actorUserId ? <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>Actor: {entry.actorUserId}</Text> : null}
          {entry.targetUserId ? <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>Target: {entry.targetUserId}</Text> : null}
        </View>
      ))}
      {totalPages > 1 ? (
        <View style={localStyles.pagination}>
          <TouchableOpacity
            style={[localStyles.pageButton, { backgroundColor: theme.colors.primary }, page === 1 && localStyles.buttonDisabled]}
            disabled={page === 1}
            onPress={() => setPage((p) => p - 1)}
          >
            <Text style={localStyles.pageButtonText}>Prev</Text>
          </TouchableOpacity>
          <Text style={[localStyles.pageInfo, { color: theme.colors.textMuted }]}>{page} / {totalPages}</Text>
          <TouchableOpacity
            style={[localStyles.pageButton, { backgroundColor: theme.colors.primary }, page === totalPages && localStyles.buttonDisabled]}
            disabled={page === totalPages}
            onPress={() => setPage((p) => p + 1)}
          >
            <Text style={localStyles.pageButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const IngestionSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme,
}) => {
  const [metrics, setMetrics] = useState<IngestionMetrics | null>(null);
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
  }, [backendUrl, headers]);

  useEffect(() => { load(); }, [load]);

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

  if (loading) return <Text style={[localStyles.loading, { color: theme.colors.textMuted }]}>Loading...</Text>;
  if (error) return <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text>;
  if (!metrics) return null;

  const duplicateRate = metrics.duplicateRate.totalCount
    ? `${Math.round((metrics.duplicateRate.duplicateCount / metrics.duplicateRate.totalCount) * 100)}%`
    : '0%';
  const lowConfidenceRate = metrics.lowConfidenceRate.totalCount
    ? `${Math.round((metrics.lowConfidenceRate.lowConfidenceCount / metrics.lowConfidenceRate.totalCount) * 100)}%`
    : '0%';

  return (
    <View style={localStyles.section}>
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>Ingestion Operations</Text>
      {message ? <Text style={[localStyles.saveMsg, { color: theme.colors.success }]}>{message}</Text> : null}
      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Duplicate Rate</Text>
        <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>{duplicateRate}</Text>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Low Confidence Rate</Text>
        <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>{lowConfidenceRate}</Text>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Retries / Dead Letters</Text>
        <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
          {metrics.retryAndDeadLetter.retryCount} retries • {metrics.retryAndDeadLetter.deadLetterCount} dead-lettered
        </Text>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Gmail Auth Failures</Text>
        <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>{metrics.gmailAuthFailures}</Text>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Webhook Signature Failures</Text>
        <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>{metrics.webhookSignatureFailures}</Text>
      </View>

      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Ingestion Volume by Source and Tier</Text>
        {metrics.ingestionVolumeBySourceAndTier.map((row) => (
          <Text key={`${row.sourceType}-${row.tierKey}`} style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            {row.sourceType} • {row.tierKey}: {row.count}
          </Text>
        ))}
      </View>

      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Parse Success / Failure by Stage</Text>
        {metrics.parseRateByStage.map((row) => (
          <Text key={row.stageName} style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            {row.stageName}: {row.successCount} success • {row.failureCount} failure
          </Text>
        ))}
        <Text style={[localStyles.cardTitle, { color: theme.colors.text, marginTop: 10 }]}>Average Processing Latency</Text>
        {metrics.averageLatencyByStage.map((row) => (
          <Text key={row.stageName} style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            {row.stageName}: {row.averageMs} ms
          </Text>
        ))}
      </View>

      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>LLM Usage and Estimated Cost</Text>
        {metrics.llmUsageByModel.map((row) => (
          <Text key={`${row.provider}-${row.modelName}`} style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            {row.provider} / {row.modelName}: {row.tokensIn} in • {row.tokensOut} out • ${row.estimatedCostUsd.toFixed(2)}
          </Text>
        ))}
        <Text style={[localStyles.cardTitle, { color: theme.colors.text, marginTop: 10 }]}>Cost per User</Text>
        {metrics.costPerUser.map((row) => (
          <Text key={row.userId} style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            {row.userId}: ${row.estimatedCostUsd.toFixed(2)}
          </Text>
        ))}
      </View>

      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Quota Consumption by User / Tier</Text>
        {metrics.quotaByUserTier.map((row) => (
          <Text key={row.userId} style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            {row.userId} • {row.tierKey}: {row.uploadsUsed}
          </Text>
        ))}
      </View>

      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Retry Policy</Text>
        {retryConfig ? (
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            Last updated: {new Date(retryConfig.updatedAt).toLocaleString()}
          </Text>
        ) : null}
        <TextInput
          style={[localStyles.smallInput, getInputStyle(theme)]}
          value={retryForm.maxAttempts}
          onChangeText={(value: string) => setRetryForm((current) => ({ ...current, maxAttempts: value }))}
          placeholder="Max attempts"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TextInput
          style={[localStyles.smallInput, getInputStyle(theme)]}
          value={retryForm.baseDelaySeconds}
          onChangeText={(value: string) => setRetryForm((current) => ({ ...current, baseDelaySeconds: value }))}
          placeholder="Base delay seconds"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TextInput
          style={[localStyles.smallInput, getInputStyle(theme)]}
          value={retryForm.maxDelaySeconds}
          onChangeText={(value: string) => setRetryForm((current) => ({ ...current, maxDelaySeconds: value }))}
          placeholder="Max delay seconds"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TextInput
          style={[localStyles.smallInput, getInputStyle(theme)]}
          value={retryForm.alertThresholdPercent}
          onChangeText={(value: string) => setRetryForm((current) => ({ ...current, alertThresholdPercent: value }))}
          placeholder="Alert threshold percent"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TouchableOpacity style={[localStyles.smallButton, { backgroundColor: theme.colors.cta }]} onPress={saveRetryConfig}>
          <Text style={localStyles.smallButtonText}>Save Retry Policy</Text>
        </TouchableOpacity>
      </View>

      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Clear Extraction Cache</Text>
        <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
          Delete all cached extraction results so re-uploaded documents are re-parsed with the latest logic version.
        </Text>
        <TouchableOpacity
          style={[localStyles.tierButton, getSecondaryPillStyle(theme)]}
          onPress={clearCache}
        >
          <Text style={[localStyles.tierButtonText, getSecondaryPillTextStyle(theme)]}>Clear Cache</Text>
        </TouchableOpacity>
      </View>

      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Dead-Letter Re-drive</Text>
        <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
          Move dead-lettered jobs back to `PENDING` and enqueue them again.
        </Text>
        <View style={localStyles.tierButtons}>
          {(['ALL', 'MAILGUN', 'GMAIL'] as const).map((provider) => (
            <TouchableOpacity
              key={provider}
              style={[localStyles.tierButton, getSecondaryPillStyle(theme)]}
              onPress={() => redriveDeadLetters(provider)}
            >
              <Text style={[localStyles.tierButtonText, getSecondaryPillTextStyle(theme)]}>Re-drive {provider}</Text>
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

const ApiLimitsSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme,
}) => {
  const [providers, setProviders] = useState<ApiLimitProvider[]>([]);
  const [providerForms, setProviderForms] = useState<Record<string, ApiLimitProviderForm>>({});
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
    if (parsedMonthlyBudgetUsd !== null && (!Number.isFinite(parsedMonthlyBudgetUsd) || parsedMonthlyBudgetUsd <= 0)) {
      setError(`Monthly budget for ${provider.provider} must be blank or a positive number.`);
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

  if (loading) return <Text style={[localStyles.loading, { color: theme.colors.textMuted }]}>Loading...</Text>;
  if (error) return <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text>;

  return (
    <ScrollView style={[localStyles.section, localStyles.apiLimitsScroll]} contentContainerStyle={localStyles.apiLimitsScrollContent}>
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>API Rate Limits</Text>
      <Text style={[localStyles.cardSub, { color: theme.colors.textMuted, marginBottom: 12 }]}>
        Limits are configured in api-limits.yaml. Usage resets per window period, request counts are durable, and provider spend is estimated from recorded token usage.
      </Text>
      {message ? <Text style={[localStyles.saveMsg, { color: theme.colors.success }]}>{message}</Text> : null}
      {providers.map((provider) => (
        <View key={provider.provider} style={[localStyles.card, getCardStyle(theme)]}>
          <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>
            {provider.provider}
          </Text>
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            Window: {provider.windowHours}h ({provider.window}) | Overall limit: {provider.overallLimit ?? 'none'} | Used: {provider.overallUsage}
          </Text>
          <Text
            style={[
              localStyles.cardSub,
              {
                color:
                  provider.isBudgetExceeded ||
                  ((provider.budgetUsagePercent ?? 0) >= (provider.budgetAlertThresholdPercent ?? Number.POSITIVE_INFINITY))
                    ? theme.colors.error
                    : theme.colors.textMuted,
              },
            ]}
          >
            Budget ({provider.budgetWindowKey ?? 'current'}): {provider.monthlyBudgetUsd == null ? 'not set' : `$${provider.monthlyBudgetUsd.toFixed(2)}`} | Estimated spend: ${(provider.estimatedSpendUsd ?? 0).toFixed(4)}
            {provider.budgetUsagePercent != null ? ` (${Math.round(provider.budgetUsagePercent)}%)` : ''}
          </Text>
          <Text style={[localStyles.fieldLabel, { color: theme.colors.textMuted }]}>Window</Text>
          <View style={localStyles.tierButtons}>
            {(['hour', 'day'] as const).map((windowOption) => (
              <TouchableOpacity
                key={`${provider.provider}-${windowOption}`}
                style={[localStyles.tierButton, getSecondaryPillStyle(theme, providerForms[provider.provider]?.window === windowOption)]}
                onPress={() => updateProviderForm(provider.provider, { window: windowOption })}
              >
                <Text style={[localStyles.tierButtonText, getSecondaryPillTextStyle(theme, providerForms[provider.provider]?.window === windowOption)]}>
                  {windowOption}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[localStyles.smallInput, getInputStyle(theme)]}
            placeholder="Window hours"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="numeric"
            value={providerForms[provider.provider]?.windowHours ?? ''}
            onChangeText={(value: string) => updateProviderForm(provider.provider, { windowHours: value })}
          />
          <TextInput
            style={[localStyles.smallInput, getInputStyle(theme)]}
            placeholder="Overall limit (blank for none)"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="numeric"
            value={providerForms[provider.provider]?.overallLimit ?? ''}
            onChangeText={(value: string) => updateProviderForm(provider.provider, { overallLimit: value })}
          />
          <TextInput
            style={[localStyles.smallInput, getInputStyle(theme)]}
            placeholder="Monthly budget USD (blank for none)"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="numeric"
            value={providerForms[provider.provider]?.monthlyBudgetUsd ?? ''}
            onChangeText={(value: string) => updateProviderForm(provider.provider, { monthlyBudgetUsd: value })}
          />
          <TextInput
            style={[localStyles.smallInput, getInputStyle(theme)]}
            placeholder="Budget alert threshold %"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="numeric"
            value={providerForms[provider.provider]?.alertThresholdPercent ?? ''}
            onChangeText={(value: string) => updateProviderForm(provider.provider, { alertThresholdPercent: value })}
          />
          {(provider.budgetingModels ?? []).map((model) => (
            <View key={`${provider.provider}-${model.model}`} style={localStyles.apiLimitCallerRow}>
              <View style={localStyles.flex}>
                <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>{model.model}</Text>
                <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>USD / 1M tokens</Text>
              </View>
              <TextInput
                style={[localStyles.apiLimitInput, getInputStyle(theme)]}
                placeholder="Input"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="numeric"
                value={providerForms[provider.provider]?.budgetingModels?.[model.model]?.inputCostPer1MTokensUsd ?? ''}
                onChangeText={(value: string) =>
                  updateBudgetingModel(provider.provider, model.model, 'inputCostPer1MTokensUsd', value)
                }
              />
              <TextInput
                style={[localStyles.apiLimitInput, getInputStyle(theme)]}
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
              <View key={caller.caller} style={localStyles.apiLimitCallerRow}>
                <View style={localStyles.flex}>
                  <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
                    {caller.caller}
                  </Text>
                  <Text style={[localStyles.cardSub, { color: isHigh ? theme.colors.error : theme.colors.textMuted }]}>
                    Used: {caller.currentUsage} / {caller.limit} ({pct}%)
                  </Text>
                </View>
                <TextInput
                  style={[localStyles.apiLimitInput, getInputStyle(theme)]}
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
            style={[localStyles.smallInput, getInputStyle(theme)]}
            placeholder="Reason for change (required)"
            placeholderTextColor={theme.colors.textMuted}
            value={providerForms[provider.provider]?.reason ?? ''}
            onChangeText={(value: string) => updateProviderForm(provider.provider, { reason: value })}
          />
          <TouchableOpacity
            style={[localStyles.smallButton, { backgroundColor: theme.colors.cta }, savingProvider === provider.provider && localStyles.buttonDisabled]}
            disabled={savingProvider === provider.provider}
            onPress={() => saveProvider(provider)}
          >
            <Text style={localStyles.smallButtonText}>Save {provider.provider}</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={[localStyles.smallButton, { backgroundColor: theme.colors.cta, marginTop: 8 }]} onPress={load}>
        <Text style={localStyles.smallButtonText}>Refresh</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const BillingSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme,
}) => {
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
    <View style={localStyles.section} testID="admin-billing-section">
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>Billing</Text>
      <Text style={[localStyles.cardSub, { color: billingEnabled ? theme.colors.success : theme.colors.error, marginBottom: 12 }]}>
        Stripe billing is {billingEnabled ? 'enabled' : 'disabled'} on this server.
      </Text>
      {error ? <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text> : null}
      {message ? <Text style={[localStyles.saveMsg, { color: theme.colors.success }]}>{message}</Text> : null}
      {plans.map((plan) => {
        const form = forms[plan.planKey];
        if (!form) return null;
        return (
          <View key={plan.planKey} style={[localStyles.card, getCardStyle(theme)]}>
            <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>
              Premium {plan.interval === 'month' ? 'Monthly' : 'Annual'}
            </Text>
            <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
              Active Price: {plan.activeStripePriceId ?? 'Not published'} ({plan.livemode ? 'live' : 'test'})
            </Text>
            {([
              ['unitAmountCents', 'Price in cents'],
              ['trialDays', 'Trial days'],
              ['pastDueGraceDays', 'Past-due grace days'],
            ] as const).map(([field, label]) => (
              <View key={field}>
                <Text style={[localStyles.fieldLabel, { color: theme.colors.textMuted }]}>{label}</Text>
                <TextInput
                  style={[localStyles.smallInput, getInputStyle(theme)]}
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
                <View key={field} style={[localStyles.row, { marginTop: 10 }]}>
                  <Text style={[localStyles.flex, { color: theme.colors.text }]}>{label}</Text>
                  <TouchableOpacity
                    style={[localStyles.smallButton, { backgroundColor: active ? theme.colors.success : theme.colors.alert }]}
                    onPress={() => update(plan.planKey, field, !active)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: active }}
                  >
                    <Text style={localStyles.smallButtonText}>{active ? 'On' : 'Off'}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            <TouchableOpacity
              style={[localStyles.smallButton, { backgroundColor: theme.colors.cta }, saving === plan.planKey && localStyles.buttonDisabled]}
              disabled={saving === plan.planKey}
              onPress={() => saveConfig(plan)}
              testID={`admin-billing-save-${plan.planKey}`}
            >
              <Text style={localStyles.smallButtonText}>{saving === plan.planKey ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
};

const AiOperationsSection: React.FC<{
  backendUrl: string;
  headers: Record<string, string>;
  initialAiOpsSection?: AiOpsSection;
  onAiOpsSectionChange?: (section: AiOpsSection) => void;
} & ThemedSectionProps> = ({
  backendUrl,
  headers,
  initialAiOpsSection = 'overview',
  onAiOpsSectionChange,
  theme,
}) => {
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

  useEffect(() => {
    setAiOpsSection(initialAiOpsSection);
  }, [initialAiOpsSection]);

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

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (featureKey: string) => {
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

  if (loading) return <Text style={[localStyles.loading, { color: theme.colors.textMuted }]}>Loading...</Text>;

  const aiOpsSections: Array<{ key: AiOpsSection; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'providers', label: 'Providers' },
    { key: 'experiments', label: 'Experiments' },
    { key: 'recommendations', label: 'Recommendations' },
    { key: 'captures', label: 'Captures' },
    { key: 'parser-quality', label: 'Parser Quality' },
    { key: 'shadow-replay', label: 'Shadow Replay' },
    { key: 'executive', label: 'Executive' },
    { key: 'runtime-settings', label: 'Runtime Settings' },
    { key: 'ai-audit-log', label: 'AI Audit Log' },
  ];

  return (
    <View style={localStyles.section}>
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>AI Operations</Text>
      {error ? <Text style={[localStyles.errorText, { color: theme.colors.error }]}>{error}</Text> : null}
      {saveMsg ? <Text style={[localStyles.saveMsg, { color: theme.colors.success }]}>{saveMsg}</Text> : null}
      <View style={localStyles.tierButtons}>
        {aiOpsSections.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={[
              localStyles.tierButton,
              aiOpsSection === item.key && localStyles.tierButtonActive,
              { borderColor: theme.colors.border },
            ]}
            onPress={() => goToAiOps(item.key)}
          >
            <Text style={[localStyles.tierButtonText, aiOpsSection === item.key && localStyles.tierButtonTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {aiOpsSection === 'overview' ? (
        <View style={[localStyles.card, getCardStyle(theme)]}>
          <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>AI Operations Overview</Text>
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            {providers.length} providers, {experiments.length} experiments, {recommendations.length} recommendations, {analytics.length} aggregate metrics.
          </Text>
        </View>
      ) : null}

      {aiOpsSection === 'providers' ? features.map((feature) => {
        const draft = drafts[feature.featureKey] ?? feature;
        const selectedProvider = providers.find((provider) => provider.id === draft.provider);
        const selectableProviders = providers.filter((provider) => provider.configured && provider.registered);
        return (
          <View key={feature.featureKey} style={[localStyles.card, getCardStyle(theme)]}>
            <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>{feature.featureKey}</Text>
            <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
              Last changed {feature.updatedAt ? new Date(feature.updatedAt).toLocaleString() : 'never'}
              {feature.updatedBy ? ` by ${feature.updatedBy}` : ''}
            </Text>
            <Text style={[localStyles.fieldLabel, { color: theme.colors.textMuted }]}>Provider</Text>
            <View style={localStyles.tierButtons}>
              {providers.map((provider) => {
                const unavailable = !provider.configured || !provider.registered;
                const active = draft.provider === provider.id;
                return (
                  <TouchableOpacity
                    key={provider.id}
                    disabled={unavailable}
                    style={[
                      localStyles.tierButton,
                      active && localStyles.tierButtonActive,
                      unavailable && localStyles.buttonDisabled,
                      { borderColor: theme.colors.border },
                    ]}
                    onPress={() => setDrafts((prev) => ({
                      ...prev,
                      [feature.featureKey]: {
                        ...draft,
                        provider: provider.id,
                        model: provider.supportedModels[0] ?? draft.model,
                      },
                    }))}
                  >
                    <Text style={[localStyles.tierButtonText, active && localStyles.tierButtonTextActive]}>
                      {provider.id}{provider.certified ? ' certified' : ''}{unavailable ? ' unavailable' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[localStyles.fieldLabel, { color: theme.colors.textMuted }]}>Model</Text>
            <TextInput
              style={[localStyles.input, getInputStyle(theme)]}
              value={draft.model}
              onChangeText={(model) => setDrafts((prev) => ({ ...prev, [feature.featureKey]: { ...draft, model } }))}
              editable={Boolean(selectedProvider?.configured && selectedProvider?.registered)}
            />
            <TouchableOpacity
              style={[localStyles.smallButton, { backgroundColor: draft.enabled ? theme.colors.success : theme.colors.alert }]}
              onPress={() => setDrafts((prev) => ({ ...prev, [feature.featureKey]: { ...draft, enabled: !draft.enabled } }))}
            >
              <Text style={localStyles.smallButtonText}>{draft.enabled ? 'Enabled' : 'Disabled'}</Text>
            </TouchableOpacity>
            <Text style={[localStyles.fieldLabel, { color: theme.colors.textMuted }]}>Reason</Text>
            <TextInput
              style={[localStyles.input, getInputStyle(theme)]}
              value={reasons[feature.featureKey] ?? ''}
              onChangeText={(value) => setReasons((prev) => ({ ...prev, [feature.featureKey]: value }))}
              placeholder="Reason for audit log"
              placeholderTextColor={theme.colors.textMuted}
            />
            <TouchableOpacity
              style={[
                localStyles.smallButton,
                { backgroundColor: theme.colors.cta },
                (saving === feature.featureKey || selectableProviders.length === 0) && localStyles.buttonDisabled,
              ]}
              disabled={saving === feature.featureKey || selectableProviders.length === 0}
              onPress={() => save(feature.featureKey)}
            >
              <Text style={localStyles.smallButtonText}>{saving === feature.featureKey ? 'Saving...' : 'Save config'}</Text>
            </TouchableOpacity>
          </View>
        );
      }) : null}

      {aiOpsSection === 'runtime-settings' ? (
      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Runtime Settings</Text>
        {runtimeSettings.map((setting) => (
          <View key={setting.key} style={localStyles.inlineField}>
            <View style={localStyles.inlineFieldLabel}>
              <Text style={[localStyles.fieldLabel, { color: theme.colors.textMuted }]}>{setting.key}</Text>
              <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
                {setting.updatedAt ? new Date(setting.updatedAt).toLocaleString() : 'default'}
              </Text>
            </View>
            <TextInput
              style={[localStyles.input, getInputStyle(theme), { flex: 1 }]}
              value={runtimeDrafts[setting.key] ?? setting.value}
              keyboardType="numeric"
              onChangeText={(value) => setRuntimeDrafts((prev) => ({ ...prev, [setting.key]: value }))}
            />
          </View>
        ))}
        <Text style={[localStyles.fieldLabel, { color: theme.colors.textMuted }]}>Reason</Text>
        <TextInput
          style={[localStyles.input, getInputStyle(theme)]}
          value={runtimeReason}
          onChangeText={setRuntimeReason}
          placeholder="Reason for audit log"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TouchableOpacity
          style={[localStyles.smallButton, { backgroundColor: theme.colors.cta }, saving === 'runtime-settings' && localStyles.buttonDisabled]}
          disabled={saving === 'runtime-settings'}
          onPress={saveRuntimeSettings}
        >
          <Text style={localStyles.smallButtonText}>{saving === 'runtime-settings' ? 'Saving...' : 'Save settings'}</Text>
        </TouchableOpacity>
      </View>
      ) : null}

      {aiOpsSection === 'captures' ? (
      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Capture Browser</Text>
        <View style={localStyles.inlineField}>
          <TextInput
            style={[localStyles.input, getInputStyle(theme), { flex: 1 }]}
            value={captureQuery}
            onChangeText={setCaptureQuery}
            placeholder="Capture ID"
            placeholderTextColor={theme.colors.textMuted}
          />
          <TextInput
            style={[localStyles.input, getInputStyle(theme), { flex: 1 }]}
            value={captureAnonymousUserIdQuery}
            onChangeText={setCaptureAnonymousUserIdQuery}
            placeholder="Anonymous user ID"
            placeholderTextColor={theme.colors.textMuted}
          />
          <TouchableOpacity
            style={[localStyles.smallButton, { backgroundColor: theme.colors.cta }, saving === 'capture-search' && localStyles.buttonDisabled]}
            disabled={saving === 'capture-search'}
            onPress={searchCaptures}
          >
            <Text style={localStyles.smallButtonText}>Search</Text>
          </TouchableOpacity>
        </View>
        {captures.map((capture) => (
          <View key={`${capture.captureId}-${capture.capturedAt}`} style={localStyles.compactRow}>
            <Text style={[localStyles.tableCellPrimary, { color: theme.colors.text }]}>{capture.captureId}</Text>
            <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
              {capture.featureKey} - {capture.outcome} - {capture.provider ?? 'unknown'} / {capture.model ?? 'unknown'} - {new Date(capture.capturedAt).toLocaleString()}
              {capture.anonymousUserId ? ` - user:${capture.anonymousUserId}` : ''}
            </Text>
          </View>
        ))}
      </View>
      ) : null}

      {aiOpsSection === 'parser-quality' || aiOpsSection === 'shadow-replay' ? (
      <View style={[localStyles.card, getCardStyle(theme)]}>
        <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Parser Evaluation</Text>
        {analytics.filter((metric) => metric.table === 'ai_parser_metrics' || metric.table === 'ai_field_metrics').slice(0, 8).map((metric, index) => (
          <Text key={`${metric.table}-${metric.metricKey}-${index}`} style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            {metric.table.replace('ai_', '').replace('_metrics', '')}: {metric.metricKey} = {metric.metricValue}
          </Text>
        ))}
        <Text style={[localStyles.cardTitle, { color: theme.colors.text, marginTop: 12 }]}>Shadow Comparison</Text>
        {analytics.filter((metric) => metric.table === 'ai_daily_metrics' || metric.table === 'ai_cost_metrics').slice(0, 8).map((metric, index) => (
          <Text key={`${metric.table}-${metric.metricKey}-${index}`} style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            {metric.dimensions.featureKey ?? metric.dimensions.provider ?? metric.table}: {metric.metricKey} = {metric.metricValue}
          </Text>
        ))}
        <TouchableOpacity
          style={[localStyles.smallButton, { backgroundColor: theme.colors.cta }, saving === 'analytics-refresh' && localStyles.buttonDisabled]}
          disabled={saving === 'analytics-refresh'}
          onPress={refreshAnalytics}
        >
          <Text style={localStyles.smallButtonText}>{saving === 'analytics-refresh' ? 'Refreshing...' : 'Refresh analytics'}</Text>
        </TouchableOpacity>
      </View>
      ) : null}

      {aiOpsSection === 'experiments' ? (
        <View style={[localStyles.card, getCardStyle(theme)]}>
          <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Experiments</Text>
          {experiments.length === 0 ? <Text style={[localStyles.emptyText, { color: theme.colors.textMuted }]}>No experiments running.</Text> : null}
          {experiments.map((experiment) => (
            <View key={experiment.experimentId} style={localStyles.compactRow}>
              <Text style={[localStyles.tableCellPrimary, { color: theme.colors.text }]}>{experiment.name}</Text>
              <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
                {experiment.featureKey} - {experiment.experimentKind} - {experiment.status} - {experiment.variants.length} variants
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {aiOpsSection === 'recommendations' ? (
        <View style={[localStyles.card, getCardStyle(theme)]}>
          <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Recommendations</Text>
          {recommendations.length === 0 ? <Text style={[localStyles.emptyText, { color: theme.colors.textMuted }]}>No recommendations proposed.</Text> : null}
          {recommendations.map((recommendation) => (
            <View key={recommendation.recommendationId} style={localStyles.compactRow}>
              <Text style={[localStyles.tableCellPrimary, { color: theme.colors.text }]}>{recommendation.recommendationType}</Text>
              <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
                {recommendation.featureKey} - {recommendation.status} - {recommendation.confidence}
              </Text>
              <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>{recommendation.rationale}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {aiOpsSection === 'executive' ? (
        <View style={[localStyles.card, getCardStyle(theme)]}>
          <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>Executive Dashboard</Text>
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            Estimated spend: ${Number(executiveSummary?.spend?.estimatedUsd ?? 0).toFixed(2)}
          </Text>
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            Captures: {Number(executiveSummary?.throughput?.captures ?? 0)}
          </Text>
          <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
            Average experiment quality: {Number(executiveSummary?.quality?.avgExperimentQuality ?? 0).toFixed(1)}
          </Text>
        </View>
      ) : null}

      {aiOpsSection === 'ai-audit-log' ? (
        <View style={[localStyles.card, getCardStyle(theme)]}>
          <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>AI Audit Log</Text>
          <Text style={[localStyles.emptyText, { color: theme.colors.textMuted }]}>Use the main Audit Log filtered to AI actions.</Text>
        </View>
      ) : null}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Main AdminTab
// ---------------------------------------------------------------------------

const AdminTab: React.FC<AdminTabProps> = ({
  backendUrl,
  headers,
  initialSection = 'overview',
  initialAiOpsSection = 'overview',
  onSectionChange,
  onAiOpsSectionChange,
}) => {
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
        return <PackingListTable backendUrl={backendUrl} headers={headers} variant="admin" title="Universal packing defaults" />;
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
        return <TiersSection backendUrl={backendUrl} headers={headers} onTiersLoaded={setLoadedTiers} />;
      case 'user-data':
        return <UserDataSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'audit-log':
        return <AuditLogSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'ingestion':
        return <IngestionSection backendUrl={backendUrl} headers={headers} theme={theme} />;
      case 'api-limits':
        return <ApiLimitsSection backendUrl={backendUrl} headers={headers} theme={theme} />;
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
    metrics: 'Metrics',
    billing: 'Billing',
  };

  return (
    <View style={[localStyles.content, { backgroundColor: theme.colors.background }]}>
      {section !== 'overview' ? (
        <View style={localStyles.breadcrumb}>
          <TouchableOpacity onPress={() => goTo('overview')}>
            <Text style={[localStyles.breadcrumbLink, { color: theme.colors.link }]}>Admin</Text>
          </TouchableOpacity>
          <Text style={[localStyles.breadcrumbSep, { color: theme.colors.textMuted }]}> / </Text>
          <Text style={[localStyles.breadcrumbCurrent, { color: theme.colors.text }]}>{sectionLabel[section]}</Text>
        </View>
      ) : null}
      <View style={localStyles.sectionHost}>
        {section === 'api-limits' ? (
          renderSection()
        ) : (
          <ScrollView style={localStyles.sectionScroll} contentContainerStyle={localStyles.sectionScrollContent}>
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

const localStyles = StyleSheet.create({
  content: { flex: 1, minHeight: 0, padding: 16, paddingBottom: 0, width: '100%' },
  section: { marginBottom: 24 },
  sectionHost: { flex: 1, minHeight: 0 },
  sectionScroll: { flex: 1, minHeight: 0 },
  sectionScrollContent: { paddingBottom: 40 },
  sectionTitle: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: '#1a1a2e' },
  loading: { color: '#888', marginVertical: 8 },
  errorText: { color: '#c0392b', marginVertical: 8 },
  emptyText: { color: '#888', fontStyle: 'italic' },
  saveMsg: { color: '#27ae60', marginTop: 8, fontWeight: '600' },
  // Cards
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a2e', marginBottom: 2 },
  cardSub: { fontSize: 13, color: '#555', marginTop: 2 },
  heroCard: {
    borderRadius: 24,
    borderWidth: 1,
    paddingVertical: 22,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  heroTitle: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  heroBody: { fontSize: 14, lineHeight: 20, maxWidth: 520 },
  // Nav cards
  navCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  navAccent: { width: 48, height: 6, borderRadius: 999, marginBottom: 14 },
  navCardTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  navCardDesc: { fontSize: 13, color: '#666' },
  // Layout
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  inlineField: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  inlineFieldLabel: { minWidth: 220, flex: 1 },
  compactRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  tableCellPrimary: { fontSize: 13, fontWeight: '700' },
  // Badges
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, marginLeft: 8 },
  badgeOn: { backgroundColor: '#27ae60' },
  badgeOff: { backgroundColor: '#e74c3c' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  // Tags
  tagRow: { flexDirection: 'row', gap: 4 },
  tagAdmin: { backgroundColor: '#8e44ad', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  tagTier: { backgroundColor: '#2980b9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  tagText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  // Forms
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    marginBottom: 10,
    backgroundColor: '#fafafa',
  },
  smallInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 8,
    fontSize: 13,
    marginTop: 6,
    backgroundColor: '#fafafa',
  },
  inlineForm: { marginTop: 8 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#888', marginTop: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  smallButton: {
    backgroundColor: '#2c3e50',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  smallButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  buttonDisabled: { opacity: 0.4 },
  dropdownButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  dropdownLocked: {
    justifyContent: 'center',
  },
  dropdownButtonText: { fontSize: 14, fontWeight: '600' },
  dropdownMenu: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },
  dropdownOption: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#999',
  },
  dropdownOptionText: { fontSize: 14, fontWeight: '500' },
  // Tier buttons
  tierButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  tierButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#f5f5f5',
  },
  tierButtonActive: { backgroundColor: '#2c3e50', borderColor: '#2c3e50' },
  tierButtonText: { fontSize: 13, color: '#333' },
  tierButtonTextActive: { color: '#fff' },
  // Limit rows
  limitRow: { marginBottom: 6 },
  editButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    backgroundColor: '#ecf0f1',
    marginLeft: 8,
  },
  editButtonText: { fontSize: 12, color: '#333' },
  tableShell: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  tableHeaderRow: { flexDirection: 'row', minHeight: 64, borderBottomWidth: 1 },
  tableHeaderCell: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRightWidth: 1,
  },
  tableBodyScroll: { maxHeight: 560 },
  tableDataRow: { flexDirection: 'row', minHeight: 76, borderBottomWidth: 1 },
  tableNameCell: {
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRightWidth: 1,
  },
  tableTierCell: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRightWidth: 1,
  },
  tableHeaderText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  tableNameText: { fontSize: 14, fontWeight: '600' },
  tableMetaText: { fontSize: 11, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  tableLinkButton: { paddingVertical: 8, paddingHorizontal: 12 },
  tableLinkText: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  toggleCellButton: {
    minWidth: 104,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleCellText: { fontSize: 13, fontWeight: '700' },
  toggleCellSubtext: { fontSize: 11, marginTop: 4, textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  modalBodyText: { fontSize: 14, marginBottom: 6 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 12,
  },
  modalTextArea: { minHeight: 96, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  modalSecondaryButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalSecondaryButtonText: { fontSize: 14, fontWeight: '600' },
  modalPrimaryButton: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  modalPrimaryButtonText: { fontSize: 14, fontWeight: '700' },
  // Pagination
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 12 },
  apiLimitsScroll: { flex: 1, minHeight: 0 },
  apiLimitsScrollContent: { paddingBottom: 32 },
  apiLimitCallerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  apiLimitInput: {
    minWidth: 110,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  pageButton: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    backgroundColor: '#2c3e50',
    borderRadius: 6,
  },
  pageButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  pageInfo: { fontSize: 13, color: '#555' },
  // Breadcrumb
  breadcrumb: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  breadcrumbLink: { color: '#2980b9', fontSize: 14 },
  breadcrumbSep: { color: '#aaa', fontSize: 14 },
  breadcrumbCurrent: { color: '#555', fontSize: 14 },
  // Back link
  backLink: { marginBottom: 12 },
  backLinkText: { color: '#2980b9', fontSize: 14 },
});
