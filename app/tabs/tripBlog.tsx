// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, ImageBackground, Linking, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, Fraunces_500Medium, Fraunces_600SemiBold, Fraunces_600SemiBold_Italic } from '@expo-google-fonts/fraunces';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { alertMessage } from '../utils/crossPlatformAlert';
import { formatDateLong } from '../utils/formatDateLong';
import TripDayMap from '../components/TripDayMap';
import { type TripMapPoint } from '../utils/googleMaps';
import { createCheckoutSession, fetchBillingPlans, openBillingUrl, type PlanInfo } from '../utils/billing';
import { createIdempotencyKey } from '../utils/idempotencyKey';
import { useAutosave } from '../utils/useAutosave';
import { useBlogEngagement } from '../utils/useBlogEngagement';
import { useBlogComments } from '../utils/useBlogComments';
import { useConnectionState } from '../hooks/useConnectionState';
import { enqueueOfflineBlogEntry, flushOfflineBlogEntries, listOfflineBlogEntries } from '../utils/blogOfflineQueue';
import { BlogMediaPreview, resolveMediaAspectRatio } from '../components/BlogMediaPreview';
import BlogConflictBanner, { type BlogConflictLatest } from '../components/BlogConflictBanner';
import BlogReactionBar from '../components/BlogReactionBar';
import BlogContributorStrip from '../components/BlogContributorStrip';
import BlogCommentThread from '../components/BlogCommentThread';
import BlogRichTextEditor from '../components/BlogRichTextEditor';
import BlogDayStarterCard from '../components/BlogDayStarterCard';
import DayMediaGallery from '../components/DayMediaGallery';
import DayMediaLightbox from '../components/DayMediaLightbox';
import TripRecapCards from '../components/TripRecapCards';
import BlogDiscoveryPanel from '../components/BlogDiscoveryPanel';
import BlogKeepsakeButton from '../components/BlogKeepsakeButton';
import {
  SUPPORTED_MIME_TYPES,
  SUPPORTED_PHOTO_MIME_TYPES,
  SUPPORTED_VIDEO_MIME_TYPES,
  SUPPORTED_AUDIO_MIME_TYPES,
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

const WRITING_PROMPTS = [
  'What surprised you today?', 'Best thing you ate', 'A moment worth remembering',
  'What made everyone laugh?', 'One thing you learned', 'The view you did not expect',
];
const promptsForDay = (dayDate) => {
  const start = [...String(dayDate)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % WRITING_PROMPTS.length;
  return [0, 1, 2].map((offset) => WRITING_PROMPTS[(start + offset) % WRITING_PROMPTS.length]);
};

const TripBlogTab = ({ backendUrl, headers, activeTripId, styles, theme, readOnly = false, currentUserId = null, isTripOwnerOrAdmin = false, allExpenses = [] as any[], tripCurrency = 'USD', flights = [] as any[], lodgings = [] as any[], tours = [] as any[], carRentals = [] as any[] }) => {
  // Phase 1 typography (redesign proposal §5) — Fraunces for the masthead title and day
  // headlines, everything else stays on the system font. Loaded here rather than at the app
  // root so this stays scoped to the trip blog; while it loads, headings just render in the
  // system font (no flash of unstyled layout, only of the display face).
  const [fraunceLoaded] = useFonts({ Fraunces_500Medium, Fraunces_600SemiBold, Fraunces_600SemiBold_Italic });
  const displayFont = fraunceLoaded ? 'Fraunces_600SemiBold' : undefined;
  const displayFontItalic = fraunceLoaded ? 'Fraunces_600SemiBold_Italic' : undefined;
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const [capabilities, setCapabilities] = useState({});
  const [recap, setRecap] = useState(null);
  const [recapBusy, setRecapBusy] = useState(false);
  const [metadataBusyAssetId, setMetadataBusyAssetId] = useState(null);
  const [coverProposals, setCoverProposals] = useState({});
  const [reorderBusy, setReorderBusy] = useState(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  // Phase 0 reorder — search/places/privacy/export/storage move out from in front of the story
  // into a collapsed "Blog tools" section below the days (redesign notes §1/§4), so they no longer
  // compete with the narrative for the first thing a reader sees.
  const [showBlogTools, setShowBlogTools] = useState(false);
  const draggedItemId = useRef(null);
  // Phase 1 authoring (A3/A4/A5): headline/summary editing, blog masthead editing, and the
  // autosave + conflict-banner replacement for the old Save-button/Alert flow. `drafts` above
  // (item body HTML) stays as-is; these are the parallel per-field draft stores it didn't need
  // until autosave and day/masthead editing existed.
  const autosave = useAutosave();
  // Keyed by localDate. Only populated once a traveler starts editing that day's headline or
  // summary — { headline, summary, baseVersion }. `baseVersion` starts at the day's current
  // updateVersion and is kept in sync with the server's response after every successful save, so
  // the next save in the same session never has to wait on a fresh GET /blog to know what version
  // to send (architecture §4.05).
  const [dayMetaDrafts, setDayMetaDrafts] = useState({});
  const [dayMetaConflicts, setDayMetaConflicts] = useState({});
  // Blog masthead (title/subtitle/introduction) has no optimistic-concurrency contract — see the
  // comment on updateBlogMeta in postgresRepository.ts — so it needs no conflict state, only a
  // draft, initialized lazily the same way.
  const [mastheadDraft, setMastheadDraft] = useState(null);
  // Item-body conflicts, keyed by item.id — the autosave-era replacement for the single
  // `Alert.alert` the old save() threw on any 409, regardless of which item.
  const [itemConflicts, setItemConflicts] = useState({});
  const canEdit = !readOnly && editMode;
  const engagement = useBlogEngagement(backendUrl, headers, activeTripId);
  const handleEngagementError = (message) => alertMessage('Trip blog', message || 'Unable to save your reaction');
  // Phase 4 (B2/B11) — day-level comment threads, loaded lazily per day the first time it's
  // rendered (see the effect below), separate from the blog document's own GET/engagement fetch
  // (architecture §5.1: "one request per day, not one per target").
  const comments = useBlogComments(backendUrl, headers, activeTripId);
  const connection = useConnectionState();
  const handleCommentError = (message) => alertMessage('Trip blog', message || 'Something went wrong');
  const loadedCommentDays = useRef(new Set());

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
  // B8/Phase 3: authoring (canEdit, unchanged) and engagement (canEngage) are deliberately
  // different gates. `readOnly` means "this viewer is a follower of this trip" (the
  // isFollowingMode prop from App.tsx) — historically that blocked everything, but a follower is
  // allowed to react and comment, only never to author, edit, delete, set covers or publish. The
  // server's authorization matrix is the real enforcement (a follower reacting to a
  // travelers-only item still gets 404); this flag only controls whether the reaction controls
  // render at all — hidden in the public preview, which has no authenticated session's own
  // reaction to show and no server-side identity to attach one to.
  const canEngage = !publicPreview;
  const visibleDays = useMemo(() => (blog?.days || []).map((day) => {
    if (!publicPreview) return day;
    return {
      ...day,
      items: (day.items || []).filter((item) => !item.audience || item.audience === 'public'),
      activities: [],
    };
  }), [blog?.days, publicPreview]);
  const mediaForDay = (day) => (day.items || []).flatMap((item) => {
    if (item.kindKey === 'core.gallery') return (item.assets || []).map((asset) => ({ ...asset, audience: asset.audience ?? item.audience, isGalleryMember: true }));
    return item.kindKey && item.kindKey.startsWith('media.') ? [item] : [];
  });

  const spendTotal = useMemo(() => allExpenses.reduce((sum, expense) => sum + (Number.isFinite(Number(expense?.amount)) ? Number(expense.amount) : 0), 0), [allExpenses]);
  const missingAccessibilityCount = useMemo(() => visibleDays.flatMap((day) => mediaForDay(day)).filter((item) =>
    item.mediaKind === 'photo' && item.audience === 'public' && !String(item.altText || '').trim() && !item.isDecorative
  ).length, [visibleDays]);

  const spotlightForDay = (day) => {
    const ranked = mediaForDay(day).map((item) => ({
      userId: item.uploaderUserId || item.authorUserId,
      total: engagement.getSummary('asset', item.assetId)?.total ?? item.engagement?.reactionTotal ?? 0,
    })).filter((entry) => entry.userId && entry.total > 0).sort((a, b) => b.total - a.total);
    return ranked[0]?.userId ?? null;
  };

  // Fetches each visible day's comment thread once, the first time that day is rendered — never
  // in the public in-app preview, which mirrors the BlogContributorStrip/day-engagement gating
  // just above (no authenticated session's own identity to attach a comment to there).
  useEffect(() => { loadedCommentDays.current.clear(); }, [activeTripId]);
  useEffect(() => {
    if (publicPreview) return;
    for (const day of visibleDays) {
      if (loadedCommentDays.current.has(day.localDate)) continue;
      loadedCommentDays.current.add(day.localDate);
      comments.loadDay(day.localDate).catch(() => { loadedCommentDays.current.delete(day.localDate); });
    }
  }, [visibleDays, publicPreview]);

  // Phase 0 of the visual redesign (docs/trip-blog-social-prd.md §6.2) — the elastic fact strip.
  // Weather/distance/places/media-span were already computed server-side (blogDayFactsService.ts)
  // and simply never reached the UI. Lazy per-day fetch, same shape as the comment-loading effect
  // just above: once per day, skipped entirely for the public in-app preview (no identity to
  // resolve membership against there), and a failure (flag off, rate-limited, etc.) just leaves
  // that day's strip empty rather than surfacing an error — facts are enrichment, never blocking.
  const [dayFacts, setDayFacts] = useState({});
  const loadedFactDays = useRef(new Set());
  useEffect(() => { loadedFactDays.current.clear(); setDayFacts({}); }, [activeTripId]);
  useEffect(() => {
    if (publicPreview) return;
    for (const day of visibleDays) {
      if (loadedFactDays.current.has(day.localDate)) continue;
      loadedFactDays.current.add(day.localDate);
      fetch(`${backendUrl}/api/trips/${activeTripId}/blog/days/${day.localDate}/facts`, { headers })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => { if (data?.facts) setDayFacts((current) => ({ ...current, [day.localDate]: data.facts })); })
        .catch(() => { loadedFactDays.current.delete(day.localDate); });
    }
  }, [visibleDays, publicPreview, backendUrl, activeTripId, headers]);

  // Phase 5 (A1) — Day Starter. For any day the editing traveler has left empty, ask the server
  // for its one deterministic draft suggestion. Same lazy per-day shape as the facts effect above:
  // 204 (dismissed, or the day already has text) is stored as `null` so we don't ask again, and
  // any failure just leaves the day without a card. Keyed by localDate:
  //   undefined = not asked yet · null = nothing to offer · { draft, sources } = a suggestion.
  const [dayStarters, setDayStarters] = useState({});
  const [dayStarterBusy, setDayStarterBusy] = useState(null);
  const loadedStarterDays = useRef(new Set());
  useEffect(() => { loadedStarterDays.current.clear(); setDayStarters({}); }, [activeTripId]);
  useEffect(() => {
    if (publicPreview || readOnly || !editMode || !capabilities.trip_blog_day_starter) return;
    for (const day of visibleDays) {
      if ((day.items || []).length > 0) continue;
      if (loadedStarterDays.current.has(day.localDate)) continue;
      loadedStarterDays.current.add(day.localDate);
      fetch(`${backendUrl}/api/trips/${activeTripId}/blog/days/${day.localDate}/starter`, { headers })
        .then((response) => {
          if (response.status === 204) { setDayStarters((current) => ({ ...current, [day.localDate]: null })); return null; }
          return response.ok ? response.json() : null;
        })
        .then((data) => { if (data?.draft) setDayStarters((current) => ({ ...current, [day.localDate]: { draft: data.draft, sources: data.sources || [] } })); })
        .catch(() => { loadedStarterDays.current.delete(day.localDate); });
    }
  }, [visibleDays, publicPreview, readOnly, editMode, capabilities.trip_blog_day_starter, backendUrl, activeTripId, headers]);

  const acceptDayStarter = async (dayDate) => {
    setDayStarterBusy(dayDate);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/days/${dayDate}/starter/accept`, { method: 'POST', headers });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        alertMessage('Trip blog', data.error || 'Could not use that draft. Please try again.');
        return;
      }
      setDayStarters((current) => ({ ...current, [dayDate]: null }));
      await load();
    } catch {
      alertMessage('Trip blog', 'Could not use that draft. Please try again.');
    } finally {
      setDayStarterBusy(null);
    }
  };

  const dismissDayStarter = async (dayDate) => {
    // Hide immediately; the POST just makes the suppression permanent (FR-A1.3).
    setDayStarters((current) => ({ ...current, [dayDate]: null }));
    try {
      await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/days/${dayDate}/starter/dismiss`, { method: 'POST', headers });
    } catch {
      // A failed dismiss is not worth surfacing — the card is already gone for this session.
    }
  };

  // Phase 1 masthead stat row (redesign proposal — "a real masthead... a small stat row").
  // Day/photo/contributor counts come straight from what's already loaded; distance is
  // best-effort, summed from whichever days' fact strips have resolved so far (parsed back out
  // of the formatted "approx. N km" string rather than adding a second endpoint for one number)
  // — so it fills in progressively and is simply absent, not zero, until at least one day's
  // facts have loaded.
  const tripStats = useMemo(() => {
    const media = visibleDays.flatMap(mediaForDay);
    const photoCount = media.filter((item) => item.mediaKind === 'photo' || item.kindKey === 'media.photo').length;
    const videoCount = media.filter((item) => item.mediaKind === 'video' || item.kindKey === 'media.video').length;
    const contributorIds = new Set();
    visibleDays.forEach((day) => (day.contributors || []).forEach((c) => c.userId && contributorIds.add(c.userId)));
    let distanceKm = 0;
    let hasDistance = false;
    Object.values(dayFacts).forEach((facts: any) => {
      const distanceFact = (facts || []).find((f) => f.key === 'distance');
      const match = distanceFact ? String(distanceFact.value).match(/([\d.]+)\s*km/) : null;
      if (match) { distanceKm += parseFloat(match[1]); hasDistance = true; }
    });
    return {
      dayCount: visibleDays.length,
      photoCount,
      videoCount,
      contributorCount: contributorIds.size,
      distanceKm: hasDistance ? Math.round(distanceKm) : null,
    };
  }, [visibleDays, dayFacts]);

  // Phase 2 route map (redesign proposal §4 "day map... prominent, not utility-panel placement";
  // notes §"Give the trip route... prominent placement") — the whole-trip counterpart to the
  // per-day map already shipped in overview.tsx's day-detail view. Same TripDayMap component,
  // same GET /api/maps/trip-day endpoint, same point-building pattern, just built from every
  // flight/lodging/activity/car-rental in the trip instead of one day's — no new backend work.
  const tripMapPoints = useMemo(() => {
    const points: TripMapPoint[] = [];
    (flights || []).forEach((f: any) => {
      if (f.departure_location) points.push({ kind: 'flight', address: f.departure_location });
      if (f.arrival_location) points.push({ kind: 'flight', address: f.arrival_location });
    });
    (lodgings || []).forEach((l: any) => {
      if (l.address) points.push({ kind: 'lodging', address: l.address });
    });
    (tours || []).forEach((t: any) => {
      if (t.startLocation) points.push({ kind: 'activity', address: t.startLocation });
    });
    (carRentals || []).forEach((r: any) => {
      if (r.pickupLocation) points.push({ kind: 'car_rental', address: r.pickupLocation });
      if (r.dropoffLocation && r.dropoffLocation !== r.pickupLocation) {
        points.push({ kind: 'car_rental', address: r.dropoffLocation });
      }
    });
    return points;
  }, [flights, lodgings, tours, carRentals]);

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
      // Seeds the normalized engagement store from this response's embedded `engagement` fields
      // (architecture §5.4) — never a second fetch. A no-op object when the reactions flag is
      // off, since the field is simply absent from `data` in that case.
      engagement.seedFromBlog(data);
      const lastDay = days[days.length - 1];
      setCursor(days.length >= limit && lastDay ? lastDay.localDate : null);
    } catch (error) {
      alertMessage('Trip blog', error.message || 'Unable to load the trip blog');
    } finally {
      setLoading(false);
    }
  };

  const loadCapabilities = async () => {
    if (!activeTripId) return;
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/capabilities`, { headers });
      if (response.ok) {
        const data = await response.json();
        setCapabilities({ ...(data.features || {}), limits: data.limits || {} });
      }
    } catch {
      setCapabilities({});
    }
  };

  const loadRecap = async (attempt = 0) => {
    if (recapBusy && attempt === 0) return;
    setRecapBusy(true);
    let retryScheduled = false;
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/recap`, { headers });
      const data = await response.json().catch(() => ({}));
      if (response.status === 202 && attempt < 3) {
        retryScheduled = true;
        setTimeout(() => { void loadRecap(attempt + 1); }, Math.min(2000, Math.max(250, Number(data.retryAfterSeconds || 1) * 1000)));
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Unable to build the trip recap');
      setRecap(data.recap || null);
    } catch (error) {
      if (attempt === 0) alertMessage('Trip recap', error.message || 'Unable to build the trip recap');
    } finally {
      if (!retryScheduled) setRecapBusy(false);
    }
  };

  const saveMediaMetadata = async (item, patch) => {
    setMetadataBusyAssetId(item.assetId);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/media/${item.assetId}/metadata`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to save photo details');
      await load();
    } finally { setMetadataBusyAssetId(null); }
  };

  const suggestMediaMetadata = async (item) => {
    setMetadataBusyAssetId(item.assetId);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/media/${item.assetId}/suggest-caption`, { method: 'POST', headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to suggest a caption');
      return data;
    } finally { setMetadataBusyAssetId(null); }
  };

  const loadCoverProposal = async (dayDate) => {
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/days/${dayDate}/cover-proposal`, { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to choose the most-loved photo');
      setCoverProposals((current) => ({ ...current, [dayDate]: data.proposal || null }));
    } catch (error) { alertMessage('Photo of the day', error.message || 'Unable to choose a photo'); }
  };

  const persistItemOrder = async (ids) => {
    setReorderBusy(true);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items/reorder`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds: ids }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to reorder entries');
      await load();
    } catch (error) { alertMessage('Trip blog', error.message || 'Unable to reorder entries'); }
    finally { setReorderBusy(false); }
  };

  const moveItem = async (day, item, offset) => {
    if (reorderBusy) return;
    const ids = (day.items || []).map((entry) => entry.id);
    const from = ids.indexOf(item.id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await persistItemOrder(ids);
  };

  const dropItem = async (day, targetItem) => {
    const sourceId = draggedItemId.current;
    draggedItemId.current = null;
    if (!sourceId || sourceId === targetItem.id || reorderBusy) return;
    const ids = (day.items || []).map((entry) => entry.id);
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(targetItem.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, moved);
    await persistItemOrder(ids);
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
        setDayMetaDrafts({});
        setDayMetaConflicts({});
        setMastheadDraft(null);
        setItemConflicts({});
        // FR-A5.1's "on tab change" flush — leaving edit mode is the in-tab equivalent of
        // switching away, so anything still debouncing gets one last chance to land rather than
        // being silently cancelled by the draft-state clears above.
        void autosave.flushAll();
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
      alertMessage('Photo library access needed', 'Allow photo library access in Settings to add photos or videos to this trip blog.');
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
      alertMessage('Upload', 'Only JPEG/PNG photos or MP4/MOV/WebM videos are supported.');
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
        alertMessage('Upload', parts.join(', '));
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleVoiceNote = async (dayDate) => {
    if (!canEdit || uploading) return;
    const result = await DocumentPicker.getDocumentAsync({ type: SUPPORTED_AUDIO_MIME_TYPES, multiple: false, copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    const mimeType = asset.mimeType || guessMimeTypeFromName(asset.name);
    if (!mimeType || !SUPPORTED_AUDIO_MIME_TYPES.includes(mimeType)) {
      alertMessage('Voice note', 'Choose an MP3, M4A, WAV, or WebM audio file.');
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadBlogFiles(
        { backendUrl, headers, tripId: activeTripId },
        dayDate,
        [{ blob, mimeType, size: asset.size ?? blob.size, name: asset.name }]
      );
      if (!uploaded.succeeded) throw new Error(uploaded.quotaBlocked ? 'Your blog storage is full.' : 'Unable to add the voice note.');
      await load();
    } catch (error) {
      alertMessage('Voice note', error.message || 'Unable to add the voice note.');
    } finally {
      setUploading(false);
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
      alertMessage('Purchase', error.message || 'Failed to start purchase');
    }
  };

  useEffect(() => {
    // Best-effort flush before clearing — a debounced save's closure already captured the
    // *previous* activeTripId at schedule time, so this still lands against the trip the user was
    // actually editing, not wherever they've just navigated to.
    void autosave.flushAll();
    setDrafts({});
    setDayMetaDrafts({});
    setDayMetaConflicts({});
    setMastheadDraft(null);
    setItemConflicts({});
    setCursor(null);
    setEditMode(false);
    setAddingDay(null);
    setPublicationNotice('');
    setCapabilities({});
    setRecap(null);
    setCoverProposals({});
    void refreshBlogAndPublication();
    void loadCapabilities();
  }, [activeTripId]);

  const loadMore = () => {
    if (cursor && !loading) {
      void load(cursor);
    }
  };

  // FR-A5.1–A5.3: the item body's autosave. Every value the request needs (`html`, `version`) is
  // passed in explicitly rather than read from component state inside the function body — the
  // closure `useAutosave` holds onto fires up to 1.5s after it was created, by which point several
  // renders (and several state updates) may have happened, so reading `drafts[item.id]` or
  // `itemConflicts[item.id]` *inside* this function would silently send a stale value. The one
  // piece of state this legitimately reads-then-writes is `itemConflicts`, and only to record a
  // *new* conflict — never to decide what to send.
  const saveItemBody = async (item, html, version) => {
    const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items/${item.id}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: html, version }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) {
      setItemConflicts((current) => ({ ...current, [item.id]: data.latest ?? null }));
      throw new Error(data.error || 'Someone else edited this while you were writing');
    }
    if (!response.ok) throw new Error(data.error || 'Unable to save');
    setItemConflicts((current) => ({ ...current, [item.id]: null }));
    await load();
  };

  // Called on every keystroke from the rich text editor. Reads `itemConflicts[item.id]`
  // synchronously here — not inside a later-firing closure — which is the one place in this flow
  // where reading current state is actually safe, because `scheduleItemSave` itself always runs
  // synchronously inside the event that triggered it.
  const scheduleItemSave = (item, html) => {
    setDrafts((current) => ({ ...current, [item.id]: html }));
    const version = itemConflicts[item.id]?.version ?? item.version;
    autosave.schedule(`item-${item.id}`, () => saveItemBody(item, html, version));
  };

  const keepMineItem = async (item) => {
    // Retry once against the exact version the conflict told us was latest — never an unbounded
    // force-write. If someone changed it again in the meantime, this produces a fresh conflict
    // rather than silently overwriting (architecture §5.5). Calls saveItemBody directly rather
    // than autosave.flush(): once a scheduled save has already fired and failed, the scheduler has
    // nothing left queued to flush.
    const latest = itemConflicts[item.id];
    if (!latest) return;
    try {
      await saveItemBody(item, drafts[item.id] ?? '', latest.version);
    } catch (error) { alertMessage('Trip blog', error.message || 'Unable to save'); }
  };

  const useTheirsItem = (item) => {
    const latest = itemConflicts[item.id];
    if (!latest) return;
    setDrafts((current) => ({ ...current, [item.id]: latest.body ?? '' }));
    setItemConflicts((current) => ({ ...current, [item.id]: null }));
    autosave.cancel(`item-${item.id}`);
  };

  // "Show both" keeps the server's item untouched and creates one new adjacent core.text item
  // from the local draft — it does not try to merge the two HTML bodies automatically.
  const showBothItem = async (item) => {
    const localBody = drafts[item.id] ?? '';
    setItemConflicts((current) => ({ ...current, [item.id]: null }));
    autosave.cancel(`item-${item.id}`);
    setDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kindKey: 'core.text', dayDate: item.localDate, body: localBody }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to save your draft as a new note');
      await load();
    } catch (error) { alertMessage('Trip blog', error.message || 'Unable to save your draft as a new note'); }
  };

  // A3/FR-A3.3: day headline/summary autosave, same explicit-parameter shape as the item-body
  // flow above but against PATCH /:tripId/blog/days/:dayDate and blog_days.update_version.
  const saveDayMeta = async (day, headline, summary, version) => {
    const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/days/${day.localDate}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ headline, summary, updateVersion: version }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) {
      setDayMetaConflicts((current) => ({ ...current, [day.localDate]: data.latest ?? null }));
      throw new Error(data.error || 'Someone else edited this day while you were writing');
    }
    if (!response.ok) throw new Error(data.error || 'Unable to save');
    setDayMetaConflicts((current) => ({ ...current, [day.localDate]: null }));
    // Sync baseVersion from the server's response immediately rather than waiting on the
    // in-flight load() below to land — the next keystroke can otherwise race a stale version.
    setDayMetaDrafts((current) => current[day.localDate] ? { ...current, [day.localDate]: { ...current[day.localDate], baseVersion: data.updateVersion } } : current);
    await load();
  };

  const scheduleDayMetaSave = (day, patch) => {
    // Computed *before* setDayMetaDrafts, from state as it stands right now — not inside the
    // setState updater callback, whose own invocation React defers to the batched-update flush
    // rather than running inline. Reading `dayMetaDrafts[day.localDate]` here is safe because
    // nothing in this synchronous handler has changed it yet.
    const currentDraft = dayMetaDrafts[day.localDate];
    const nextDraft = {
      headline: currentDraft?.headline ?? (day.headline ?? ''),
      summary: currentDraft?.summary ?? (day.summary ?? ''),
      baseVersion: currentDraft?.baseVersion ?? (day.updateVersion ?? 1),
      ...patch,
    };
    setDayMetaDrafts((current) => ({ ...current, [day.localDate]: nextDraft }));
    const version = dayMetaConflicts[day.localDate]?.updateVersion ?? nextDraft.baseVersion;
    autosave.schedule(`day-meta-${day.localDate}`, () => saveDayMeta(day, nextDraft.headline, nextDraft.summary, version));
  };

  const keepMineDayMeta = async (day) => {
    const latest = dayMetaConflicts[day.localDate];
    const draft = dayMetaDrafts[day.localDate];
    if (!latest || !draft) return;
    try {
      await saveDayMeta(day, draft.headline, draft.summary, latest.updateVersion);
    } catch (error) { alertMessage('Trip blog', error.message || 'Unable to save'); }
  };

  const useTheirsDayMeta = (day) => {
    const latest = dayMetaConflicts[day.localDate];
    if (!latest) return;
    setDayMetaDrafts((current) => ({
      ...current,
      [day.localDate]: { headline: latest.headline ?? '', summary: latest.summary ?? '', baseVersion: latest.updateVersion ?? 1 },
    }));
    setDayMetaConflicts((current) => ({ ...current, [day.localDate]: null }));
    autosave.cancel(`day-meta-${day.localDate}`);
  };

  // A4: blog masthead autosave. No conflict path — see the comment on updateBlogMeta server-side.
  const saveMasthead = async (patch) => {
    const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to save');
    await load();
  };

  const scheduleMastheadSave = (patch) => {
    // Same reasoning as scheduleDayMetaSave above: compute before the setState call, not inside
    // its updater.
    const nextDraft = {
      title: mastheadDraft?.title ?? (blog?.title ?? ''),
      subtitle: mastheadDraft?.subtitle ?? (blog?.subtitle ?? ''),
      introduction: mastheadDraft?.introduction ?? (blog?.introduction ?? ''),
      ...patch,
    };
    setMastheadDraft(nextDraft);
    autosave.schedule('masthead', () => saveMasthead(nextDraft));
  };

  const createTextItem = async (dayDate) => {
    if (!canEdit) return;
    const body = newBody;
    if (isRichTextEmpty(body)) return;
    setCreating(true);
    try {
      if (connection.status === 'offline' && capabilities.trip_blog_offline_queue && currentUserId) {
        const queued = await enqueueOfflineBlogEntry(
          { accountId: currentUserId, tripId: activeTripId, dayDate, body },
          Number(capabilities?.limits?.offlineQueueMaxEntries ?? 25),
          Number(capabilities?.limits?.offlineQueueRetentionDays ?? 7)
        );
        setOfflineQueueCount(queued.length);
        setNewBody('');
        setAddingDay(null);
        return;
      }
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kindKey: 'core.text', dayDate, body }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to add blog item');
      setNewBody('');
      setAddingDay(null);
      await load();
    } catch (error) { alertMessage('Trip blog', error.message || 'Unable to add blog item'); }
    finally { setCreating(false); }
  };

  useEffect(() => {
    if (!capabilities.trip_blog_offline_queue || !currentUserId || !activeTripId) {
      setOfflineQueueCount(0);
      return;
    }
    const retentionDays = Number(capabilities?.limits?.offlineQueueRetentionDays ?? 7);
    void listOfflineBlogEntries(currentUserId, activeTripId, retentionDays).then((rows) => setOfflineQueueCount(rows.length));
    if (connection.status !== 'online') return;
    void flushOfflineBlogEntries(currentUserId, activeTripId, async (entry) => {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': entry.id },
        body: JSON.stringify({ kindKey: 'core.text', dayDate: entry.dayDate, body: entry.body }),
      });
      if (!response.ok) throw new Error('Offline entry flush failed');
    }, retentionDays).then(({ remaining, sent }) => {
      setOfflineQueueCount(remaining.length);
      if (sent > 0) void load();
    });
  }, [activeTripId, currentUserId, connection.status, capabilities.trip_blog_offline_queue]);

  const deleteItem = async (item) => {
    if (!canEdit) return;
    setDeleting(true);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items/${item.id}`, {
        method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ version: item.version }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to remove blog item');
      await load();
    } catch (error) { alertMessage('Trip blog', error.message || 'Unable to remove blog item'); }
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
    } catch (error) { alertMessage('Trip blog', error.message || 'Unable to set the day cover'); }
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
    } catch (error) { alertMessage('Trip blog', error.message || 'Unable to remove photo'); }
    finally { setDeleting(false); }
  };
  const removeMediaItem = (item) => (item.isGalleryMember ? removeGalleryAsset(item.assetId) : deleteItem(item));

  if (!activeTripId) return <View style={{ padding: 18 }}><Text style={styles.sectionTitle}>Select a trip to write its blog.</Text></View>;
  if (loading) return <View style={{ padding: 18, alignItems: 'center' }}><ActivityIndicator /></View>;
  const publicationState = publication?.state ?? blog?.visibilityState ?? 'private';
  const hasPendingConsent = publicationState === 'pending_consent' && publication?.userDecision === 'pending';
  // FR-A5.2: a visible Saving…/Saved/Not saved state for any autosaved field, shared by the
  // masthead, every day's headline/summary, and every item body.
  const saveStateLabel = (key) => {
    const state = autosave.states[key];
    if (!state || state.status === 'idle') return null;
    if (state.status === 'pending') return 'Editing…';
    if (state.status === 'saving') return 'Saving…';
    if (state.status === 'saved') return `Saved ${new Date(state.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return 'Not saved — retrying';
  };
  // Phase 0 of the visual redesign — the trip blog gets its own page shell (renderBoundedPage in
  // App.tsx) instead of the shared renderSharedPageScroll wrapper every other tab uses, so this is
  // the only ScrollView in the tree (the old nesting put a second ScrollView here inside that
  // shared one). It also stops wrapping the entire page in the generic `styles.card` used by every
  // other tab — the masthead below gets its own quiet surface, and each day becomes its own
  // "chapter" further down, rather than one long bordered form.
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator
      >
        <View style={{ width: '100%', maxWidth: 1200, alignSelf: 'center', gap: 20 }}>
      <View style={{ backgroundColor: surfaceColor, borderRadius: 16, padding: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {canEdit ? (
            <View style={{ flex: 1 }}>
              <TextInput
                testID="blog-masthead-title-input"
                value={mastheadDraft?.title ?? (blog?.title ?? '')}
                onChangeText={(text) => scheduleMastheadSave({ title: text.slice(0, 200) })}
                placeholder="Trip Blog"
                placeholderTextColor={mutedColor}
                style={[styles.sectionTitle, { color: textColor, padding: 0, fontFamily: displayFont, fontSize: 26 }]}
              />
              <TextInput
                testID="blog-masthead-subtitle-input"
                value={mastheadDraft?.subtitle ?? (blog?.subtitle ?? '')}
                onChangeText={(text) => scheduleMastheadSave({ subtitle: text.slice(0, 300) })}
                placeholder="Add a subtitle…"
                placeholderTextColor={mutedColor}
                style={{ color: mutedColor, fontSize: 14, marginTop: 2, padding: 0 }}
              />
              {saveStateLabel('masthead') ? <Text style={{ color: mutedColor, fontSize: 11, marginTop: 2 }}>{saveStateLabel('masthead')}</Text> : null}
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionTitle, { fontFamily: displayFont, fontSize: 26 }]}>{blog?.title || 'Trip Blog'}</Text>
              {blog?.subtitle ? <Text style={{ color: mutedColor, fontSize: 14, marginTop: 2, fontFamily: displayFontItalic }}>{blog.subtitle}</Text> : null}
            </View>
          )}
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
          {canEdit && ((Platform.OS === 'ios' && capabilities.trip_blog_mobile_share_ios) || (Platform.OS === 'android' && capabilities.trip_blog_mobile_share_android)) ? (
            <TouchableOpacity testID="blog-quick-capture" accessibilityRole="button" onPress={() => { const today = new Date().toISOString().slice(0, 10); const day = visibleDays.find((candidate) => candidate.localDate === today)?.localDate ?? visibleDays[0]?.localDate; if (day) { setAddingDay(day); setNewBody(''); } }} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
              <Text style={{ color: theme?.colors?.link ?? '#0ea5e9', fontWeight: '700' }}>Quick capture</Text>
            </TouchableOpacity>
          ) : null}
          {capabilities.trip_blog_keepsake_export ? <BlogKeepsakeButton backendUrl={backendUrl} headers={headers} tripId={activeTripId} textColor={theme?.colors?.link ?? '#0ea5e9'} /> : null}
        </View>
        {/* Phase 1 masthead stat row (redesign proposal §1) — the "trip at a glance" strip. */}
        <View testID="blog-trip-stats" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6, marginBottom: 10 }}>
          <Text style={{ color: mutedColor, fontSize: 13 }}>
            <Text style={{ fontWeight: '700', color: textColor }}>{tripStats.dayCount}</Text> {tripStats.dayCount === 1 ? 'day' : 'days'}
          </Text>
          {tripStats.photoCount > 0 ? (
            <Text style={{ color: mutedColor, fontSize: 13 }}>
              <Text style={{ fontWeight: '700', color: textColor }}>{tripStats.photoCount}</Text> {tripStats.photoCount === 1 ? 'photo' : 'photos'}
            </Text>
          ) : null}
          {tripStats.videoCount > 0 ? (
            <Text style={{ color: mutedColor, fontSize: 13 }}>
              <Text style={{ fontWeight: '700', color: textColor }}>{tripStats.videoCount}</Text> {tripStats.videoCount === 1 ? 'video' : 'videos'}
            </Text>
          ) : null}
          {tripStats.contributorCount > 0 ? (
            <Text style={{ color: mutedColor, fontSize: 13 }}>
              <Text style={{ fontWeight: '700', color: textColor }}>{tripStats.contributorCount}</Text> {tripStats.contributorCount === 1 ? 'traveler' : 'travelers'}
            </Text>
          ) : null}
          {tripStats.distanceKm != null ? (
            <Text style={{ color: mutedColor, fontSize: 13 }}>
              approx. <Text style={{ fontWeight: '700', color: textColor }}>{tripStats.distanceKm}</Text> km
            </Text>
          ) : null}
        </View>
        {tripMapPoints.length ? (
          <TripDayMap points={tripMapPoints} backendUrl={backendUrl} requestHeaders={headers} testID="trip-blog-route-map" />
        ) : null}
        <Text style={{ color: mutedColor, marginBottom: 12 }}>
          {editMode
            ? 'Editing mode — changes are saved to the trip blog.'
            : publicPreview
              ? 'Public preview — only content intended for public sharing is shown.'
              : 'Traveler/follower view — all shared trip blog content is shown.'}
        </Text>
        {capabilities.trip_blog_offline_queue && offlineQueueCount > 0 ? (
          <View testID="blog-offline-queue-status" style={{ padding: 10, borderWidth: 1, borderColor: '#f59e0b', borderRadius: 8, marginBottom: 12, backgroundColor: '#fffbeb' }}>
            <Text style={{ color: '#92400e', fontWeight: '700' }}>{offlineQueueCount} {offlineQueueCount === 1 ? 'entry is' : 'entries are'} saved on this device</Text>
            <Text style={{ color: '#92400e', fontSize: 12 }}>{connection.status === 'online' ? 'Syncing now…' : 'They will publish when this device reconnects.'}</Text>
          </View>
        ) : null}
        {canEdit ? (
          <TextInput
            testID="blog-masthead-introduction-input"
            value={mastheadDraft?.introduction ?? (blog?.introduction ?? '')}
            onChangeText={(text) => scheduleMastheadSave({ introduction: text.slice(0, 5000) })}
            placeholder="Add an introduction for readers of this blog…"
            placeholderTextColor={mutedColor}
            multiline
            style={{ color: textColor, borderWidth: 1, borderColor, borderRadius: 8, padding: 8, marginBottom: 4, minHeight: 44, backgroundColor: inputColor }}
          />
        ) : (blog?.introduction ? <Text style={{ color: textColor, marginBottom: 4 }}>{blog.introduction}</Text> : null)}
      </View>
        {visibleDays.map((day) => {
          const dayMetaDraft = dayMetaDrafts[day.localDate];
          const dayMetaConflict = dayMetaConflicts[day.localDate];
          const dayHeadline = dayMetaDraft?.headline ?? (day.headline ?? '');
          const daySummary = dayMetaDraft?.summary ?? (day.summary ?? '');
          // Phase 1 hero-photo day card (redesign proposal §2) — only in reading mode: editing
          // stays the plain workspace layout below (overlaying text inputs on a photo is bad for
          // both legibility and hit-testing), so a traveler writing today's entry always sees
          // clear fields, and everyone else sees the day as a photo with a caption.
          const dayCoverItem = day.coverItemId ? mediaForDay(day).find((item) => item.id === day.coverItemId) : null;
          const dayCoverUrl = dayCoverItem?.primaryUrl || dayCoverItem?.thumbnailUrl || null;
          const dayWeatherFact = (dayFacts[day.localDate] || []).find((f) => f.key === 'weather');
          const showHeroHeader = !canEdit && dayCoverUrl;
          return (
          <View
            key={day.id}
            style={{
              marginBottom: 20,
              backgroundColor: canEdit ? (theme?.colors?.surfaceMuted ?? '#f3f4f6') : surfaceColor,
              borderRadius: 16,
              padding: 18,
              ...(canEdit ? { borderWidth: 1, borderColor: theme?.colors?.link ?? borderColor, borderStyle: 'dashed' as const } : {}),
            }}
          >
            {showHeroHeader ? (
              <ImageBackground
                testID={`blog-day-hero-${day.localDate}`}
                source={{ uri: dayCoverUrl }}
                style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 10, minHeight: 160 }}
                imageStyle={{ borderRadius: 12 }}
              >
                <LinearGradient
                  colors={['rgba(11,23,38,0)', 'rgba(11,23,38,0.05)', 'rgba(11,23,38,0.78)']}
                  style={{ minHeight: 160, justifyContent: 'flex-end', padding: 16, borderRadius: 12 }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 }}>
                    {formatDateLong(day.localDate)}{dayWeatherFact ? `  ·  ${dayWeatherFact.value}` : ''}
                  </Text>
                  <Text style={{ color: '#fff', fontSize: 24, fontFamily: displayFont, marginTop: 2 }}>
                    {day.headline || formatDateLong(day.localDate)}
                  </Text>
                  {day.summary ? (
                    <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14, marginTop: 4, fontFamily: displayFontItalic }}>{day.summary}</Text>
                  ) : null}
                </LinearGradient>
              </ImageBackground>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: canEdit ? 'flex-start' : 'center', marginBottom: 8, display: showHeroHeader && !canEdit ? 'none' as const : 'flex' as const }}>
              {canEdit ? (
                <View style={{ flex: 1, marginRight: 8 }}>
                  <TextInput
                    testID={`blog-day-headline-input-${day.localDate}`}
                    value={dayHeadline}
                    onChangeText={(text) => scheduleDayMetaSave(day, { headline: text.slice(0, 120) })}
                    placeholder={day.localDate}
                    placeholderTextColor={mutedColor}
                    style={[styles.sectionTitle, { color: textColor, padding: 0 }]}
                  />
                  <Text style={{ color: mutedColor, fontSize: 11, marginTop: 1 }}>{day.localDate}</Text>
                  <TextInput
                    testID={`blog-day-summary-input-${day.localDate}`}
                    value={daySummary}
                    onChangeText={(text) => scheduleDayMetaSave(day, { summary: text.slice(0, 500) })}
                    placeholder="Add a one-line summary of this day…"
                    placeholderTextColor={mutedColor}
                    style={{ color: mutedColor, fontSize: 13, marginTop: 4, padding: 0 }}
                  />
                  {saveStateLabel(`day-meta-${day.localDate}`) ? (
                    <Text style={{ color: mutedColor, fontSize: 11, marginTop: 2 }}>{saveStateLabel(`day-meta-${day.localDate}`)}</Text>
                  ) : null}
                  {dayMetaConflict ? (
                    <BlogConflictBanner
                      testID={`blog-day-meta-conflict-${day.localDate}`}
                      latest={dayMetaConflict}
                      onKeepMine={() => keepMineDayMeta(day)}
                      onUseTheirs={() => useTheirsDayMeta(day)}
                      textColor={textColor}
                      mutedColor={mutedColor}
                      styles={styles}
                      theme={theme}
                    />
                  ) : null}
                </View>
              ) : (
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>{day.headline || day.localDate}</Text>
                  {day.headline ? <Text style={{ color: mutedColor, fontSize: 11 }}>{day.localDate}</Text> : null}
                  {day.summary ? <Text style={{ color: mutedColor, fontSize: 13, marginTop: 2 }}>{day.summary}</Text> : null}
                </View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {canEdit && (
                  <TouchableOpacity
                    style={[styles.button, { paddingVertical: 4, paddingHorizontal: 8 }]}
                    onPress={() => { setAddingDay(day.localDate); setNewBody(''); }}
                  >
                    <Text style={[styles.buttonText, { fontSize: 12 }]}>+ Add note</Text>
                  </TouchableOpacity>
                )}
                {canEdit && capabilities.trip_blog_audio ? (
                  <TouchableOpacity
                    testID={`blog-add-voice-${day.localDate}`}
                    accessibilityRole="button"
                    accessibilityLabel="Add a voice note"
                    style={[styles.button, { paddingVertical: 4, paddingHorizontal: 8, backgroundColor: theme?.colors?.link ?? '#7c3aed' }]}
                    onPress={() => handleVoiceNote(day.localDate)}
                    disabled={uploading}
                  >
                    <Text style={[styles.buttonText, { fontSize: 12 }]}>+ Voice note</Text>
                  </TouchableOpacity>
                ) : null}
                {canEdit && (
                  <TouchableOpacity
                    style={[styles.button, { paddingVertical: 4, paddingHorizontal: 8, backgroundColor: '#0ea5e9' }]}
                    onPress={() => handleUpload(day.localDate)}
                    disabled={uploading}
                  >
                    <Text style={[styles.buttonText, { fontSize: 12 }]}>{uploading ? (uploadProgress ? `${uploadProgress.current}/${uploadProgress.total}…` : '…') : '+ Photo/Video'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {/* Phase 0 elastic fact strip (docs/trip-blog-social-prd.md §6.2, FR-C1.1) — chips with
                no data are absent, not greyed out, so a photos-only day still reads as intentional.
                Weather moved here from the old header pill; distance/places/media are newly
                surfaced from an endpoint the client never called before this redesign.
                Phase 2: `dayMap`'s value is a signed image URL (the background render job's
                static map artifact), not display text — it gets its own thumbnail rather than
                being stringified into a text chip like every other fact. */}
            {dayFacts[day.localDate]?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 4, marginBottom: 4 }}>
                {dayFacts[day.localDate].filter((fact) => fact.key !== 'dayMap').map((fact) => (
                  <View
                    key={fact.key}
                    testID={`blog-day-fact-${day.localDate}-${fact.key}`}
                    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme?.colors?.surfaceMuted ?? '#f0f9ff', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 }}
                  >
                    <Text style={{ fontSize: 12.5, fontWeight: '600', color: theme?.colors?.link ?? '#0369a1' }}>
                      {fact.key === 'weather' ? fact.value : `${fact.label}: ${fact.value}`}
                    </Text>
                  </View>
                ))}
                {(() => {
                  const mapFact = dayFacts[day.localDate].find((fact) => fact.key === 'dayMap');
                  if (!mapFact) return null;
                  return (
                    <Image
                      testID={`blog-day-fact-${day.localDate}-dayMap`}
                      source={{ uri: mapFact.value }}
                      accessibilityLabel="Map of this day's route"
                      style={{ width: 100, height: 52, borderRadius: 10, backgroundColor: theme?.colors?.surfaceMuted ?? '#f0f9ff' }}
                      resizeMode="cover"
                    />
                  );
                })()}
              </View>
            ) : null}
            {(day.items || []).filter((item) => item.kindKey !== 'core.gallery' && !(item.kindKey && item.kindKey.startsWith('media.'))).map((item) => (
              <View
                key={item.id}
                style={{ marginTop: 8 }}
                {...(Platform.OS === 'web' && canEdit && capabilities.trip_blog_authoring_assist ? {
                  draggable: true,
                  onDragStart: (event) => {
                    draggedItemId.current = item.id;
                    event?.dataTransfer?.setData?.('text/plain', item.id);
                  },
                  onDragOver: (event) => event?.preventDefault?.(),
                  onDrop: (event) => { event?.preventDefault?.(); void dropItem(day, item); },
                } : {})}
              >
                {canEdit && capabilities.trip_blog_authoring_assist ? <Text style={{ color: mutedColor, fontSize: 11, marginBottom: 3 }}>⠿ Drag to reorder</Text> : null}
                {item.sourceId ? <Text style={{ color: mutedColor, fontSize: 12, marginBottom: 4 }}>{item.sourceDetached ? 'Copied from trip note/location · independent' : 'Linked to trip note/location · editing here disconnects it'}</Text> : null}
                {canEdit ? (
                  <BlogRichTextEditor
                    key={item.id}
                    testID={`blog-item-editor-${item.id}`}
                    value={drafts[item.id] ?? item.body}
                    onChangeHTML={(html) => scheduleItemSave(item, html)}
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
                {item.engagement ? (
                  <BlogReactionBar
                    testID={`blog-item-reactions-${item.id}`}
                    targetKind="item"
                    targetId={item.id}
                    summary={engagement.getSummary('item', item.id)}
                    canEngage={canEngage}
                    onToggle={engagement.toggle}
                    onError={handleEngagementError}
                    textColor={textColor}
                    mutedColor={mutedColor}
                    theme={theme}
                    size="compact"
                  />
                ) : null}
                {canEdit ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      {/* FR-A5.1/A5.2: the explicit Save button is gone — edits autosave 1.5s after
                          the last keystroke, and this text is the only save-state affordance. */}
                      {saveStateLabel(`item-${item.id}`) ? (
                        <Text style={{ color: mutedColor, fontSize: 12 }}>{saveStateLabel(`item-${item.id}`)}</Text>
                      ) : null}
                      {capabilities.trip_blog_authoring_assist ? (
                        <>
                          <TouchableOpacity accessibilityLabel="Move entry up" disabled={reorderBusy || (day.items || [])[0]?.id === item.id} onPress={() => moveItem(day, item, -1)} style={{ padding: 6 }}><Text style={{ color: textColor }}>↑</Text></TouchableOpacity>
                          <TouchableOpacity accessibilityLabel="Move entry down" disabled={reorderBusy || (day.items || [])[(day.items || []).length - 1]?.id === item.id} onPress={() => moveItem(day, item, 1)} style={{ padding: 6 }}><Text style={{ color: textColor }}>↓</Text></TouchableOpacity>
                        </>
                      ) : null}
                      <TouchableOpacity style={[styles.button, { backgroundColor: theme?.colors?.error ?? '#b91c1c' }]} disabled={deleting} onPress={() => deleteItem(item)}><Text style={styles.buttonText}>{deleting ? 'Removing…' : 'Remove'}</Text></TouchableOpacity>
                    </View>
                    {itemConflicts[item.id] ? (
                      <BlogConflictBanner
                        testID={`blog-item-conflict-${item.id}`}
                        latest={itemConflicts[item.id]}
                        onKeepMine={() => keepMineItem(item)}
                        onUseTheirs={() => useTheirsItem(item)}
                        onShowBoth={() => showBothItem(item)}
                        textColor={textColor}
                        mutedColor={mutedColor}
                        styles={styles}
                        theme={theme}
                      />
                    ) : null}
                  </>
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
                  return (item.assets || []).map((asset) => ({ ...asset, audience: asset.audience ?? item.audience, isGalleryMember: true }));
                }
                return item.kindKey && item.kindKey.startsWith('media.') ? [item] : [];
              });
              const readyMedia = allMedia.filter((item) => item.thumbnailUrl || item.primaryUrl);
              const processingMedia = allMedia.filter((item) => !(item.thumbnailUrl || item.primaryUrl));
              return (
                <>
                  {readyMedia.length ? (
                    <>
                      {canEdit && capabilities.trip_blog_reactions ? (
                        <TouchableOpacity testID={`blog-cover-proposal-${day.localDate}`} onPress={() => loadCoverProposal(day.localDate)} style={{ alignSelf: 'flex-start', paddingVertical: 5, marginTop: 5 }}>
                          <Text style={{ color: theme?.colors?.link ?? '#7c3aed', fontWeight: '700' }}>{coverProposals[day.localDate] ? '♥ Most-loved photo selected below' : 'Find the most-loved photo'}</Text>
                        </TouchableOpacity>
                      ) : null}
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
                        canEngage={canEngage}
                        getEngagementSummary={(assetId) => engagement.getSummary('asset', assetId)}
                        onToggleReaction={engagement.toggle}
                        onReactionError={handleEngagementError}
                        theme={theme}
                        canEditMetadata={canEdit && capabilities.trip_blog_alt_text}
                        canSuggestMetadata={canEdit && capabilities.trip_blog_caption_ai}
                        metadataBusy={Boolean(metadataBusyAssetId)}
                        onSaveMetadata={saveMediaMetadata}
                        onSuggestMetadata={suggestMediaMetadata}
                        proposedCoverAssetId={coverProposals[day.localDate]?.assetId}
                      />
                    </>
                  ) : null}
                  {processingMedia.map((item) => (
                    <View key={item.id} style={{ borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor: inputColor, marginTop: 8 }}>
                      <Text style={{ color: textColor, fontWeight: '600' }}>{item.kindKey === 'media.video' ? '🎬 Video' : item.kindKey === 'media.audio' ? '🎙 Voice note' : '📷 Photo'} — {item.state === 'ready' ? 'processed, no preview available' : (item.state || 'processing')}</Text>
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
                    canEngage={canEngage}
                    getEngagementSummary={(assetId) => engagement.getSummary('asset', assetId)}
                    onToggleReaction={engagement.toggle}
                    onReactionError={handleEngagementError}
                    theme={theme}
                    currentUserId={currentUserId}
                    canModerate={isTripOwnerOrAdmin}
                    audienceLabel={blog?.visibilityState === 'public' ? 'Visible publicly' : (readOnly ? 'Visible to followers' : 'Visible to travelers')}
                    getComments={(assetId) => comments.getCommentsForTarget(day.localDate, 'asset', assetId)}
                    onPostComment={(assetId, body, parentCommentId) => comments.postComment(day.localDate, 'asset', assetId, body, parentCommentId)}
                    onEditComment={(commentId, body) => comments.editComment(day.localDate, commentId, body)}
                    onDeleteComment={(commentId) => comments.deleteComment(day.localDate, commentId)}
                    onReportComment={(commentId, reason) => comments.reportComment(commentId, reason)}
                    onHideComment={(commentId) => comments.hideComment(day.localDate, commentId)}
                    onUnhideComment={(commentId) => comments.unhideComment(day.localDate, commentId)}
                    onShowEarlierReplies={(commentId) => comments.loadMoreReplies(day.localDate, commentId)}
                    onCommentError={handleCommentError}
                  />
                </>
              );
            })()}
            {/* Phase 0 reorder (docs/trip-blog-social-prd.md §6.2 / redesign notes §2) — contributor
                attribution, the day's own reaction bar, and the comment thread now come after the
                story and its media, not before it, so a reader meets the day before its metadata. */}
            {!publicPreview && (day.contributors || []).length > 0 ? (
              <BlogContributorStrip
                testID={`blog-day-contributors-${day.localDate}`}
                contributors={day.contributors}
                reactionTotal={day.engagement?.reactionTotal}
                spotlightUserId={spotlightForDay(day)}
                mutedColor={mutedColor}
              />
            ) : null}
            {day.engagement ? (
              <View style={{ marginTop: (!publicPreview && (day.contributors || []).length > 0) ? 6 : 12 }}>
                <BlogReactionBar
                  testID={`blog-day-reactions-${day.localDate}`}
                  targetKind="day"
                  targetId={day.id}
                  summary={engagement.getSummary('day', day.id)}
                  canEngage={canEngage}
                  onToggle={engagement.toggle}
                  onError={handleEngagementError}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  theme={theme}
                  size="compact"
                />
              </View>
            ) : null}
            {!publicPreview && day.engagement ? (
              <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: borderColor, paddingTop: 8 }}>
                <BlogCommentThread
                  testID={`blog-day-comments-${day.localDate}`}
                  comments={comments.getDayState(day.localDate).comments.filter((c) => c.targetKind === 'day' && c.targetId === day.id)}
                  targetKind="day"
                  targetId={day.id}
                  audienceLabel={blog?.visibilityState === 'public' ? 'Visible publicly' : (readOnly ? 'Visible to followers' : 'Visible to travelers')}
                  currentUserId={currentUserId}
                  canModerate={isTripOwnerOrAdmin}
                  canEngage={canEngage}
                  onPostTopLevel={(body) => comments.postComment(day.localDate, 'day', day.id, body)}
                  onReply={(parentCommentId, body) => comments.postComment(day.localDate, 'day', day.id, body, parentCommentId)}
                  onEdit={(commentId, body) => comments.editComment(day.localDate, commentId, body)}
                  onDelete={(commentId) => comments.deleteComment(day.localDate, commentId)}
                  onReport={(commentId, reason) => comments.reportComment(commentId, reason)}
                  onHide={(commentId) => comments.hideComment(day.localDate, commentId)}
                  onUnhide={(commentId) => comments.unhideComment(day.localDate, commentId)}
                  onShowEarlierReplies={(commentId) => comments.loadMoreReplies(day.localDate, commentId)}
                  onError={handleCommentError}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  borderColor={borderColor}
                  backgroundColor={inputColor}
                  styles={styles}
                  theme={theme}
                />
              </View>
            ) : null}
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
                {capabilities.trip_blog_authoring_assist ? (
                  <View testID={`blog-writing-prompts-${day.localDate}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {promptsForDay(day.localDate).map((prompt) => (
                      <TouchableOpacity key={prompt} accessibilityRole="button" onPress={() => setNewBody(`<p><strong>${prompt}</strong></p><p></p>`)} style={{ borderWidth: 1, borderColor, borderRadius: 16, paddingVertical: 5, paddingHorizontal: 9, backgroundColor: inputColor }}>
                        <Text style={{ color: textColor, fontSize: 12 }}>{prompt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
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
            {canEdit && (day.items || []).length === 0 && addingDay !== day.localDate ? (
              <View>
                {dayStarters[day.localDate]?.draft ? (
                  <BlogDayStarterCard
                    testID={`blog-day-starter-${day.localDate}`}
                    draft={dayStarters[day.localDate].draft}
                    busy={dayStarterBusy === day.localDate}
                    onUse={() => acceptDayStarter(day.localDate)}
                    onDismiss={() => dismissDayStarter(day.localDate)}
                    displayFont={displayFont}
                    textColor={textColor}
                    mutedColor={mutedColor}
                    borderColor={borderColor}
                    backgroundColor={inputColor}
                    accentColor={theme?.colors?.link ?? '#2E96A6'}
                    styles={styles}
                  />
                ) : null}
                <Text style={{ color: mutedColor }}>
                  {dayStarters[day.localDate]?.draft ? 'Or start from scratch — click “+ Add note”.' : 'No notes yet. Click “+ Add note” to start this day.'}
                </Text>
                {capabilities.trip_blog_authoring_assist ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {promptsForDay(day.localDate).map((prompt) => (
                      <TouchableOpacity key={prompt} onPress={() => { setAddingDay(day.localDate); setNewBody(`<p><strong>${prompt}</strong></p><p></p>`); }} style={{ borderWidth: 1, borderColor, borderRadius: 16, paddingVertical: 5, paddingHorizontal: 9 }}>
                        <Text style={{ color: textColor, fontSize: 12 }}>{prompt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          );
        })}
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
        {/* Phase 0 reorder — the recap is the "Relive this trip" moment (redesign notes §1), kept
            prominent after the last day rather than buried above the story. */}
        {capabilities.trip_blog_recap ? (
          <View style={{ marginTop: 8 }}>
            {recap ? (
              <TripRecapCards
                recap={recap}
                topPhotoUrl={visibleDays.flatMap(mediaForDay).find((item) => item.assetId === recap?.topPhoto?.assetId)?.primaryUrl}
                spendTotal={capabilities.trip_blog_spend_summary && !readOnly ? spendTotal : null}
                currency={tripCurrency}
                textColor={textColor}
                mutedColor={mutedColor}
                borderColor={borderColor}
                backgroundColor={surfaceColor}
                showAwards={Boolean(capabilities.trip_blog_trip_awards)}
                theme={theme}
                displayFont={displayFont}
                displayFontItalic={displayFontItalic}
              />
            ) : (
              <TouchableOpacity testID="trip-blog-build-recap" accessibilityRole="button" disabled={recapBusy} onPress={() => loadRecap()} style={[styles.button, { alignSelf: 'flex-start', backgroundColor: theme?.colors?.link ?? '#7c3aed' }]}>
                <Text style={styles.buttonText}>{recapBusy ? 'Building recap…' : 'Relive this trip'}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
        {/* Phase 0 reorder — search, places, privacy/publication, and the spend figure are utility
            controls, not story — collapsed here instead of crowding the masthead (redesign notes
            §1/§4's "Blog tools" drawer). */}
        <View style={{ marginTop: 12 }}>
          <TouchableOpacity
            testID="blog-tools-toggle"
            accessibilityRole="button"
            onPress={() => setShowBlogTools((current) => !current)}
            style={{ alignSelf: 'flex-start', paddingVertical: 6 }}
          >
            <Text style={{ color: mutedColor, fontWeight: '700', fontSize: 13 }}>{showBlogTools ? '▾' : '▸'} Blog tools</Text>
          </TouchableOpacity>
          {showBlogTools ? (
            <View testID="blog-tools-panel" style={{ backgroundColor: surfaceColor, borderRadius: 16, padding: 18, marginTop: 6, gap: 14 }}>
              {canEdit ? (
                <View style={{ padding: 10, borderWidth: 1, borderColor, borderRadius: 8, backgroundColor: inputColor }}>
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
                  {publicationState === 'public' && capabilities.trip_blog_alt_text && missingAccessibilityCount > 0 ? (
                    <Text testID="blog-accessibility-remediation" style={{ color: '#b45309', marginTop: 8, fontSize: 12 }}>
                      Accessibility reminder: {missingAccessibilityCount} public {missingAccessibilityCount === 1 ? 'photo needs' : 'photos need'} alt text or a decorative mark. Your existing public blog remains available while you fix this.
                    </Text>
                  ) : null}
                  {publicationState === 'private' ? <Text style={{ color: mutedColor, marginTop: 6, fontSize: 12 }}>Making a blog public requires consent from all adult account travelers.</Text> : null}
                </View>
              ) : null}
              <BlogDiscoveryPanel
                backendUrl={backendUrl}
                headers={headers}
                tripId={activeTripId}
                searchEnabled={Boolean(capabilities.trip_blog_search)}
                placesEnabled={Boolean(capabilities.trip_blog_places && !readOnly)}
                textColor={textColor}
                mutedColor={mutedColor}
                borderColor={borderColor}
                backgroundColor={inputColor}
                theme={theme}
              />
              {capabilities.trip_blog_spend_summary && !readOnly ? (
                <View testID="trip-blog-spend-summary" style={{ borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor: inputColor }}>
                  <Text style={{ color: textColor, fontWeight: '700' }}>Trip spend: {new Intl.NumberFormat(undefined, { style: 'currency', currency: tripCurrency }).format(spendTotal)}</Text>
                  <Text style={{ color: mutedColor, fontSize: 11, marginTop: 2 }}>Calculated on this device from the trip expense ledger.</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        </View>
      </ScrollView>
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
    </View>
  );
};

export default TripBlogTab;
