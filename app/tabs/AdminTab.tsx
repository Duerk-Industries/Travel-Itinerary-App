import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminSection = 'overview' | 'users' | 'user-detail' | 'tiers' | 'features' | 'user-data' | 'audit-log';

type FeatureFlag = { key: string; enabled: boolean; description?: string | null };

type TierLimit = { limitKey: string; limitValue: number };
type TierEntitlement = { featureId: string; featureKey: string | null; isAllowed: boolean };
type Tier = {
  id: string;
  tierKey: string;
  displayName: string;
  rank: number;
  limits: TierLimit[];
  entitlements: TierEntitlement[];
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

type AdminUserDetail = AdminUser & {
  usage?: Array<{ metricKey: string; windowKey: string; count: number }>;
};

type UserDataRow = {
  id: string;
  email: string | null;
  role: string;
  tierKey: string | null;
  aiGenerations: number;
  tokens: number;
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// --- Overview ---
const OverviewSection: React.FC<{ onNav: (s: AdminSection) => void }> = ({ onNav }) => (
  <View style={localStyles.section}>
    <Text style={localStyles.sectionTitle}>Admin Panel</Text>
    {(
      [
        { label: 'Users', section: 'users' as AdminSection, desc: 'Search users, change tiers and roles' },
        { label: 'Tiers', section: 'tiers' as AdminSection, desc: 'View and edit tier limits and entitlements' },
        { label: 'Feature Flags', section: 'features' as AdminSection, desc: 'Enable or disable feature flags' },
        { label: 'User Data', section: 'user-data' as AdminSection, desc: 'Aggregate usage statistics' },
        { label: 'Audit Log', section: 'audit-log' as AdminSection, desc: 'History of admin actions' },
      ] as { label: string; section: AdminSection; desc: string }[]
    ).map((item) => (
      <TouchableOpacity key={item.section} style={localStyles.navCard} onPress={() => onNav(item.section)}>
        <Text style={localStyles.navCardTitle}>{item.label}</Text>
        <Text style={localStyles.navCardDesc}>{item.desc}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

// --- Feature Flags ---
const FeaturesSection: React.FC<{ backendUrl: string; headers: Record<string, string> }> = ({
  backendUrl,
  headers,
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

  if (loading) return <Text style={localStyles.loading}>Loading...</Text>;
  if (error) return <Text style={localStyles.errorText}>{error}</Text>;

  return (
    <View style={localStyles.section}>
      <Text style={localStyles.sectionTitle}>Feature Flags</Text>
      {flags.length === 0 && <Text style={localStyles.emptyText}>No feature flags found.</Text>}
      {flags.map((flag) => (
        <View key={flag.key} style={localStyles.card}>
          <View style={localStyles.row}>
            <View style={localStyles.flex}>
              <Text style={localStyles.cardTitle}>{flag.key}</Text>
              {flag.description ? <Text style={localStyles.cardSub}>{flag.description}</Text> : null}
            </View>
            <View style={[localStyles.badge, flag.enabled ? localStyles.badgeOn : localStyles.badgeOff]}>
              <Text style={localStyles.badgeText}>{flag.enabled ? 'ON' : 'OFF'}</Text>
            </View>
          </View>
          {reasonVisible[flag.key] || true ? (
            <View style={localStyles.inlineForm}>
              <TextInput
                style={localStyles.smallInput}
                placeholder="Reason (required)"
                value={reasonInputs[flag.key] ?? ''}
                onChangeText={(t) => setReasonInputs((r) => ({ ...r, [flag.key]: t }))}
              />
              <TouchableOpacity
                style={[localStyles.smallButton, pendingKey === flag.key && localStyles.buttonDisabled]}
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
}> = ({ backendUrl, headers, onViewUser }) => {
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
      <Text style={localStyles.sectionTitle}>Users</Text>
      <TextInput
        style={localStyles.input}
        placeholder="Search by email or name..."
        value={search}
        onChangeText={(t) => { setSearch(t); setPage(1); }}
      />
      {error ? <Text style={localStyles.errorText}>{error}</Text> : null}
      {loading ? <Text style={localStyles.loading}>Loading...</Text> : null}
      {!loading && users.length === 0 ? <Text style={localStyles.emptyText}>No users found.</Text> : null}
      {users.map((u) => (
        <TouchableOpacity key={u.id} style={localStyles.card} onPress={() => onViewUser(u)}>
          <View style={localStyles.row}>
            <View style={localStyles.flex}>
              <Text style={localStyles.cardTitle}>{u.email ?? u.id}</Text>
              {(u.firstName || u.lastName) ? (
                <Text style={localStyles.cardSub}>{[u.firstName, u.lastName].filter(Boolean).join(' ')}</Text>
              ) : null}
            </View>
            <View style={localStyles.tagRow}>
              {u.role === 'admin' ? <View style={localStyles.tagAdmin}><Text style={localStyles.tagText}>admin</Text></View> : null}
              {u.tierKey ? <View style={localStyles.tagTier}><Text style={localStyles.tagText}>{u.tierKey}</Text></View> : null}
            </View>
          </View>
        </TouchableOpacity>
      ))}
      {totalPages > 1 ? (
        <View style={localStyles.pagination}>
          <TouchableOpacity
            style={[localStyles.pageButton, page === 1 && localStyles.buttonDisabled]}
            disabled={page === 1}
            onPress={() => setPage((p) => p - 1)}
          >
            <Text style={localStyles.pageButtonText}>Prev</Text>
          </TouchableOpacity>
          <Text style={localStyles.pageInfo}>{page} / {totalPages}</Text>
          <TouchableOpacity
            style={[localStyles.pageButton, page === totalPages && localStyles.buttonDisabled]}
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
}> = ({ backendUrl, headers, userId, tiers, onBack }) => {
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tierKey, setTierKey] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [tierReason, setTierReason] = useState('');
  const [roleReason, setRoleReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(backendUrl, headers, `/users/${userId}`);
      setUser(data);
      setTierKey(data.tierKey ?? '');
      setRole(data.role === 'admin' ? 'admin' : 'user');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [backendUrl, headers, userId]);

  useEffect(() => { load(); }, [load]);

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

  if (loading) return <Text style={localStyles.loading}>Loading...</Text>;
  if (error) return <Text style={localStyles.errorText}>{error}</Text>;
  if (!user) return null;

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.id;

  return (
    <View style={localStyles.section}>
      <TouchableOpacity onPress={onBack} style={localStyles.backLink}>
        <Text style={localStyles.backLinkText}>Back to Users</Text>
      </TouchableOpacity>
      <Text style={localStyles.sectionTitle}>{displayName}</Text>
      <Text style={localStyles.cardSub}>{user.email}</Text>

      <View style={localStyles.card}>
        <Text style={localStyles.cardTitle}>Current Tier: {user.tierKey ?? 'none'}</Text>
        <Text style={localStyles.fieldLabel}>Change Tier</Text>
        <View style={localStyles.tierButtons}>
          {tiers.map((t) => (
            <TouchableOpacity
              key={t.tierKey}
              style={[localStyles.tierButton, tierKey === t.tierKey && localStyles.tierButtonActive]}
              onPress={() => setTierKey(t.tierKey)}
            >
              <Text style={[localStyles.tierButtonText, tierKey === t.tierKey && localStyles.tierButtonTextActive]}>
                {t.displayName}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={localStyles.smallInput}
          placeholder="Reason (required)"
          value={tierReason}
          onChangeText={setTierReason}
        />
        <TouchableOpacity
          style={[localStyles.smallButton, saving && localStyles.buttonDisabled]}
          disabled={saving}
          onPress={saveTier}
        >
          <Text style={localStyles.smallButtonText}>Save Tier</Text>
        </TouchableOpacity>
      </View>

      <View style={localStyles.card}>
        <Text style={localStyles.cardTitle}>Current Role: {user.role}</Text>
        <Text style={localStyles.fieldLabel}>Change Role</Text>
        <View style={localStyles.tierButtons}>
          {(['user', 'admin'] as const).map((r) => (
            <TouchableOpacity
              key={r}
              style={[localStyles.tierButton, role === r && localStyles.tierButtonActive]}
              onPress={() => setRole(r)}
            >
              <Text style={[localStyles.tierButtonText, role === r && localStyles.tierButtonTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={localStyles.smallInput}
          placeholder="Reason (required)"
          value={roleReason}
          onChangeText={setRoleReason}
        />
        <TouchableOpacity
          style={[localStyles.smallButton, saving && localStyles.buttonDisabled]}
          disabled={saving}
          onPress={saveRole}
        >
          <Text style={localStyles.smallButtonText}>Save Role</Text>
        </TouchableOpacity>
      </View>

      {saveMsg ? <Text style={localStyles.saveMsg}>{saveMsg}</Text> : null}

      {user.usage && user.usage.length > 0 ? (
        <View style={localStyles.card}>
          <Text style={localStyles.cardTitle}>Usage</Text>
          {user.usage.map((c, i) => (
            <View key={i} style={localStyles.row}>
              <Text style={localStyles.flex}>{c.metricKey} ({c.windowKey})</Text>
              <Text style={localStyles.cardSub}>{c.count}</Text>
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

  const saveLimit = async (tierKey: string, limitKey: string, isAllowed?: boolean) => {
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
      setEditingLimit(null);
      setLimitValue('');
      setLimitReason('');
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
      setEditingEntitlement(null);
      setEntitlementReason('');
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
      <Text style={localStyles.sectionTitle}>Tiers</Text>
      {saveMsg ? <Text style={localStyles.saveMsg}>{saveMsg}</Text> : null}
      {tiers.map((tier) => (
        <View key={tier.tierKey} style={localStyles.card}>
          <Text style={localStyles.cardTitle}>{tier.displayName}</Text>
          <Text style={localStyles.cardSub}>Key: {tier.tierKey} | Rank: {tier.rank}</Text>

          {tier.limits.length > 0 ? (
            <>
              <Text style={localStyles.fieldLabel}>Limits</Text>
              {tier.limits.map((limit) => {
                const isEditing = editingLimit?.tierKey === tier.tierKey && editingLimit?.limitKey === limit.limitKey;
                return (
                  <View key={limit.limitKey} style={localStyles.limitRow}>
                    <View style={localStyles.flex}>
                      <Text style={localStyles.cardSub}>{limit.limitKey}: {limit.limitValue === -1 ? 'unlimited' : limit.limitValue}</Text>
                    </View>
                    <TouchableOpacity
                      style={localStyles.editButton}
                      onPress={() => {
                        setEditingLimit(isEditing ? null : { tierKey: tier.tierKey, limitKey: limit.limitKey });
                        setLimitValue(String(limit.limitValue));
                        setLimitReason('');
                        setSaveMsg(null);
                      }}
                    >
                      <Text style={localStyles.editButtonText}>{isEditing ? 'Cancel' : 'Edit'}</Text>
                    </TouchableOpacity>
                    {isEditing ? (
                      <View style={localStyles.inlineForm}>
                        <TextInput
                          style={localStyles.smallInput}
                          placeholder="Value (-1 = unlimited)"
                          keyboardType="numeric"
                          value={limitValue}
                          onChangeText={setLimitValue}
                        />
                        <TextInput
                          style={localStyles.smallInput}
                          placeholder="Reason (required)"
                          value={limitReason}
                          onChangeText={setLimitReason}
                        />
                        <TouchableOpacity
                          style={[localStyles.smallButton, saving && localStyles.buttonDisabled]}
                          disabled={saving}
                          onPress={() => saveLimit(tier.tierKey, limit.limitKey)}
                        >
                          <Text style={localStyles.smallButtonText}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : null}

          {tier.entitlements.length > 0 ? (
            <>
              <Text style={localStyles.fieldLabel}>Features</Text>
              {tier.entitlements.filter((e) => e.featureKey).map((ent) => {
                const isEditing =
                  editingEntitlement?.tierKey === tier.tierKey && editingEntitlement?.featureKey === ent.featureKey;
                return (
                  <View key={ent.featureKey} style={localStyles.limitRow}>
                    <View style={localStyles.flex}>
                      <Text style={localStyles.cardSub}>{ent.featureKey}</Text>
                    </View>
                    <View style={[localStyles.badge, ent.isAllowed ? localStyles.badgeOn : localStyles.badgeOff]}>
                      <Text style={localStyles.badgeText}>{ent.isAllowed ? 'yes' : 'no'}</Text>
                    </View>
                    <TouchableOpacity
                      style={localStyles.editButton}
                      onPress={() => {
                        setEditingEntitlement(
                          isEditing ? null : { tierKey: tier.tierKey, featureKey: ent.featureKey! }
                        );
                        setEntitlementReason('');
                        setSaveMsg(null);
                      }}
                    >
                      <Text style={localStyles.editButtonText}>{isEditing ? 'Cancel' : 'Toggle'}</Text>
                    </TouchableOpacity>
                    {isEditing ? (
                      <View style={localStyles.inlineForm}>
                        <TextInput
                          style={localStyles.smallInput}
                          placeholder="Reason (required)"
                          value={entitlementReason}
                          onChangeText={setEntitlementReason}
                        />
                        <TouchableOpacity
                          style={[localStyles.smallButton, saving && localStyles.buttonDisabled]}
                          disabled={saving}
                          onPress={() => saveEntitlement(tier.tierKey, ent.featureKey!, !ent.isAllowed)}
                        >
                          <Text style={localStyles.smallButtonText}>Set {ent.isAllowed ? 'Disabled' : 'Enabled'}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : null}
        </View>
      ))}
    </View>
  );
};

// --- User Data ---
const UserDataSection: React.FC<{ backendUrl: string; headers: Record<string, string> }> = ({
  backendUrl,
  headers,
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
      <Text style={localStyles.sectionTitle}>User Data</Text>
      <View style={localStyles.tierButtons}>
        {(['7d', '30d', 'all-time'] as const).map((w) => (
          <TouchableOpacity
            key={w}
            style={[localStyles.tierButton, window === w && localStyles.tierButtonActive]}
            onPress={() => { setWindow(w); setPage(1); }}
          >
            <Text style={[localStyles.tierButtonText, window === w && localStyles.tierButtonTextActive]}>{w}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={localStyles.errorText}>{error}</Text> : null}
      {loading ? <Text style={localStyles.loading}>Loading...</Text> : null}
      {!loading && rows.length === 0 ? <Text style={localStyles.emptyText}>No data.</Text> : null}
      {rows.map((row) => (
        <View key={row.id} style={localStyles.card}>
          <Text style={localStyles.cardTitle}>{row.email ?? row.id}</Text>
          <View style={localStyles.tagRow}>
            {row.role === 'admin' ? <View style={localStyles.tagAdmin}><Text style={localStyles.tagText}>admin</Text></View> : null}
            {row.tierKey ? <View style={localStyles.tagTier}><Text style={localStyles.tagText}>{row.tierKey}</Text></View> : null}
          </View>
          <Text style={localStyles.cardSub}>AI generations: {row.aiGenerations}</Text>
          <Text style={localStyles.cardSub}>Tokens: {row.tokens}</Text>
        </View>
      ))}
      {totalPages > 1 ? (
        <View style={localStyles.pagination}>
          <TouchableOpacity
            style={[localStyles.pageButton, page === 1 && localStyles.buttonDisabled]}
            disabled={page === 1}
            onPress={() => setPage((p) => p - 1)}
          >
            <Text style={localStyles.pageButtonText}>Prev</Text>
          </TouchableOpacity>
          <Text style={localStyles.pageInfo}>{page} / {totalPages}</Text>
          <TouchableOpacity
            style={[localStyles.pageButton, page === totalPages && localStyles.buttonDisabled]}
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
const AuditLogSection: React.FC<{ backendUrl: string; headers: Record<string, string> }> = ({
  backendUrl,
  headers,
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
      <Text style={localStyles.sectionTitle}>Audit Log</Text>
      {error ? <Text style={localStyles.errorText}>{error}</Text> : null}
      {loading ? <Text style={localStyles.loading}>Loading...</Text> : null}
      {!loading && entries.length === 0 ? <Text style={localStyles.emptyText}>No audit entries.</Text> : null}
      {entries.map((entry) => (
        <View key={entry.id} style={localStyles.card}>
          <View style={localStyles.row}>
            <Text style={[localStyles.cardTitle, localStyles.flex]}>{entry.action}</Text>
            <Text style={localStyles.cardSub}>{fmt(entry.createdAt)}</Text>
          </View>
          {entry.reason ? <Text style={localStyles.cardSub}>Reason: {entry.reason}</Text> : null}
          {entry.actorUserId ? <Text style={localStyles.cardSub}>Actor: {entry.actorUserId}</Text> : null}
          {entry.targetUserId ? <Text style={localStyles.cardSub}>Target: {entry.targetUserId}</Text> : null}
        </View>
      ))}
      {totalPages > 1 ? (
        <View style={localStyles.pagination}>
          <TouchableOpacity
            style={[localStyles.pageButton, page === 1 && localStyles.buttonDisabled]}
            disabled={page === 1}
            onPress={() => setPage((p) => p - 1)}
          >
            <Text style={localStyles.pageButtonText}>Prev</Text>
          </TouchableOpacity>
          <Text style={localStyles.pageInfo}>{page} / {totalPages}</Text>
          <TouchableOpacity
            style={[localStyles.pageButton, page === totalPages && localStyles.buttonDisabled]}
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

// ---------------------------------------------------------------------------
// Main AdminTab
// ---------------------------------------------------------------------------

const AdminTab: React.FC<AdminTabProps> = ({ backendUrl, headers }) => {
  const [section, setSection] = useState<AdminSection>('overview');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [loadedTiers, setLoadedTiers] = useState<Tier[]>([]);

  const goTo = (s: AdminSection) => setSection(s);

  const handleViewUser = (user: AdminUser) => {
    setSelectedUser(user);
    setSection('user-detail');
  };

  const renderSection = () => {
    switch (section) {
      case 'overview':
        return <OverviewSection onNav={goTo} />;
      case 'features':
        return <FeaturesSection backendUrl={backendUrl} headers={headers} />;
      case 'users':
        return <UsersSection backendUrl={backendUrl} headers={headers} onViewUser={handleViewUser} />;
      case 'user-detail':
        return selectedUser ? (
          <UserDetailSection
            backendUrl={backendUrl}
            headers={headers}
            userId={selectedUser.id}
            tiers={loadedTiers}
            onBack={() => setSection('users')}
          />
        ) : null;
      case 'tiers':
        return <TiersSection backendUrl={backendUrl} headers={headers} onTiersLoaded={setLoadedTiers} />;
      case 'user-data':
        return <UserDataSection backendUrl={backendUrl} headers={headers} />;
      case 'audit-log':
        return <AuditLogSection backendUrl={backendUrl} headers={headers} />;
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
  };

  return (
    <ScrollView style={localStyles.container} contentContainerStyle={localStyles.content}>
      {section !== 'overview' ? (
        <View style={localStyles.breadcrumb}>
          <TouchableOpacity onPress={() => goTo('overview')}>
            <Text style={localStyles.breadcrumbLink}>Admin</Text>
          </TouchableOpacity>
          <Text style={localStyles.breadcrumbSep}> / </Text>
          <Text style={localStyles.breadcrumbCurrent}>{sectionLabel[section]}</Text>
        </View>
      ) : null}
      {renderSection()}
    </ScrollView>
  );
};

export default AdminTab;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const localStyles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: '#1a1a2e' },
  loading: { color: '#888', marginVertical: 8 },
  errorText: { color: '#c0392b', marginVertical: 8 },
  emptyText: { color: '#888', fontStyle: 'italic' },
  saveMsg: { color: '#27ae60', marginTop: 8, fontWeight: '600' },
  // Cards
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a2e', marginBottom: 2 },
  cardSub: { fontSize: 13, color: '#555', marginTop: 2 },
  // Nav cards
  navCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
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
