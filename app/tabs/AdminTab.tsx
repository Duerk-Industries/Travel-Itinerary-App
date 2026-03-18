import React, { useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useColorScheme } from 'react-native';
import { getAppTheme, type AppTheme } from '../theme/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminSection = 'overview' | 'users' | 'user-detail' | 'tiers' | 'features' | 'user-data' | 'audit-log' | 'ingestion';

type FeatureFlag = { key: string; enabled: boolean; description?: string | null };

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type AdminTabProps = {
  backendUrl: string;
  headers: Record<string, string>;
  initialSection?: AdminSection;
  onSectionChange?: (section: AdminSection) => void;
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
        { label: 'User Data', section: 'user-data' as AdminSection, desc: 'Aggregate usage statistics' },
        { label: 'Audit Log', section: 'audit-log' as AdminSection, desc: 'History of admin actions' },
        { label: 'Ingestion Ops', section: 'ingestion' as AdminSection, desc: 'Review import throughput, duplicates, and cost' },
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
  onViewUser: (user: AdminUser) => void;
} & ThemedSectionProps> = ({ backendUrl, headers, onViewUser, theme }) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const totalPages = Math.max(1, Math.ceil(total / limit));

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
      {users.map((u) => (
        <TouchableOpacity key={u.id} style={[localStyles.card, getCardStyle(theme)]} onPress={() => onViewUser(u)}>
          <View style={localStyles.row}>
            <View style={localStyles.flex}>
              <Text style={[localStyles.cardTitle, { color: theme.colors.text }]}>{u.email ?? u.id}</Text>
              {(u.firstName || u.lastName) ? (
                <Text style={[localStyles.cardSub, { color: theme.colors.textMuted }]}>
                  {[u.firstName, u.lastName].filter(Boolean).join(' ')}
                </Text>
              ) : null}
            </View>
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
        </TouchableOpacity>
      ))}
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
              <TouchableOpacity
                key={tier.key}
                testID={`user-tier-option-${tier.key}`}
                style={[localStyles.dropdownOption, tierKey === tier.key && { backgroundColor: theme.colors.backgroundAlt }]}
                onPress={() => {
                  setTierKey(tier.key);
                  setTierDropdownOpen(false);
                }}
              >
                <Text style={[localStyles.dropdownOptionText, { color: theme.colors.text }]}>
                  {tier.displayName}
                </Text>
              </TouchableOpacity>
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

  if (loading) return <Text style={localStyles.loading}>Loading...</Text>;
  if (error) return <Text style={localStyles.errorText}>{error}</Text>;

  return (
    <View style={localStyles.section}>
      <Text style={[localStyles.sectionTitle, { color: theme.colors.text }]}>Tiers</Text>
      {saveMsg ? <Text style={[localStyles.saveMsg, { color: theme.colors.success }]}>{saveMsg}</Text> : null}
      {tiers.length === 0 ? <Text style={localStyles.emptyText}>No tiers found.</Text> : null}
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
          <ScrollView horizontal showsHorizontalScrollIndicator>
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
          </ScrollView>
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

// --- User Data ---
const UserDataSection: React.FC<{ backendUrl: string; headers: Record<string, string> } & ThemedSectionProps> = ({
  backendUrl,
  headers,
  theme,
}) => {
  const [rows, setRows] = useState<UserDataRow[]>([]);
  const [total, setTotal] = useState(0);
  const [window, setWindow] = useState<'7d' | '30d' | 'all-time'>('30d');
  const [page, setPage] = useState(1);
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
          onChangeText={(value) => setRetryForm((current) => ({ ...current, maxAttempts: value }))}
          placeholder="Max attempts"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TextInput
          style={[localStyles.smallInput, getInputStyle(theme)]}
          value={retryForm.baseDelaySeconds}
          onChangeText={(value) => setRetryForm((current) => ({ ...current, baseDelaySeconds: value }))}
          placeholder="Base delay seconds"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TextInput
          style={[localStyles.smallInput, getInputStyle(theme)]}
          value={retryForm.maxDelaySeconds}
          onChangeText={(value) => setRetryForm((current) => ({ ...current, maxDelaySeconds: value }))}
          placeholder="Max delay seconds"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TextInput
          style={[localStyles.smallInput, getInputStyle(theme)]}
          value={retryForm.alertThresholdPercent}
          onChangeText={(value) => setRetryForm((current) => ({ ...current, alertThresholdPercent: value }))}
          placeholder="Alert threshold percent"
          placeholderTextColor={theme.colors.textMuted}
        />
        <TouchableOpacity style={[localStyles.smallButton, { backgroundColor: theme.colors.cta }]} onPress={saveRetryConfig}>
          <Text style={localStyles.smallButtonText}>Save Retry Policy</Text>
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
// Main AdminTab
// ---------------------------------------------------------------------------

const AdminTab: React.FC<AdminTabProps> = ({ backendUrl, headers, initialSection = 'overview', onSectionChange }) => {
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
      case 'users':
        return <UsersSection backendUrl={backendUrl} headers={headers} onViewUser={handleViewUser} theme={theme} />;
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
    'user-data': 'User Data',
    'audit-log': 'Audit Log',
    ingestion: 'Ingestion Ops',
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
      {renderSection()}
    </View>
  );
};

export default AdminTab;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const localStyles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, width: '100%' },
  section: { marginBottom: 24 },
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
