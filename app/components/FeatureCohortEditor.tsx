import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { AppTheme } from '../theme/theme';

export default function FeatureCohortEditor({ featureKey, backendUrl, headers, theme }: {
  featureKey: string; backendUrl: string; headers: Record<string, string>; theme: AppTheme;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [userIds, setUserIds] = useState(''), [owner, setOwner] = useState('');
  const [retireAfter, setRetireAfter] = useState(new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10));
  const [reason, setReason] = useState(''), [notice, setNotice] = useState<string | null>(null);
  const epoch = useRef(0), lock = useRef(false);
  useEffect(() => {
    epoch.current += 1; lock.current = false; setBusy(false); setOpen(false); setNotice(null);
    return () => { epoch.current += 1; };
  }, [featureKey, backendUrl, headers.Authorization]);
  const endpoint = `${backendUrl}/api/admin/features/${encodeURIComponent(featureKey)}/cohort`;
  const load = async () => {
    if (lock.current) return; lock.current = true; setBusy(true);
    const current = epoch.current;
    try {
      const response = await fetch(endpoint, { headers }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Cohort settings could not load.');
      if (current !== epoch.current) return;
      setUserIds(data.cohort?.userIds?.join('\n') || ''); setOwner(data.cohort?.owner || '');
      if (data.cohort?.retireAfter) setRetireAfter(data.cohort.retireAfter.slice(0, 10));
      setNotice(data.cohort ? 'Cohort restriction is active. Global off still blocks everyone.' : 'No cohort restriction. The global flag controls access.');
      setOpen(true);
    } catch (error) { if (current === epoch.current) setNotice((error as Error).message); }
    finally { lock.current = false; if (current === epoch.current) setBusy(false); }
  };
  const save = async (remove = false) => {
    if (lock.current) return;
    if (reason.trim().length < 3) { setNotice('Enter a reason of at least three characters.'); return; }
    const ids = [...new Set(userIds.split(/[\s,]+/).filter(Boolean))];
    if (!remove && (!owner.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(retireAfter))) { setNotice('Enter the rollout owner and retirement date.'); return; }
    lock.current = true; setBusy(true); const current = epoch.current;
    try {
      const cohort = remove ? null : { userIds: ids, owner: owner.trim(), retireAfter: `${retireAfter}T23:59:59.000Z` };
      const response = await fetch(endpoint, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ cohort, reason: reason.trim() }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Cohort could not be saved.');
      if (current !== epoch.current) return;
      setNotice(remove ? 'Cohort restriction removed. The global flag still applies.' : 'Cohort saved. Other server instances refresh within 60 seconds.'); setReason('');
    } catch (error) { if (current === epoch.current) setNotice((error as Error).message); }
    finally { lock.current = false; if (current === epoch.current) setBusy(false); }
  };
  const text = { color: theme.colors.text }, input = { color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.textMuted, minHeight: 44, padding: 8 };
  const button = (label: string, action: () => void) => <TouchableOpacity disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} style={{ minHeight: 44, padding: 8 }} onPress={action}><Text style={{ color: theme.colors.link }}>{label}</Text></TouchableOpacity>;
  return <View>
    {button(open ? 'Refresh cohort settings' : 'Manage rollout cohort', () => void load())}
    {open && <View style={{ gap: 8 }}>
      <Text style={text}>Only listed user IDs qualify while the global flag is on. An empty list blocks everyone. Expired cohorts deny access until reviewed or removed.</Text>
      <TextInput style={input} placeholderTextColor={theme.colors.textMuted} accessibilityLabel="Cohort user IDs" multiline value={userIds} onChangeText={setUserIds} placeholder="User UUIDs, one per line" />
      <TextInput style={input} placeholderTextColor={theme.colors.textMuted} accessibilityLabel="Cohort owner" value={owner} onChangeText={setOwner} placeholder="Rollout owner" />
      <TextInput style={input} placeholderTextColor={theme.colors.textMuted} accessibilityLabel="Cohort retirement date" value={retireAfter} onChangeText={setRetireAfter} placeholder="YYYY-MM-DD" />
      <TextInput style={input} placeholderTextColor={theme.colors.textMuted} accessibilityLabel="Cohort change reason" value={reason} onChangeText={setReason} placeholder="Reason for audit log" />
      {button('Save restricted cohort', () => void save())}
      <Text style={text}>Removing the restriction makes everyone eligible when the global flag is on.</Text>
      {button('Remove cohort restriction', () => void save(true))}
      {button('Close cohort settings', () => setOpen(false))}
    </View>}
    {notice && <Text style={text} accessibilityLiveRegion="polite">{notice}</Text>}
  </View>;
}
