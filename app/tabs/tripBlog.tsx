// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { createCheckoutSession, fetchBillingPlans, openBillingUrl, type PlanInfo } from '../utils/billing';
import { createIdempotencyKey } from '../utils/idempotencyKey';

const TripBlogTab = ({ backendUrl, headers, activeTripId, styles, theme, readOnly = false }) => {
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [limit, setLimit] = useState(7);
  const [cursor, setCursor] = useState(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [storagePlans, setStoragePlans] = useState<PlanInfo[]>([]);
  const [addingDay, setAddingDay] = useState(null);
  const [newBody, setNewBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const textColor = theme?.colors?.text ?? styles.sectionTitle?.color ?? '#111827';
  const mutedColor = theme?.colors?.textMuted ?? '#6b7280';
  const surfaceColor = theme?.colors?.surface ?? '#ffffff';
  const inputColor = theme?.colors?.input ?? surfaceColor;
  const borderColor = theme?.colors?.border ?? '#ccd4df';

  const load = async (nextCursor = null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (nextCursor) params.set('cursor', nextCursor);
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog?${params.toString()}`, { headers });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to load the trip blog');
      const data = await response.json();
      const days = Array.isArray(data.days) ? data.days : [];
      setBlog((current) => {
        if (!nextCursor || !current) return data;
        return { ...data, days: [...current.days, ...days] };
      });
      const lastDay = days[days.length - 1];
      setCursor(days.length >= limit && lastDay ? lastDay.localDate : null);
    } catch (error) {
      Alert.alert('Trip blog', error.message || 'Unable to load the trip blog');
    } finally {
      setLoading(false);
    }
  };

  // Web-only for now: opens the OS file picker via a throwaway DOM <input type="file">, since
  // there's no cross-platform picker dependency (e.g. expo-image-picker) in this app yet. Native
  // (iOS/Android) photo upload needs that dependency added separately — see the Alert below.
  const pickWebImageFile = () => new Promise((resolve) => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') { resolve(null); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png';
    input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
    input.click();
  });

  const handleUpload = async (dayDate) => {
    if (readOnly) return;
    if (Platform.OS !== 'web') {
      Alert.alert('Photo upload', 'Photo upload from the mobile app isn’t available yet — use the web app for now.');
      return;
    }
    const file = await pickWebImageFile();
    if (!file) return; // user cancelled the picker
    const mimeType = file.type || 'image/jpeg';
    if (!['image/jpeg', 'image/png'].includes(mimeType)) {
      Alert.alert('Photo upload', 'Only JPEG or PNG photos are supported.');
      return;
    }
    setUploading(true);
    try {
      const idempotencyKey = createIdempotencyKey('up');
      const initRes = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/media/upload-init`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ dayDate, mediaKind: 'photo', mimeType, byteSize: file.size }),
      });

      if (initRes.status === 413) {
        const plans = await fetchBillingPlans(backendUrl, headers.Authorization?.replace('Bearer ', ''));
        setStoragePlans(plans.filter(p => p.planKey.startsWith('storage_')));
        setShowQuotaModal(true);
        return;
      }

      if (!initRes.ok) throw new Error((await initRes.json().catch(() => ({}))).error || 'Upload failed');
      const { asset, uploadUrl } = await initRes.json();

      if (uploadUrl) {
        // Real signed URL: upload the actual selected file's bytes directly to storage.
        const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: file });
        if (!putRes.ok) throw new Error('Failed to upload the photo to storage');
      }

      const completeRes = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/media/${asset.id}/complete`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ physicalBytes: file.size }),
      });
      if (!completeRes.ok) throw new Error((await completeRes.json().catch(() => ({}))).error || 'Failed to finalize upload');

      await load();
    } catch (error) {
      Alert.alert('Upload', error.message || 'Unable to upload');
    } finally {
      setUploading(false);
    }
  };

  const purchaseStorage = async (planKey) => {
    try {
      const token = headers.Authorization?.replace('Bearer ', '');
      const result = await createCheckoutSession(backendUrl, token, planKey, createIdempotencyKey('st'));
      if (result && 'url' in result) {
        await openBillingUrl(result.url);
        setShowQuotaModal(false);
      } else {
        throw new Error('Unable to start checkout');
      }
    } catch (error) {
      Alert.alert('Purchase', error.message || 'Failed to start purchase');
    }
  };

  useEffect(() => {
    setDrafts({});
    setCursor(null);
    void load();
  }, [activeTripId]);

  const loadMore = () => {
    if (cursor && !loading) {
      void load(cursor);
    }
  };

  const save = async (item) => {
    setSaving(true);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items/${item.id}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', 'If-Match': String(item.version) },
        body: JSON.stringify({ body: drafts[item.id] ?? '', version: item.version }),
      });
      if (response.status === 409) throw new Error('Someone else edited this block. Reload to resolve the conflict.');
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to save');
      await load();
    } catch (error) { Alert.alert('Trip blog', error.message || 'Unable to save'); }
    finally { setSaving(false); }
  };

  const createTextItem = async (dayDate) => {
    const body = newBody.trim();
    if (!body) return;
    setCreating(true);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kindKey: 'core.text', dayDate, body }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to add blog item');
      setNewBody('');
      setAddingDay(null);
      await load();
    } catch (error) { Alert.alert('Trip blog', error.message || 'Unable to add blog item'); }
    finally { setCreating(false); }
  };

  const deleteItem = async (item) => {
    if (readOnly) return;
    setDeleting(true);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items/${item.id}`, {
        method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ version: item.version }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to remove blog item');
      await load();
    } catch (error) { Alert.alert('Trip blog', error.message || 'Unable to remove blog item'); }
    finally { setDeleting(false); }
  };

  if (!activeTripId) return <View style={styles.card}><Text style={styles.sectionTitle}>Select a trip to write its blog.</Text></View>;
  if (loading) return <View style={styles.card}><ActivityIndicator /></View>;
  return (
    <ScrollView contentContainerStyle={{ padding: 12 }}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{blog?.title || 'Trip Blog'}</Text>
        <Text style={{ color: mutedColor, marginBottom: 12 }}>A shared story for everyone on the trip.</Text>
        {(blog?.days || []).map((day) => (
          <View key={day.id} style={{ marginBottom: 24, borderBottomWidth: 1, borderBottomColor: borderColor, paddingBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={styles.sectionTitle}>{day.localDate}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {!readOnly && (
                  <TouchableOpacity
                    style={[styles.button, { paddingVertical: 4, paddingHorizontal: 8 }]}
                    onPress={() => { setAddingDay(day.localDate); setNewBody(''); }}
                  >
                    <Text style={[styles.buttonText, { fontSize: 12 }]}>+ Add note</Text>
                  </TouchableOpacity>
                )}
                {!readOnly && (
                  <TouchableOpacity
                    style={[styles.button, { paddingVertical: 4, paddingHorizontal: 8, backgroundColor: '#0ea5e9' }]}
                    onPress={() => handleUpload(day.localDate)}
                    disabled={uploading}
                  >
                    <Text style={[styles.buttonText, { fontSize: 12 }]}>{uploading ? '...' : '+ Photo'}</Text>
                  </TouchableOpacity>
                )}
                {day.weather ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f9ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 }}>
                    <Text style={{ fontSize: 16, marginRight: 4 }}>{day.weather.icon}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#0369a1' }}>
                      {day.weather.temperatureHighC != null ? `${day.weather.temperatureHighC}°C` : ''}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            {(day.items || []).map((item) => (
              <View key={item.id} style={{ marginTop: 8 }}>
                {item.sourceId ? <Text style={{ color: mutedColor, fontSize: 12, marginBottom: 4 }}>{item.sourceDetached ? 'Copied from trip note/location · independent' : 'Linked to trip note/location · editing here disconnects it'}</Text> : null}
                {item.kindKey && item.kindKey.startsWith('media.') ? (
                  // Media items are not text: there's no blog_text_contents row backing them, so
                  // routing them through the text Save flow fails with a confusing version-conflict
                  // error — Remove is the one supported action here.
                  (item.thumbnailUrl || item.primaryUrl) ? (
                    <View>
                      <Image source={{ uri: item.thumbnailUrl || item.primaryUrl }} style={{ width: '100%', height: 200, borderRadius: 8, backgroundColor: inputColor }} resizeMode="cover" />
                      {item.caption ? <Text style={{ color: mutedColor, marginTop: 4 }}>{item.caption}</Text> : null}
                    </View>
                  ) : (
                    <View style={{ borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor: inputColor }}>
                      <Text style={{ color: textColor, fontWeight: '600' }}>{item.kindKey === 'media.video' ? '🎬 Video' : '📷 Photo'} — {item.state === 'ready' ? 'processed, no preview available' : (item.state || 'processing')}</Text>
                      {item.caption ? <Text style={{ color: mutedColor, marginTop: 4 }}>{item.caption}</Text> : null}
                    </View>
                  )
                ) : (
                  <TextInput
                    multiline value={drafts[item.id] ?? item.body}
                    editable={!readOnly} onChangeText={(value) => setDrafts((current) => ({ ...current, [item.id]: value }))}
                    placeholder="What happened today?" placeholderTextColor={mutedColor} style={{ minHeight: 90, borderWidth: 1, borderColor, borderRadius: 8, padding: 10, textAlignVertical: 'top', color: textColor, backgroundColor: inputColor }}
                  />
                )}
                {!readOnly ? (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                    {item.kindKey && item.kindKey.startsWith('media.') ? null : (
                      <TouchableOpacity style={styles.button} disabled={saving} onPress={() => save(item)}><Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text></TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.button, { backgroundColor: theme?.colors?.error ?? '#b91c1c' }]} disabled={deleting} onPress={() => deleteItem(item)}><Text style={styles.buttonText}>{deleting ? 'Removing…' : 'Remove'}</Text></TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ))}
            {(day.activities || []).length > 0 ? (
              <View style={{ marginTop: 14 }}>
                <Text style={{ color: textColor, fontWeight: '700', marginBottom: 6 }}>Planned activities</Text>
                {(day.activities || []).map((activity) => (
                  <View key={activity.id} style={{ borderLeftWidth: 3, borderLeftColor: theme?.colors?.link ?? '#0ea5e9', paddingLeft: 10, marginBottom: 8 }}>
                    <Text style={{ color: textColor, fontWeight: '600' }}>{activity.name}</Text>
                    <Text style={{ color: mutedColor }}>{activity.activityType}{activity.startTime ? ` · ${activity.startTime}` : ''}{activity.startLocation ? ` · ${activity.startLocation}` : ''}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {addingDay === day.localDate ? (
              <View style={{ marginTop: 10 }}>
                <TextInput
                  multiline autoFocus value={newBody} onChangeText={setNewBody} placeholder="Write about this day…" placeholderTextColor={mutedColor}
                  style={{ minHeight: 90, borderWidth: 1, borderColor, borderRadius: 8, padding: 10, textAlignVertical: 'top', color: textColor, backgroundColor: inputColor }}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <TouchableOpacity style={styles.button} disabled={creating || !newBody.trim()} onPress={() => createTextItem(day.localDate)}><Text style={styles.buttonText}>{creating ? 'Adding…' : 'Add to blog'}</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.button, { backgroundColor: theme?.colors?.surfaceMuted ?? '#e5e7eb' }]} onPress={() => setAddingDay(null)}><Text style={{ color: textColor }}>Cancel</Text></TouchableOpacity>
                </View>
              </View>
            ) : null}
            {!readOnly && (day.items || []).length === 0 && addingDay !== day.localDate ? <Text style={{ color: mutedColor }}>No notes yet. Click “+ Add note” to start this day.</Text> : null}
          </View>
        ))}
        {cursor ? (
          <TouchableOpacity
            style={[styles.button, { backgroundColor: '#f3f4f6', marginTop: 12 }]}
            onPress={loadMore}
            disabled={loading}
          >
            <Text style={[styles.buttonText, { color: '#374151' }]}>
              {loading ? 'Loading...' : 'Load more days'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Modal visible={showQuotaModal} transparent animationType="slide" onRequestClose={() => setShowQuotaModal(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: surfaceColor, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 }}>
            <Text style={{ color: textColor, fontSize: 20, fontWeight: 'bold', marginBottom: 8 }}>Storage quota exceeded</Text>
            <Text style={{ color: mutedColor, marginBottom: 20 }}>You don't have enough storage to upload this photo. Upgrade your storage to continue.</Text>
            {storagePlans.map(plan => (
              <TouchableOpacity
                key={plan.planKey}
                style={[styles.button, { marginBottom: 10, backgroundColor: '#0284c7' }]}
                onPress={() => purchaseStorage(plan.planKey)}
              >
                <Text style={styles.buttonText}>Add {plan.planKey.split('_')[1].toUpperCase()} Storage</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme?.colors?.surfaceMuted ?? '#e5e7eb', marginTop: 10 }]}
              onPress={() => setShowQuotaModal(false)}
            >
              <Text style={{ color: textColor }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

export default TripBlogTab;
