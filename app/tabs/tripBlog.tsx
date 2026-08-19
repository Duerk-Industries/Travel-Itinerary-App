// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { createCheckoutSession, fetchBillingPlans, openBillingUrl, type PlanInfo } from '../utils/billing';
import { createIdempotencyKey } from '../utils/idempotencyKey';
import { BlogMediaPreview, resolveMediaAspectRatio } from '../components/BlogMediaPreview';
import BlogRichTextEditor from '../components/BlogRichTextEditor';
import DayMediaGallery from '../components/DayMediaGallery';
import DayMediaLightbox from '../components/DayMediaLightbox';
import {
  SUPPORTED_MIME_TYPES,
  SUPPORTED_PHOTO_MIME_TYPES,
  SUPPORTED_VIDEO_MIME_TYPES,
  isVideoMimeType,
  guessMimeTypeFromName,
  uploadBlogFiles,
} from '../utils/blogUpload';

// Re-exported for backward compatibility — app/tests/tripBlogMedia.test.ts and any other existing
// consumer imports these names from this file; the actual implementations now live in
// app/components/BlogMediaPreview.tsx and app/utils/blogUpload.ts (the latter shared with the
// share-intent "send to" upload flow — app/utils/incomingShare.ts — so neither tab file nor
// share-intent code duplicates upload logic).
export { BlogMediaPreview, resolveMediaAspectRatio, isVideoMimeType, guessMimeTypeFromName, SUPPORTED_MIME_TYPES };

// BlogRichTextEditor emits HTML (e.g. `<p></p>`) even when the user hasn't
// typed anything, so `.trim()` alone no longer detects an empty entry the
// way it did for the plain TextInput this replaced. Strip tags/entities and
// check what's left.
const isRichTextEmpty = (html) => !String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

