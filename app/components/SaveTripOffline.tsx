import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import type { Trip } from '../../server/src/types';
import { downloadOfflineTripSnapshot } from '../utils/downloadOfflineTripSnapshot';
import { loadOfflineTripCache, saveOfflineTripSnapshot, startOfflineAccessPeriod, type OfflineCacheOwner } from '../utils/offlineTripCache';

export default function SaveTripOffline({ trip, trips, groups, owner, token, costTrackingAllowed, disabled }: {
  trip: Pick<Trip, 'id' | 'groupId'>; trips: unknown[]; groups: unknown[];
  owner: OfflineCacheOwner; token: string; costTrackingAllowed: boolean; disabled?: boolean;
}) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const epoch = useRef(0), inFlight = useRef(false);
  useEffect(() => {
    epoch.current += 1; setNotice(null); setConfirm(false); setBusy(false); inFlight.current = false;
    return () => { epoch.current += 1; };
  }, [owner.userId, owner.environment, trip.id, token]);
  const save = async () => {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setConfirm(false); setNotice('Downloading trip details…');
    const current = epoch.current;
    try {
      const previous = await loadOfflineTripCache(owner);
      const snapshot = await downloadOfflineTripSnapshot({ trip, backendUrl: owner.environment, token, costTrackingAllowed, useBundle: true, previous: previous?.snapshots[trip.id] });
      if (current !== epoch.current) return;
      // Extend access only after the server has authorized a complete download.
      await startOfflineAccessPeriod(owner);
      if (current !== epoch.current) return;
      await saveOfflineTripSnapshot(owner, snapshot, { trips, groups });
      if (current === epoch.current) {
        const serialized = JSON.stringify(snapshot);
        // Hermes builds without TextEncoder still report a conservative bound.
        const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).byteLength : serialized.length * 4;
        setNotice(`Saved up to ${Math.ceil(bytes / 1024)} KB · ${new Date().toLocaleString()}. Trip details are available offline; base maps need a connection.`);
      }
    } catch {
      if (current === epoch.current) setNotice('Could not save this trip. Your previous saved copy is still available. Check your connection and device storage, then try again.');
    } finally { if (current === epoch.current) { inFlight.current = false; setBusy(false); } }
  };
  return <View style={{ padding: 8, gap: 4 }}>
    <TouchableOpacity accessibilityRole="button" disabled={busy || disabled} accessibilityState={{ disabled: busy || disabled, busy }}
      style={{ minHeight: 44, padding: 8 }} onPress={() => Platform.OS === 'web' ? setConfirm(true) : void save()}>
      <Text>{busy ? 'Saving offline copy…' : 'Save this trip offline'}</Text>
    </TouchableOpacity>
    {confirm && <View>
      <Text>This browser will keep private trip details on this device. Avoid saving on shared devices. Browser storage is not encrypted by WanderBunnies. Signing out removes saved trip copies.</Text>
      <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, padding: 8 }} onPress={() => void save()}><Text>Save on this device</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, padding: 8 }} onPress={() => setConfirm(false)}><Text>Cancel offline save</Text></TouchableOpacity>
    </View>}
    {notice && <Text accessibilityLiveRegion="polite">{notice}</Text>}
  </View>;
}
