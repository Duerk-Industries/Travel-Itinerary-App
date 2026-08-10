// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { createCheckoutSession, fetchBillingPlans, openBillingUrl, type PlanInfo } from '../utils/billing';
import { createIdempotencyKey } from '../utils/idempotencyKey';

const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png'];

const guessMimeTypeFromName = (name) => {
  const lower = String(name ?? '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return null;
};

export const resolveMediaAspectRatio = (width, height) => {
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  if (!Number.isFinite(numericWidth) || !Number.isFinite(numericHeight) || numericWidth <= 0 || numericHeight <= 0) {
    return null;
  }
  return numericWidth / numericHeight;
};

export const BlogMediaPreview = ({ item, backgroundColor }) => {
  const [aspectRatio, setAspectRatio] = useState(null);
  const mediaUrl = item.primaryUrl || item.thumbnailUrl;

  useEffect(() => {
    setAspectRatio(null);
  }, [mediaUrl]);

  if (item.kindKey === 'media.video' && Platform.OS === 'web') {
    return React.createElement('video', {
      src: mediaUrl,
      controls: true,
      playsInline: true,
      preload: 'metadata',
      style: {
        display: 'block',
        width: '100%',
        height: 'auto',
        maxWidth: '100%',
        borderRadius: 8,
        backgroundColor,
      },
    });
  }

  return (
    <Image
      source={{ uri: mediaUrl }}
      style={{
        width: '100%',
        ...(aspectRatio ? { aspectRatio } : { height: 200 }),
        borderRadius: 8,
        backgroundColor,
      }}
      resizeMode="contain"
      onLoad={(event) => {
        const source = event?.nativeEvent?.source;
        const nextAspectRatio = resolveMediaAspectRatio(source?.width, source?.height);
        if (nextAspectRatio) setAspectRatio(nextAspectRatio);
      }}
    />
  );
};

const GalleryGrid = ({ item, backgroundColor, mutedColor, canEdit, onRemoveAsset, removingAssetId }) => {
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const assets = item.assets || [];
  if (!assets.length) return null;
  const activeAsset = lightboxIndex != null ? assets[lightboxIndex] : null;
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {assets.map((asset, index) => {
          const assetId = asset.assetId || asset.id;
          return (
            <TouchableOpacity key={assetId} testID={`gallery-thumb-${assetId}`} accessibilityRole="button" onPress={() => setLightboxIndex(index)} style={{ width: 96, height: 96 }}>
              <Image source={{ uri: asset.thumbnailUrl || asset.primaryUrl }} style={{ width: 96, height: 96, borderRadius: 6, backgroundColor }} resizeMode="cover" />
              {canEdit ? (
                <TouchableOpacity
                  testID={`gallery-remove-${assetId}`}
                  accessibilityRole="button"
                  onPress={() => onRemoveAsset(assetId)}
                  disabled={removingAssetId === assetId}
                  style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 14, lineHeight: 16 }}>{removingAssetId === assetId ? '…' : '×'}</Text>
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
      {item.caption ? <Text style={{ color: mutedColor, marginTop: 4 }}>{item.caption}</Text> : null}
      {lightboxIndex != null ? (
        <Modal testID="gallery-lightbox" visible transparent animationType="fade" onRequestClose={() => setLightboxIndex(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 20 }}>
            <TouchableOpacity testID="gallery-lightbox-close" accessibilityRole="button" onPress={() => setLightboxIndex(null)} style={{ position: 'absolute', top: 40, right: 20, zIndex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 28 }}>×</Text>
            </TouchableOpacity>
            {activeAsset ? <BlogMediaPreview item={activeAsset} backgroundColor="transparent" /> : null}
            {assets.length > 1 ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, marginTop: 16 }}>
                <TouchableOpacity testID="gallery-prev" accessibilityRole="button" onPress={() => setLightboxIndex((current) => (current - 1 + assets.length) % assets.length)}>
                  <Text style={{ color: '#fff', fontSize: 18 }}>‹ Prev</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="gallery-next" accessibilityRole="button" onPress={() => setLightboxIndex((current) => (current + 1) % assets.length)}>
                  <Text style={{ color: '#fff', fontSize: 18 }}>Next ›</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </Modal>
      ) : null}
    </View>
  );
};

const TripBlogTab = ({ backendUrl, headers, activeTripId, styles, theme, readOnly = false }) => {
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [removingAssetId, setRemovingAssetId] = useState(null);
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
  const visibleDays = useMemo(() => (blog?.days || []).map((day) => {
    if (editMode) return day;
    return {
      ...day,
      // The private editor response can contain traveler/follower-only items. The default
      // preview mirrors the public endpoint and only displays public-audience content.
      items: (day.items || []).filter((item) => !item.audience || item.audience === 'public'),
      activities: [],
    };
  }), [blog?.days, editMode]);

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
  // multi-select. Returns a normalized array of { blob, mimeType, size, name } regardless of
  // platform so the upload loop below doesn't need to know which one ran.
  const pickImageFiles = async () => {
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return [];
      const files = await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/jpeg,image/png';
        input.multiple = true;
        input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
        input.click();
      });
      return files.map((file) => ({ blob: file, mimeType: file.type || guessMimeTypeFromName(file.name), size: file.size, name: file.name }));
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo library access needed', 'Allow photo library access in Settings to add photos to this trip blog.');
      return [];
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || !result.assets?.length) return [];
    return Promise.all(result.assets.map(async (asset) => {
      const mimeType = asset.mimeType || guessMimeTypeFromName(asset.fileName);
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      return { blob, mimeType, size: asset.fileSize ?? blob.size, name: asset.fileName ?? 'photo' };
    }));
  };

  const uploadOneFile = async (dayDate, pickedFile, galleryItemId = null) => {
    const idempotencyKey = createIdempotencyKey('up');
    const initRes = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/media/upload-init`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ dayDate, mediaKind: 'photo', mimeType: pickedFile.mimeType, byteSize: pickedFile.size, ...(galleryItemId ? { galleryItemId } : {}) }),
    });

    if (initRes.status === 413) {
      const plans = await fetchBillingPlans(backendUrl, headers.Authorization?.replace('Bearer ', ''));
      setStoragePlans(plans.filter(p => p.planKey.startsWith('storage_')));
      setShowQuotaModal(true);
      return 'quota_exceeded';
    }
    if (!initRes.ok) throw new Error((await initRes.json().catch(() => ({}))).error || 'Upload failed');
    const { asset, uploadUrl } = await initRes.json();

    if (uploadUrl) {
      // Real signed URL: upload the actual selected file's bytes directly to storage.
      const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': pickedFile.mimeType }, body: pickedFile.blob });
      if (!putRes.ok) throw new Error('Failed to upload the photo to storage');
    }

    const completeRes = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/media/${asset.id}/complete`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ physicalBytes: pickedFile.size }),
    });
    if (!completeRes.ok) throw new Error((await completeRes.json().catch(() => ({}))).error || 'Failed to finalize upload');
    return 'ok';
  };

  const handleUpload = async (dayDate) => {
    if (!canEdit) return;
    const picked = await pickImageFiles();
    if (!picked.length) return; // user cancelled the picker

    const supported = picked.filter((file) => SUPPORTED_MIME_TYPES.includes(file.mimeType));
    const unsupportedCount = picked.length - supported.length;
    if (!supported.length) {
      Alert.alert('Photo upload', 'Only JPEG or PNG photos are supported.');
      return;
    }

    setUploading(true);
    let succeeded = 0;
    let failed = 0;
    let quotaBlocked = false;
    try {
      for (let index = 0; index < supported.length; index += 1) {
        if (quotaBlocked) break; // no point continuing once storage is full
        setUploadProgress({ current: index + 1, total: supported.length });
        try {
          const outcome = await uploadOneFile(dayDate, supported[index]);
          if (outcome === 'quota_exceeded') { quotaBlocked = true; break; }
          succeeded += 1;
        } catch (error) {
          failed += 1;
        }
      }
      await load();
      if (!quotaBlocked && (failed > 0 || unsupportedCount > 0)) {
        const parts = [];
        if (succeeded > 0) parts.push(`${succeeded} uploaded`);
        if (failed > 0) parts.push(`${failed} failed`);
        if (unsupportedCount > 0) parts.push(`${unsupportedCount} skipped (unsupported format)`);
        Alert.alert('Photo upload', parts.join(', '));
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  // Same picker + per-file upload flow as handleUpload, except every file joins one shared
  // core.gallery item (created up front) instead of becoming its own standalone post.
  const handleGalleryUpload = async (dayDate) => {
    if (!canEdit) return;
    const picked = await pickImageFiles();
    if (!picked.length) return; // user cancelled the picker

    const supported = picked.filter((file) => SUPPORTED_MIME_TYPES.includes(file.mimeType));
    const unsupportedCount = picked.length - supported.length;
    if (!supported.length) {
      Alert.alert('Gallery upload', 'Only JPEG or PNG photos are supported.');
      return;
    }

    setUploading(true);
    let galleryItem = null;
    let succeeded = 0;
    let failed = 0;
    let quotaBlocked = false;
    try {
      const createRes = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kindKey: 'core.gallery', dayDate }),
      });
      if (!createRes.ok) throw new Error((await createRes.json().catch(() => ({}))).error || 'Unable to create the gallery');
      galleryItem = await createRes.json();

      for (let index = 0; index < supported.length; index += 1) {
        if (quotaBlocked) break;
        setUploadProgress({ current: index + 1, total: supported.length });
        try {
          const outcome = await uploadOneFile(dayDate, supported[index], galleryItem.id);
          if (outcome === 'quota_exceeded') { quotaBlocked = true; break; }
          succeeded += 1;
        } catch (error) {
          failed += 1;
        }
      }
      if (succeeded === 0 && galleryItem) {
        // Nothing landed in the gallery — clean up the now-orphaned empty item rather than
        // leaving an invisible post behind server-side (empty galleries simply don't render).
        await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items/${galleryItem.id}`, {
          method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ version: galleryItem.version }),
        }).catch(() => {});
      }
      await load();
      if (!quotaBlocked && (failed > 0 || unsupportedCount > 0)) {
        const parts = [];
        if (succeeded > 0) parts.push(`${succeeded} uploaded`);
        if (failed > 0) parts.push(`${failed} failed`);
        if (unsupportedCount > 0) parts.push(`${unsupportedCount} skipped (unsupported format)`);
        Alert.alert('Gallery upload', parts.join(', '));
      }
    } catch (error) {
      Alert.alert('Gallery upload', error.message || 'Unable to create the gallery');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const removeGalleryAsset = async (assetId) => {
    if (!canEdit || removingAssetId) return;
    setRemovingAssetId(assetId);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/media/${assetId}`, { method: 'DELETE', headers });
      if (!response.ok && response.status !== 404) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to remove photo');
      await load();
    } catch (error) {
      Alert.alert('Trip blog', error.message || 'Unable to remove photo');
    } finally {
      setRemovingAssetId(null);
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
        <Text style={{ color: mutedColor, marginBottom: 12 }}>{editMode ? 'Editing mode — changes are saved to the trip blog.' : 'Public preview — only content intended for public sharing is shown.'}</Text>
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
                    <Text style={[styles.buttonText, { fontSize: 12 }]}>{uploading ? (uploadProgress ? `${uploadProgress.current}/${uploadProgress.total}…` : '…') : '+ Photo'}</Text>
                  </TouchableOpacity>
                )}
                {canEdit && (
                  <TouchableOpacity
                    style={[styles.button, { paddingVertical: 4, paddingHorizontal: 8, backgroundColor: '#7c3aed' }]}
                    onPress={() => handleGalleryUpload(day.localDate)}
                    disabled={uploading}
                  >
                    <Text style={[styles.buttonText, { fontSize: 12 }]}>{uploading ? (uploadProgress ? `${uploadProgress.current}/${uploadProgress.total}…` : '…') : '+ Gallery'}</Text>
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
                {item.kindKey === 'core.gallery' ? (
                  <GalleryGrid item={item} backgroundColor={inputColor} mutedColor={mutedColor} canEdit={canEdit} onRemoveAsset={removeGalleryAsset} removingAssetId={removingAssetId} />
                ) : item.kindKey && item.kindKey.startsWith('media.') ? (
                  // Media items are not text: there's no blog_text_contents row backing them, so
                  // routing them through the text Save flow fails with a confusing version-conflict
                  // error — Remove is the one supported action here.
                  (item.thumbnailUrl || item.primaryUrl) ? (
                    <View>
                      <BlogMediaPreview item={item} backgroundColor={inputColor} />
                      {item.caption ? <Text style={{ color: mutedColor, marginTop: 4 }}>{item.caption}</Text> : null}
                    </View>
                  ) : (
                    <View style={{ borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor: inputColor }}>
                      <Text style={{ color: textColor, fontWeight: '600' }}>{item.kindKey === 'media.video' ? '🎬 Video' : '📷 Photo'} — {item.state === 'ready' ? 'processed, no preview available' : (item.state || 'processing')}</Text>
                      {item.caption ? <Text style={{ color: mutedColor, marginTop: 4 }}>{item.caption}</Text> : null}
                    </View>
                  )
                ) : canEdit ? (
                  <TextInput
                    multiline value={drafts[item.id] ?? item.body}
                    editable onChangeText={(value) => setDrafts((current) => ({ ...current, [item.id]: value }))}
                    placeholder="What happened today?" placeholderTextColor={mutedColor} style={{ minHeight: 90, borderWidth: 1, borderColor, borderRadius: 8, padding: 10, textAlignVertical: 'top', color: textColor, backgroundColor: inputColor }}
                  />
                ) : (
                  <Text style={{ color: textColor, lineHeight: 22, paddingVertical: 8 }}>{item.body || ''}</Text>
                )}
                {canEdit ? (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                    {item.kindKey === 'core.gallery' || (item.kindKey && item.kindKey.startsWith('media.')) ? null : (
                      <TouchableOpacity style={styles.button} disabled={saving} onPress={() => save(item)}><Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text></TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.button, { backgroundColor: theme?.colors?.error ?? '#b91c1c' }]} disabled={deleting} onPress={() => deleteItem(item)}><Text style={styles.buttonText}>{deleting ? 'Removing…' : 'Remove'}</Text></TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ))}
            {canEdit && (day.activities || []).length > 0 ? (
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