const TripBlogTab = ({ backendUrl, headers, activeTripId, styles, theme, readOnly = false }) => {
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [limit, setLimit] = useState(7);
  const [cursor, setCursor] = useState(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [storagePlans, setStoragePlans] = useState<PlanInfo[]>([]);
  const [addingDay, setAddingDay] = useState(null);
  const [newBody, setNewBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [publication, setPublication] = useState(null);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [publicationNotice, setPublicationNotice] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [settingCoverForDay, setSettingCoverForDay] = useState(null);
  const [lightboxDay, setLightboxDay] = useState(null);
  const canEdit = !readOnly && editMode;

  const textColor = theme?.colors?.text ?? styles.sectionTitle?.color ?? '#111827';
  const mutedColor = theme?.colors?.textMuted ?? '#6b7280';
  const surfaceColor = theme?.colors?.surface ?? '#ffffff';
  const inputColor = theme?.colors?.input ?? surfaceColor;
  const borderColor = theme?.colors?.border ?? '#ccd4df';
  const publicPageUrl = useMemo(() => {
    const publicPath = typeof blog?.publicPath === 'string' ? blog.publicPath.trim() : '';
    if (!publicPath) return null;
    const origin = Platform.OS === 'web' && typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://wander-bunnies.com';
    return `${origin.replace(/\/$/, '')}/${publicPath.replace(/^\//, '')}`;
  }, [blog?.publicPath]);
  // A read-only view inside the app is still an authenticated traveler/follower view. It should
  // include the complete shared blog (including linked planned activities and non-public items).
  // Only a genuinely public blog gets the public-only projection. Keeping this distinction here
  // also means the private/pending-consent preview cannot accidentally hide content merely because
  // the user is not currently editing.
  const publicPreview = !editMode && blog?.visibilityState === 'public';
  const visibleDays = useMemo(() => (blog?.days || []).map((day) => {
    if (!publicPreview) return day;
    return {
      ...day,
      items: (day.items || []).filter((item) => !item.audience || item.audience === 'public'),
      activities: [],
    };
  }), [blog?.days, publicPreview]);

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

  const loadPublicationStatus = async () => {
    if (!activeTripId) return;
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/publication/status`, { headers });
      if (response.status === 404) {
        setPublication(null);
        return;
      }
      if (!response.ok) return;
      setPublication(await response.json());
    } catch {
      // Publication controls are supplementary; keep the blog usable if status is unavailable.
    }
  };

  const refreshBlogAndPublication = async () => {
    await Promise.all([load(), loadPublicationStatus()]);
  };

  const requestPublication = async () => {
    if (!activeTripId || !canEdit || publicationBusy) return;
    setPublicationBusy(true);
    setPublicationNotice('');
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/publication/request`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to publish this blog');
      setPublicationNotice(data.state === 'public'
        ? 'Your blog is now public.'
        : 'Publication requested. Other adult travelers must approve before it becomes public.');
      await refreshBlogAndPublication();
    } catch (error) {
      setPublicationNotice(error.message || 'Unable to publish this blog');
    } finally {
      setPublicationBusy(false);
    }
  };

  const respondToPublication = async (decision) => {
    if (!activeTripId || !canEdit || !publication?.epoch || publicationBusy) return;
    setPublicationBusy(true);
    setPublicationNotice('');
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/publication/${publication.epoch}/consent`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to update publication consent');
      setPublicationNotice(decision === 'approved' ? 'Consent recorded.' : 'Publication declined.');
      await refreshBlogAndPublication();
    } catch (error) {
      setPublicationNotice(error.message || 'Unable to update publication consent');
    } finally {
      setPublicationBusy(false);
    }
  };

  const revokePublication = async () => {
    if (!activeTripId || !canEdit || publicationBusy) return;
    setPublicationBusy(true);
    setPublicationNotice('');
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/publication/revoke`, {
        method: 'POST',
        headers,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to make this blog private');
      setPublicationNotice('Your blog is private again.');
      await refreshBlogAndPublication();
    } catch (error) {
      setPublicationNotice(error.message || 'Unable to make this blog private');
    } finally {
      setPublicationBusy(false);
    }
  };

  const toggleEditMode = () => {
    setEditMode((current) => {
      if (current) {
        setAddingDay(null);
        setNewBody('');
        setDrafts({});
      }
      return !current;
    });
  };

  // Opens the OS file picker (web) or the phone's photo library (native), both configured for
  // multi-select of photos AND videos in one action. Returns a normalized array of { blob,
  // mimeType, size, name } regardless of platform so the upload loop below doesn't need to know
  // which one ran.
  const pickMediaFiles = async () => {
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return [];
      const files = await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = SUPPORTED_MIME_TYPES.join(',');
        input.multiple = true;
        input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
        input.click();
      });
      return files.map((file) => ({ blob: file, mimeType: file.type || guessMimeTypeFromName(file.name), size: file.size, name: file.name }));
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo library access needed', 'Allow photo library access in Settings to add photos or videos to this trip blog.');
      return [];
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      // `MediaTypeOptions` is deprecated in favor of this array form as of expo-image-picker ~17.
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || !result.assets?.length) return [];
    return Promise.all(result.assets.map(async (asset) => {
      const mimeType = asset.mimeType || guessMimeTypeFromName(asset.fileName);
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      return { blob, mimeType, size: asset.fileSize ?? blob.size, name: asset.fileName ?? (isVideoMimeType(mimeType) ? 'video' : 'photo') };
    }));
  };

  const handleUpload = async (dayDate) => {
    if (!canEdit) return;
    const picked = await pickMediaFiles();
    if (!picked.length) return; // user cancelled the picker

    const supported = picked.filter((file) => SUPPORTED_MIME_TYPES.includes(file.mimeType));
    const unsupportedCount = picked.length - supported.length;
    if (!supported.length) {
      Alert.alert('Upload', 'Only JPEG/PNG photos or MP4/MOV/WebM videos are supported.');
      return;
    }

    setUploading(true);
    try {
      const result = await uploadBlogFiles(
        { backendUrl, headers, tripId: activeTripId },
        dayDate,
        supported,
        { onProgress: (current, total) => setUploadProgress({ current, total }) }
      );
      if (result.quotaBlocked) {
        const plans = await fetchBillingPlans(backendUrl, headers.Authorization?.replace('Bearer ', ''));
        setStoragePlans(plans.filter(p => p.planKey.startsWith('storage_')));
        setShowQuotaModal(true);
      }
      await load();
      if (!result.quotaBlocked && (result.failed > 0 || unsupportedCount > 0 || result.entitlementSkipped > 0)) {
        const parts = [];
        if (result.succeeded > 0) parts.push(`${result.succeeded} uploaded`);
        if (result.failed > 0) parts.push(`${result.failed} failed`);
        if (result.entitlementSkipped > 0) parts.push(`${result.entitlementSkipped} skipped (video requires Premium)`);
        if (unsupportedCount > 0) parts.push(`${unsupportedCount} skipped (unsupported format)`);
        Alert.alert('Upload', parts.join(', '));
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const purchaseStorage = async (planKey) => {
    // Checkout may hand off to an external browser/app. Dismiss the quota sheet
    // before starting that asynchronous work so it never appears stuck.
    setShowQuotaModal(false);
    try {
      const token = headers.Authorization?.replace('Bearer ', '');
      const result = await createCheckoutSession(backendUrl, token, planKey, createIdempotencyKey('st'));
      if (result && 'url' in result) {
        await openBillingUrl(result.url);
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
    setEditMode(false);
    setAddingDay(null);
    setPublicationNotice('');
    void refreshBlogAndPublication();
  }, [activeTripId]);

  const loadMore = () => {
    if (cursor && !loading) {
      void load(cursor);
    }
  };

  const save = async (item) => {
    if (!canEdit) return;
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
    if (!canEdit) return;
    const body = newBody;
    if (isRichTextEmpty(body)) return;
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
    if (!canEdit) return;
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

  // Any active traveler may set a day's default photo/video — not gated behind the edit-mode
  // toggle (`canEdit`), unlike text/media authoring, since picking a favorite shot is a lighter,
  // non-destructive action a follower still must not get (readOnly still blocks it).
  const setDayCover = async (dayDate, item) => {
    if (readOnly || settingCoverForDay) return;
    setSettingCoverForDay(dayDate);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/days/${dayDate}/cover`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: item.assetId }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to set the day cover');
      await load();
    } catch (error) { Alert.alert('Trip blog', error.message || 'Unable to set the day cover'); }
    finally { setSettingCoverForDay(null); }
  };

  // A photo that belongs to a core.gallery blog item can't be removed via DELETE /blog/items/:id
  // (that deletes the whole gallery) — it has its own per-asset endpoint instead, which is also
  // what keeps the rest of the gallery intact. Standalone media items go through deleteItem.
  const removeGalleryAsset = async (assetId) => {
    if (!canEdit || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/media/${assetId}`, { method: 'DELETE', headers });
      if (!response.ok && response.status !== 404) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to remove photo');
      await load();
    } catch (error) { Alert.alert('Trip blog', error.message || 'Unable to remove photo'); }
    finally { setDeleting(false); }
  };
  const removeMediaItem = (item) => (item.isGalleryMember ? removeGalleryAsset(item.assetId) : deleteItem(item));

  if (!activeTripId) return <View style={styles.card}><Text style={styles.sectionTitle}>Select a trip to write its blog.</Text></View>;
  if (loading) return <View style={styles.card}><ActivityIndicator /></View>;
  const publicationState = publication?.state ?? blog?.visibilityState ?? 'private';
  const hasPendingConsent = publicationState === 'pending_consent' && publication?.userDecision === 'pending';
  return (
    <ScrollView contentContainerStyle={{ padding: 12 }}>
      <View style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={[styles.sectionTitle, { flex: 1 }]}>{blog?.title || 'Trip Blog'}</Text>
          {!readOnly ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={toggleEditMode}
              style={[styles.button, { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: editMode ? (theme?.colors?.surfaceMuted ?? '#e5e7eb') : undefined }]}
            >
              <Text style={editMode ? { color: textColor } : styles.buttonText}>{editMode ? 'Done editing' : 'Edit blog'}</Text>
            </TouchableOpacity>
          ) : null}
          {publicPageUrl ? (
            <TouchableOpacity
              accessibilityRole="link"
              onPress={() => { void Linking.openURL(publicPageUrl).catch(() => {}); }}
              style={{ paddingVertical: 6, paddingHorizontal: 8 }}
            >
              <Text style={{ color: theme?.colors?.link ?? '#0ea5e9', fontWeight: '700' }}>View public page ↗</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={{ color: mutedColor, marginBottom: 12 }}>
          {editMode
            ? 'Editing mode — changes are saved to the trip blog.'
            : publicPreview
              ? 'Public preview — only content intended for public sharing is shown.'
              : 'Traveler/follower view — all shared trip blog content is shown.'}
        </Text>
        {canEdit ? (
          <View style={{ marginBottom: 16, padding: 10, borderWidth: 1, borderColor, borderRadius: 8, backgroundColor: inputColor }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Text style={{ color: textColor, fontWeight: '700' }}>
                Visibility: {publicationState === 'public' ? 'Public' : publicationState === 'pending_consent' ? 'Awaiting consent' : 'Private'}
              </Text>
              {publicationState === 'public' ? (
                <TouchableOpacity style={[styles.button, { paddingVertical: 5, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? '#e5e7eb' }]} disabled={publicationBusy} onPress={revokePublication}>
                  <Text style={{ color: textColor }}>{publicationBusy ? 'Updating…' : 'Make private'}</Text>
                </TouchableOpacity>
              ) : hasPendingConsent ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={[styles.button, { paddingVertical: 5, paddingHorizontal: 10 }]} disabled={publicationBusy} onPress={() => respondToPublication('approved')}>
                    <Text style={styles.buttonText}>{publicationBusy ? 'Updating…' : 'Approve'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.button, { paddingVertical: 5, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? '#e5e7eb' }]} disabled={publicationBusy} onPress={() => respondToPublication('declined')}>
                    <Text style={{ color: textColor }}>Decline</Text>
                  </TouchableOpacity>
                </View>
              ) : publicationState === 'pending_consent' ? (
                <Text style={{ color: mutedColor }}>Waiting for other adult travelers</Text>
              ) : (
                <TouchableOpacity style={[styles.button, { paddingVertical: 5, paddingHorizontal: 10 }]} disabled={publicationBusy} onPress={requestPublication}>
                  <Text style={styles.buttonText}>{publicationBusy ? 'Requesting…' : 'Make public'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {publicationNotice ? <Text style={{ color: mutedColor, marginTop: 8 }}>{publicationNotice}</Text> : null}
            {publicationState === 'private' ? <Text style={{ color: mutedColor, marginTop: 6, fontSize: 12 }}>Making a blog public requires consent from all adult account travelers.</Text> : null}
          </View>
        ) : null}
        {visibleDays.map((day) => (
          <View key={day.id} style={{ marginBottom: 24, borderBottomWidth: 1, borderBottomColor: borderColor, paddingBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={styles.sectionTitle}>{day.localDate}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {canEdit && (
                  <TouchableOpacity
                    style={[styles.button, { paddingVertical: 4, paddingHorizontal: 8 }]}
                    onPress={() => { setAddingDay(day.localDate); setNewBody(''); }}
                  >
                    <Text style={[styles.buttonText, { fontSize: 12 }]}>+ Add note</Text>
                  </TouchableOpacity>
                )}
                {canEdit && (
                  <TouchableOpacity
                    style={[styles.button, { paddingVertical: 4, paddingHorizontal: 8, backgroundColor: '#0ea5e9' }]}
                    onPress={() => handleUpload(day.localDate)}
                    disabled={uploading}
                  >
                    <Text style={[styles.buttonText, { fontSize: 12 }]}>{uploading ? (uploadProgress ? `${uploadProgress.current}/${uploadProgress.total}…` : '…') : '+ Photo/Video'}</Text>
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
            {(day.items || []).filter((item) => !(item.kindKey && item.kindKey.startsWith('media.'))).map((item) => (
              <View key={item.id} style={{ marginTop: 8 }}>
                {item.sourceId ? <Text style={{ color: mutedColor, fontSize: 12, marginBottom: 4 }}>{item.sourceDetached ? 'Copied from trip note/location · independent' : 'Linked to trip note/location · editing here disconnects it'}</Text> : null}
                {canEdit ? (
                  <BlogRichTextEditor
                    key={item.id}
                    testID={`blog-item-editor-${item.id}`}
                    value={drafts[item.id] ?? item.body}
                    onChangeHTML={(html) => setDrafts((current) => ({ ...current, [item.id]: html }))}
                    borderColor={borderColor}
                    backgroundColor={inputColor}
                    textColor={textColor}
                  />
                ) : (
                  <BlogRichTextEditor
                    key={`view-${item.id}`}
                    testID={`blog-item-view-${item.id}`}
                    value={item.body || ''}
                    editable={false}
                    backgroundColor="transparent"
                    textColor={textColor}
                  />
                )}
                {canEdit ? (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                    <TouchableOpacity style={styles.button} disabled={saving} onPress={() => save(item)}><Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.button, { backgroundColor: theme?.colors?.error ?? '#b91c1c' }]} disabled={deleting} onPress={() => deleteItem(item)}><Text style={styles.buttonText}>{deleting ? 'Removing…' : 'Remove'}</Text></TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ))}
            {(() => {
              // core.gallery items group a batch of assets under one blog_item (see blogRoutes.ts);
              // flatten those `assets` back out alongside standalone media.* items so every
              // traveler's photos/videos for the day become one combined, browsable set regardless
              // of which upload flow produced them. Gallery members are tagged so Remove routes to
              // the per-asset delete endpoint (removeGalleryAsset) instead of the whole-item delete
              // standalone items use (deleteItem) — see removeMediaItem above.
              const allMedia = (day.items || []).flatMap((item) => {
                if (item.kindKey === 'core.gallery') {
                  return (item.assets || []).map((asset) => ({ ...asset, isGalleryMember: true }));
                }
                return item.kindKey && item.kindKey.startsWith('media.') ? [item] : [];
              });
              const readyMedia = allMedia.filter((item) => item.thumbnailUrl || item.primaryUrl);
              const processingMedia = allMedia.filter((item) => !(item.thumbnailUrl || item.primaryUrl));
              return (
                <>
                  {readyMedia.length ? (
                    <DayMediaGallery
                      items={readyMedia}
                      dayDate={day.localDate}
                      coverItemId={day.coverItemId}
                      canSetCover={!readOnly}
                      settingCover={settingCoverForDay === day.localDate}
                      onSetCover={(item) => setDayCover(day.localDate, item)}
                      onOpenLightbox={() => setLightboxDay(day.localDate)}
                      canRemove={canEdit}
                      removing={deleting}
                      onRemove={(item) => removeMediaItem(item)}
                      textColor={textColor}
                      mutedColor={mutedColor}
                      borderColor={borderColor}
                      backgroundColor={inputColor}
                      styles={styles}
                    />
                  ) : null}
                  {processingMedia.map((item) => (
                    <View key={item.id} style={{ borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor: inputColor, marginTop: 8 }}>
                      <Text style={{ color: textColor, fontWeight: '600' }}>{item.kindKey === 'media.video' ? '🎬 Video' : '📷 Photo'} — {item.state === 'ready' ? 'processed, no preview available' : (item.state || 'processing')}</Text>
                      {item.caption ? <Text style={{ color: mutedColor, marginTop: 4 }}>{item.caption}</Text> : null}
                      {canEdit ? (
                        <TouchableOpacity style={[styles.button, { alignSelf: 'flex-start', marginTop: 8, backgroundColor: theme?.colors?.error ?? '#b91c1c' }]} disabled={deleting} onPress={() => removeMediaItem(item)}>
                          <Text style={styles.buttonText}>{deleting ? 'Removing…' : 'Remove'}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ))}
                  <DayMediaLightbox
                    visible={lightboxDay === day.localDate}
                    items={readyMedia}
                    dayDate={day.localDate}
                    onClose={() => setLightboxDay(null)}
                    styles={styles}
                    textColor={textColor}
                    mutedColor={mutedColor}
                    borderColor={borderColor}
                    backgroundColor={inputColor}
                  />
                </>
              );
            })()}
            {!publicPreview && (day.activities || []).length > 0 ? (
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
            {canEdit && addingDay === day.localDate ? (
              <View style={{ marginTop: 10 }}>
                <BlogRichTextEditor
                  key={`new-${day.localDate}`}
                  testID={`blog-new-note-editor-${day.localDate}`}
                  value={newBody}
                  onChangeHTML={setNewBody}
                  borderColor={borderColor}
                  backgroundColor={inputColor}
                  textColor={textColor}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <TouchableOpacity style={styles.button} disabled={creating || isRichTextEmpty(newBody)} onPress={() => createTextItem(day.localDate)}><Text style={styles.buttonText}>{creating ? 'Adding…' : 'Add to blog'}</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.button, { backgroundColor: theme?.colors?.surfaceMuted ?? '#e5e7eb' }]} onPress={() => setAddingDay(null)}><Text style={{ color: textColor }}>Cancel</Text></TouchableOpacity>
                </View>
              </View>
            ) : null}
            {canEdit && (day.items || []).length === 0 && addingDay !== day.localDate ? <Text style={{ color: mutedColor }}>No notes yet. Click “+ Add note” to start this day.</Text> : null}
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
