// @ts-nocheck
import IconText from '../components/IconText';
import { useLayoutBreakpoints } from '../hooks/useLayoutBreakpoints';
import { themeFontFamilies, resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';




import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, ImageBackground, Linking, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Modal from '../components/KeyboardAwareModal';
import BlogPublicationChecklist from '../components/BlogPublicationChecklist';
import BlogPublicPreview from '../components/BlogPublicPreview';
import { useBlogMediaUrlRefresh } from '../hooks/useBlogMediaUrlRefresh';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, Fraunces_500Medium, Fraunces_600SemiBold, Fraunces_600SemiBold_Italic } from '@expo-google-fonts/fraunces';
import * as ImagePicker from 'expo-image-picker';
import VoiceNoteRecorder from '../components/VoiceNoteRecorder';
import { alertMessage } from '../utils/crossPlatformAlert';
import { formatDateLong } from '../utils/formatDateLong';
import { localTodayDateOnly } from '../utils/dateOnly';
import TripDayMap from '../components/TripDayMap';
import ActivitySharingControls from '../components/ActivitySharingControls';
import { type TripMapPoint } from '../utils/googleMaps';
import TripMap from '../components/TripMap';
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
import BlogMediaMetadataEditor from '../components/BlogMediaMetadataEditor';
import AutoGrowTextInput from '../components/AutoGrowTextInput';
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
  isVideoMimeType,
  guessMimeTypeFromName,
  uploadBlogFiles,
} from '../utils/blogUpload';
import { convertImageToJpeg, isHeicMimeType, toJpegName } from '../utils/heicToJpeg';
import { actualAudioType, readLocalBlob } from '../utils/localBlob';
import { defaultTemperatureUnitForRegion, formatWeatherFactValue, type TemperatureUnit } from '../utils/temperatureUnit';
import { readImageCaptureMetadata, readNativeExifCapture } from '../utils/exifCapture';
import PhotoFirstComposer from '../components/PhotoFirstComposer';
import DropdownOptionButton from '../components/DropdownOptionButton';
import { isTripActiveToday, localDateString } from '../utils/offlineTripCache';
import { trimBlogNoteEnd } from '../utils/trimBlogNoteEnd';

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
const isUnavailableVoiceNote = (item) =>
  (item?.mediaKind === 'audio' || item?.kindKey === 'media.audio') && (item.state !== 'ready' || !item.primaryUrl);

const WRITING_PROMPTS = [
  'What surprised you today?', 'Best thing you ate', 'A moment worth remembering',
  'What made everyone laugh?', 'One thing you learned', 'The view you did not expect',
];
const promptsForDay = (dayDate) => {
  const start = [...String(dayDate)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % WRITING_PROMPTS.length;
  return [0, 1, 2].map((offset) => WRITING_PROMPTS[(start + offset) % WRITING_PROMPTS.length]);
};

const TripBlogTab = ({ backendUrl, headers, activeTripId, trips = [] as any[], tripEndDate = null as string | null, styles, theme: _providedTheme, readOnly = false, currentUserId = null, isTripOwnerOrAdmin = false, allExpenses = [] as any[], tripCurrency = 'USD', flights = [] as any[], lodgings = [] as any[], tours = [] as any[], carRentals = [] as any[], autoOpenAddPhotos = false, onAutoOpenHandled = () => {}, autoOpenActivityCapture = null as { date: string; tags: string[] } | null, onAutoOpenActivityCaptureHandled = () => {}, temperatureUnit = defaultTemperatureUnitForRegion() as TemperatureUnit, onChangeTemperatureUnit = null as ((unit: TemperatureUnit) => void) | null }) => {
  const [currentDay, setCurrentDay] = useState(localTodayDateOnly);
  const finalTripDay = String(tripEndDate ?? trips.find((trip) => trip.id === activeTripId)?.endDate ?? '').slice(0, 10);
  const canReliveTrip = /^\d{4}-\d{2}-\d{2}$/.test(finalTripDay) && currentDay > finalTripDay;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const updateDay = () => {
      setCurrentDay(localTodayDateOnly());
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(updateDay, midnight.getTime() - now.getTime() + 100);
    };
    updateDay();
    return () => clearTimeout(timer);
  }, []);
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const { isPhoneLayout } = useLayoutBreakpoints();
  const { width: viewportWidth } = useWindowDimensions();
  const compactMasthead = viewportWidth < 600;
  // Phase 1 typography (redesign proposal §5) — Fraunces for the masthead title and day
  // headlines, everything else stays on the system font. Loaded here rather than at the app
  // root so this stays scoped to the trip blog; while it loads, headings just render in the
  // system font (no flash of unstyled layout, only of the display face).
  const [fraunceLoaded] = useFonts({ Fraunces_500Medium, Fraunces_600SemiBold, Fraunces_600SemiBold_Italic });
  const displayFont = fraunceLoaded ? themeFontFamilies.display : undefined;
  const displayFontItalic = fraunceLoaded ? themeFontFamilies.displayItalic : undefined;
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [voiceUploadFailures, setVoiceUploadFailures] = useState({});
  const [uploadProgress, setUploadProgress] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [limit, setLimit] = useState(7);
  const [cursor, setCursor] = useState(null);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [storagePlans, setStoragePlans] = useState<PlanInfo[]>([]);
  const [addingDay, setAddingDay] = useState(null);
  const [composerFiles, setComposerFiles] = useState(null); // photo-first composer (A2): picked files awaiting day assignment
  // Quick capture: snap-a-photo-and-dictate-a-caption, available outside edit mode (see
  // quickCapturePhoto below). Holds the freshly uploaded asset while its caption modal is open.
  const [quickCaptureAsset, setQuickCaptureAsset] = useState(null);
  const [quickCapturing, setQuickCapturing] = useState(false);
  const [composerDefaultDay, setComposerDefaultDay] = useState(null); // set when opened from a specific day's button
  const [composerDefaultTags, setComposerDefaultTags] = useState([]);
  // Destination trip for the "+ Add photos to this trip" flow — defaults to whichever trip is
  // active today, falling back to the app's currently-selected trip, but never overrides an
  // explicit choice the traveler already made from the dropdown this session.
  const [uploadTripId, setUploadTripId] = useState(activeTripId);
  const [showUploadTripDropdown, setShowUploadTripDropdown] = useState(false);
  const uploadTripManuallyPicked = useRef(false);
  useEffect(() => {
    if (uploadTripManuallyPicked.current) return;
    const todaysTrip = trips.find((trip) => isTripActiveToday(trip));
    setUploadTripId(todaysTrip?.id ?? activeTripId);
  }, [trips, activeTripId]);
  const uploadTripsSorted = useMemo(
    () => [...trips].sort((a, b) => String(a.startDate ?? '').localeCompare(String(b.startDate ?? ''))),
    [trips]
  );
  const uploadTrip = uploadTripsSorted.find((trip) => trip.id === uploadTripId) ?? trips.find((trip) => trip.id === uploadTripId);
  const [newBody, setNewBody] = useState('');
  const [newTags, setNewTags] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [publication, setPublication] = useState(null);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [showPublicPreview, setShowPublicPreview] = useState(false);
  const [publicationNotice, setPublicationNotice] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [settingCoverForDay, setSettingCoverForDay] = useState(null);
  const [lightboxDay, setLightboxDay] = useState(null);
  const [capabilities, setCapabilities] = useState({});
  const [recap, setRecap] = useState(null);
  const [recapBusy, setRecapBusy] = useState(false);
  const [recapNotice, setRecapNotice] = useState(null);
  const scrollRef = useRef(null);
  const recapY = useRef(0);
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

  const textColor = theme?.colors?.text ?? styles.sectionTitle?.color ?? themeStyle('tabs_tripBlog_189', {  }, (theme ?? _styleTheme));
  const mutedColor = theme?.colors?.textMuted ?? themeStyle('tabs_tripBlog_190', {  }, (theme ?? _styleTheme));
  const surfaceColor = theme?.colors?.surface ?? themeStyle('tabs_tripBlog_191', {  }, (theme ?? _styleTheme));
  const inputColor = theme?.colors?.input ?? surfaceColor;
  const borderColor = theme?.colors?.border ?? themeStyle('tabs_tripBlog_192', {  }, (theme ?? _styleTheme));
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
  // Followers may comment on content they can access. Reactions belong to the reading view,
  // including the authenticated public preview; the server enforces each target's audience.
  const canEngage = !publicPreview;
  const canReact = !editMode;
  // The "Blog tools" drawer is entirely traveler-facing (publish/unpublish, the private spend
  // figure, the traveler-only places index, search). A follower has nothing in it — don't show an
  // empty collapsible.
  const blogToolsHasContent =
    canEdit ||
    Boolean(capabilities.trip_blog_search) ||
    Boolean(capabilities.trip_blog_places && !readOnly) ||
    Boolean(capabilities.trip_blog_spend_summary && !readOnly);
  const visibleDays = useMemo(() => (blog?.days || []).map((day) => {
    if (editMode) return day;
    const readableItems = (day.items || []).filter((item) => {
      if (publicPreview && item.audience && item.audience !== 'public') return false;
      if (isUnavailableVoiceNote(item)) return false;
      if (item.kindKey === 'core.gallery') return (item.assets || []).some((asset) => !isUnavailableVoiceNote(asset));
      return true;
    }).map((item) => item.kindKey === 'core.gallery'
      ? { ...item, assets: (item.assets || []).filter((asset) => !isUnavailableVoiceNote(asset)) }
      : item);
    return { ...day, items: readableItems, activities: publicPreview ? [] : day.activities };
  }).filter((day) => editMode || (day.items || []).length > 0), [blog?.days, publicPreview, editMode]);

  useEffect(() => { setVoiceUploadFailures({}); }, [activeTripId]);
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
  // Server-projected stops for the device map. Exact for travelers; coarse, opt-in and lodging-free for followers.
  const [dayMapPoints, setDayMapPoints] = useState<Record<string, { precision: 'exact' | 'approximate'; points: Array<{ lat: number; lng: number }> }>>({});
  // The °F/°C switch only shows when there's weather to convert.
  const hasWeatherFacts = useMemo(() => Object.values(dayFacts || {}).some((facts: any) => Array.isArray(facts) && facts.some((fact) => fact.key === 'weather')), [dayFacts]);
  const factScope = JSON.stringify([activeTripId, headers?.Authorization, readOnly]);
  const factScopeRef = useRef(factScope); factScopeRef.current = factScope;
  const mapScope = JSON.stringify([factScope, publicPreview]);
  const mapScopeRef = useRef(mapScope); mapScopeRef.current = mapScope;
  const loadedFactDays = useRef(new Set());
  useEffect(() => { loadedFactDays.current.clear(); setDayFacts({}); }, [factScope]);
  useEffect(() => { setDayMapPoints({}); }, [mapScope]);
  useEffect(() => {
    if (publicPreview) return;
    for (const day of visibleDays) {
      if (loadedFactDays.current.has(day.localDate)) continue;
      loadedFactDays.current.add(day.localDate);
      const requestScope = mapScope;
      fetch(`${backendUrl}/api/trips/${activeTripId}/blog/days/${day.localDate}/facts`, { headers })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!data?.facts || factScopeRef.current !== factScope) return;
          setDayFacts((current) => ({ ...current, [day.localDate]: data.facts }));
          if (mapScopeRef.current !== requestScope) return;
          setDayMapPoints((current) => {
            const { [day.localDate]: _previous, ...rest } = current;
            return data.mapPoints?.points?.length ? { ...rest, [day.localDate]: data.mapPoints } : rest;
          });
        })
        .catch(() => { loadedFactDays.current.delete(day.localDate); });
    }
  }, [visibleDays, publicPreview, backendUrl, activeTripId, headers, mapScope]);

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

  const load = async (nextCursor = null, silent = false) => {
    if (!activeTripId) return;
    if (!silent) setLoading(true);
    try {
      // On a refresh (no cursor — e.g. after any mutation), re-request every day the user has
      // already paged in, so a small edit doesn't collapse the list back to the first page and
      // lose their scroll context. Cursor-paged "Load more" keeps using the page size.
      const loadedCount = blog?.days?.length ?? 0;
      const effectiveLimit = nextCursor ? limit : Math.max(limit, loadedCount);
      const params = new URLSearchParams({ limit: String(effectiveLimit) });
      if (nextCursor) params.set('cursor', nextCursor);
      const reactionEpochAtRequest = engagement.getMutationEpoch();
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
      engagement.seedFromBlog(data, reactionEpochAtRequest);
      const lastDay = days[days.length - 1];
      setCursor(days.length >= effectiveLimit && lastDay ? lastDay.localDate : null);
    } catch (error) {
      if (!silent) alertMessage('Trip blog', error.message || 'Unable to load the trip blog');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useBlogMediaUrlRefresh(blog, () => load(null, true));

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

  const RECAP_MAX_POLLS = 20;
  const loadRecap = async (attempt = 0) => {
    if (!canReliveTrip || (recapBusy && attempt === 0)) return;
    setRecapBusy(true);
    if (attempt === 0) setRecapNotice('Building your recap — this can take up to a minute…');
    let retryScheduled = false;
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/recap`, { headers });
      const data = await response.json().catch(() => ({}));
      if (response.status === 202) {
        if (attempt < RECAP_MAX_POLLS) {
          retryScheduled = true;
          setTimeout(() => { void loadRecap(attempt + 1); }, Math.min(3000, Math.max(1000, Number(data.retryAfterSeconds || 1) * 1000)));
        } else {
          setRecapNotice('Still building — give it a moment and tap “Relive this trip” again.');
        }
        return;
      }
      if (!response.ok || !data.recap) throw new Error(data.error || 'Unable to build the trip recap');
      setRecap(data.recap);
      try {
        const mapsResponse = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/maps`, { headers, cache: 'no-store' });
        if (mapsResponse.ok && mapScopeRef.current === mapScope) { const maps = await mapsResponse.json(); if (mapScopeRef.current !== mapScope) return; setDayMapPoints(Object.fromEntries((maps.days || []).map(day => [day.dayDate, day.mapPoints]))); }
      } catch { /* The recap remains useful without a map. */ }
      setRecapNotice(null);
      // Bring the freshly-built card into view — otherwise it just appears somewhere off-screen.
      setTimeout(() => { try { scrollRef.current?.scrollTo({ y: Math.max(0, recapY.current - 24), animated: true }); } catch {} }, 120);
    } catch (error) {
      setRecapNotice(null);
      alertMessage('Trip recap', error.message || 'Unable to build the trip recap');
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

  // Dictated caption (A9 voice-caption feature): the recorded clip is sent straight through for
  // transcription + AI cleanup and is never persisted as its own blog media asset — it only ever
  // populates this photo's caption draft, same as suggestMediaMetadata above.
  const transcribeMediaCaption = async (item, recording) => {
    setMetadataBusyAssetId(item.assetId);
    try {
      const formData = new FormData();
      if (Platform.OS === 'web') {
        // RN's { uri, name, type } FormData file convention (the else branch below) is native-only
        // -- on web, FormData.append just serializes that plain object into a string field instead
        // of attaching real file bytes, so the server's multer middleware never sees a file at all
        // ("An audio recording is required"). Found via manual testing on web, not previously
        // exercised there. fetch() the blob: URI to get a real Blob, then append(name, blob,
        // filename) -- that's what actually attaches bytes to the multipart body in a browser.
        const audioBlob = recording.blob ?? await readLocalBlob(recording.uri);
        formData.append('audio', audioBlob, recording.name || 'caption-recording.m4a');
      } else {
        formData.append('audio', {
          uri: recording.uri,
          name: recording.name || 'caption-recording.m4a',
          type: recording.mimeType || 'audio/m4a',
        } as any);
      }
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/media/${item.assetId}/transcribe-caption`, {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to transcribe the recording');
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

  // Public viewing is on by default when every traveler qualifies (16+ with a date of birth, and
  // none has a private profile default). Any traveler can opt this trip's blog out here; travelers
  // and followers always keep access. Clearing the opt-out re-publishes it if everyone qualifies.
  const setPublicOptOut = async (optOut) => {
    if (!activeTripId || !canEdit || publicationBusy) return;
    setPublicationBusy(true);
    setPublicationNotice('');
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicOptOut: optOut }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to update public viewing');
      if (optOut) setPublicationNotice('Public viewing is off. Travelers and followers can still see this blog.');
      else if (data.visibilityState === 'public') setPublicationNotice('Your blog is public again.');
      else setPublicationNotice('Public viewing is allowed again. The blog goes public once every traveler is 16+ with a date of birth in their profile and none has chosen private.');
      await refreshBlogAndPublication();
    } catch (error) {
      setPublicationNotice(error.message || 'Unable to update public viewing');
    } finally {
      setPublicationBusy(false);
    }
  };

  // Followers' approximate maps: off until a traveler has seen exactly what would be shown.
  const [mapPreview, setMapPreview] = useState<Array<{ dayDate: string; points: Array<{ lat: number; lng: number }> }> | null>(null);
  const [mapShareBusy, setMapShareBusy] = useState(false);
  const [mapShareNotice, setMapShareNotice] = useState('');
  useEffect(() => { setMapPreview(null); setMapShareNotice(''); }, [activeTripId]);
  const loadMapPreview = async () => {
    if (!activeTripId || mapShareBusy) return;
    setMapShareBusy(true);
    setMapShareNotice('');
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/map-sharing-preview`, { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to build the preview');
      setMapPreview(Array.isArray(data.days) ? data.days : []);
    } catch (error) {
      setMapShareNotice(error.message || 'Unable to build the preview');
    } finally {
      setMapShareBusy(false);
    }
  };
  const setSharedMap = async (enabled) => {
    if (!activeTripId || !canEdit || mapShareBusy) return;
    // Consent is informed: turning sharing on requires a preview that actually shows something.
    if (enabled && !mapPreview?.length) return;
    setMapShareBusy(true);
    setMapShareNotice('');
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharedMapEnabled: enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to update map sharing');
      setMapShareNotice(enabled ? 'Followers can now see approximate day maps.' : 'Followers no longer see day maps.');
      if (!enabled) setMapPreview(null);
      await refreshBlogAndPublication();
    } catch (error) {
      setMapShareNotice(error.message || 'Unable to update map sharing');
    } finally {
      setMapShareBusy(false);
    }
  };

  // Whether newly uploaded photos keep where they were taken. Not retroactive (server enforces at upload time).
  const [photoLocationBusy, setPhotoLocationBusy] = useState(false);
  const [photoLocationNotice, setPhotoLocationNotice] = useState('');
  const setPhotoLocation = async (enabled) => {
    if (!activeTripId || !canEdit || photoLocationBusy) return;
    setPhotoLocationBusy(true);
    setPhotoLocationNotice('');
    try {
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoLocationEnabled: enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to update photo locations');
      setPhotoLocationNotice(enabled ? 'Photos you add from now on will keep where they were taken.' : 'Photos you add from now on will not keep their location.');
      await refreshBlogAndPublication();
    } catch (error) {
      setPhotoLocationNotice(error.message || 'Unable to update photo locations');
    } finally {
      setPhotoLocationBusy(false);
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
      return Promise.all(files.map(async (file) => {
        const mimeType = file.type || guessMimeTypeFromName(file.name);
        // Read EXIF capture time/location locally so the photo-first composer can bucket by day
        // (A2) and the day-facts time span has data. JPEG-only, best-effort — {} on anything else.
        const capture = await readImageCaptureMetadata(file);
        const previewUri = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(file) : null;
        return { blob: file, mimeType, size: file.size, name: file.name, previewUri, ...capture };
      }));
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
      exif: true, // capture time/location for the photo-first composer (A2)
      // iPhone camera-roll photos are HEIC, which the blog can't store or show in browsers. The
      // picker's default ("current") hands over that original file; "compatible" has iOS
      // transcode it to JPEG (and HEVC video to H.264) as it's picked. iOS 14+; ignored elsewhere.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets?.length) return [];
    return Promise.all(result.assets.map(async (asset) => {
      let mimeType = asset.mimeType || guessMimeTypeFromName(asset.fileName);
      let uri = asset.uri;
      let name = asset.fileName ?? null;
      // Fallback for anything still HEIC/HEIF (e.g. Android, or iOS older than 14): convert here.
      // EXIF was already read from the picker result, so capture time/location survive.
      if (isHeicMimeType(mimeType, name)) {
        const jpegUri = await convertImageToJpeg(uri).catch(() => null);
        if (jpegUri) {
          uri = jpegUri;
          mimeType = 'image/jpeg';
          name = toJpegName(name);
        }
      }
      const response = await fetch(uri);
      const blob = await response.blob();
      const capture = readNativeExifCapture(asset.exif);
      const converted = uri !== asset.uri;
      return { blob, mimeType, size: converted ? blob.size : (asset.fileSize ?? blob.size), name: name ?? (isVideoMimeType(mimeType) ? 'video' : 'photo'), previewUri: uri ?? null, ...capture };
    }));
  };

  // Photo-first composer (A2): pick once, sort by day, commit as a batch. The per-day
  // "+ Photo/Video" button (handleUpload) stays for adding to one specific day.
  const openPhotoComposer = async (defaultDayDate = null, defaultTags = []) => {
    // Guard: a bare onPress={openPhotoComposer} would hand us the press event here.
    const forDay = typeof defaultDayDate === 'string' ? defaultDayDate : null;
    if (!canEdit) return;
    const picked = await pickMediaFiles();
    if (!picked.length) return;
    const supported = picked.filter((file) => SUPPORTED_MIME_TYPES.includes(file.mimeType));
    if (!supported.length) {
      alertMessage('Add photos', 'Only JPEG/PNG photos or MP4/MOV/WebM videos are supported.');
      return;
    }
    setComposerDefaultDay(forDay);
    setComposerDefaultTags(Array.isArray(defaultTags) ? defaultTags.map((tag) => String(tag).trim()).filter(Boolean) : []);
    setComposerFiles(supported);
  };
  const closePhotoComposer = () => { setComposerFiles(null); setComposerDefaultDay(null); setComposerDefaultTags([]); };

  // Deep-link target for the evening trip reminder notification (see tripReminderNotifications.ts
  // / App.tsx's notification response listener) — opens the same picker the "+ Add photos" button
  // does, defaulted to today, once this tab has finished loading enough to edit.
  useEffect(() => {
    if (!autoOpenAddPhotos) return;
    if (!canEdit || !capabilities.trip_blog_photo_composer || visibleDays.length === 0 || composerFiles) return;
    onAutoOpenHandled();
    openPhotoComposer(localDateString());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenAddPhotos, canEdit, capabilities.trip_blog_photo_composer, visibleDays.length, composerFiles]);

  // The activity recap prompt routes here after the traveler chooses photos/videos. It uses the
  // same photo-first composer as every other blog upload, with the activity name stamped as a
  // searchable association tag.
  useEffect(() => {
    if (!autoOpenActivityCapture?.date) return;
    if (!canEdit || !capabilities.trip_blog_photo_composer || visibleDays.length === 0 || composerFiles) return;
    onAutoOpenActivityCaptureHandled();
    openPhotoComposer(autoOpenActivityCapture.date, autoOpenActivityCapture.tags ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenActivityCapture, canEdit, capabilities.trip_blog_photo_composer, visibleDays.length, composerFiles]);

  const handleComposerCommitted = async ({ succeeded, failed, quotaBlocked }) => {
    closePhotoComposer();
    if (quotaBlocked) {
      const plans = await fetchBillingPlans(backendUrl, headers.Authorization?.replace('Bearer ', ''));
      setStoragePlans(plans.filter((p) => p.planKey.startsWith('storage_')));
      setShowQuotaModal(true);
    }
    await load();
    if (!quotaBlocked && (succeeded || failed)) {
      const parts = [];
      if (succeeded) parts.push(`${succeeded} added`);
      if (failed) parts.push(`${failed} failed`);
      alertMessage('Add photos', parts.join(', '));
    }
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
        const detail = result.errors?.[0] ? `\n\n${result.errors[0]}` : '';
        alertMessage('Upload', parts.join(', ') + detail);
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  // Quick capture: launches the device's own camera app (no custom camera UI to build or
  // maintain), uploads the single photo straight away, then opens a lightweight caption modal
  // reusing BlogMediaMetadataEditor's existing "dictate a caption" flow. Available outside edit
  // mode -- the whole point is to skip the edit-mode/day-picker/composer detour for the common
  // "snap one photo right now" case. The per-day composer stays as-is for picking several photos
  // or backfilling an earlier day.
  const quickCapturePhoto = async () => {
    if (readOnly || quickCapturing) return;
    setQuickCapturing(true);
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          alertMessage('Camera access needed', 'Allow camera access in Settings to take a photo for this trip blog.');
          return;
        }
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 1,
        exif: true,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      let mimeType = asset.mimeType || guessMimeTypeFromName(asset.fileName) || 'image/jpeg';
      let uri = asset.uri;
      let name = asset.fileName ?? null;
      if (isHeicMimeType(mimeType, name)) {
        const jpegUri = await convertImageToJpeg(uri).catch(() => null);
        if (jpegUri) { uri = jpegUri; mimeType = 'image/jpeg'; name = toJpegName(name); }
      }
      const response = await fetch(uri);
      const blob = await response.blob();
      const capture = readNativeExifCapture(asset.exif);
      const converted = uri !== asset.uri;
      const pickedFile = {
        blob, mimeType, size: converted ? blob.size : (asset.fileSize ?? blob.size),
        name: name ?? 'photo', previewUri: uri ?? null, ...capture,
      };
      // Today's photo goes on today's entry; a capture timestamp (when present) overrides that in
      // case the photo was actually taken earlier and is only being added now.
      const dayDate = (typeof capture.capturedAt === 'string' ? capture.capturedAt.slice(0, 10) : null) || localDateString();

      setUploading(true);
      const uploadResult = await uploadBlogFiles({ backendUrl, headers, tripId: activeTripId }, dayDate, [pickedFile]);
      setUploading(false);
      if (uploadResult.quotaBlocked) {
        const plans = await fetchBillingPlans(backendUrl, headers.Authorization?.replace('Bearer ', ''));
        setStoragePlans(plans.filter((p) => p.planKey.startsWith('storage_')));
        setShowQuotaModal(true);
        return;
      }
      if (!uploadResult.succeeded || !uploadResult.assets[0]) {
        alertMessage('Add photo', uploadResult.errors?.[0] || 'Unable to add this photo.');
        return;
      }
      await load();
      const uploadedAsset = uploadResult.assets[0];
      setQuickCaptureAsset({
        assetId: uploadedAsset.id,
        caption: uploadedAsset.caption ?? '',
        altText: uploadedAsset.altText ?? '',
        isDecorative: Boolean(uploadedAsset.isDecorative),
        tags: uploadedAsset.tags ?? [],
      });
    } catch (error) {
      alertMessage('Add photo', error.message || 'Unable to take or add this photo.');
    } finally {
      setQuickCapturing(false);
    }
  };

  // Records in-app and uploads the clip through the same
  // path as any voice note, then reuses the transcribe-caption pipeline already built for photo
  // captions (transcribeMediaCaption / saveMediaMetadata above) to turn the recording into the
  // new item's caption -- no new server route, no new AI cost path, same Premium/Pro tier gate
  // and quota as dictating a photo caption. Trade-off, stated plainly: that pipeline cleans the
  // transcript into one short "natural sentence" (it was built for captions), so a long recording
  // won't come back as a verbatim paragraph -- a real limitation, not a bug, if this is later used
  // for longer dictated notes.
  const handleRecordedVoiceNote = async (dayDate, recording) => {
    if (!canEdit || uploading) return;
    setUploading(true);
    setVoiceUploadFailures((current) => ({ ...current, [dayDate]: null }));
    try {
      let blob;
      try {
        blob = await readLocalBlob(recording.uri);
      } catch (error) {
        throw new Error(`Couldn't read the recording on this device (${error.message || 'unknown error'}). Please try again.`);
      }
      // Label the audio with the format the browser really recorded (iPhone Safari: audio/mp4,
      // Chrome: audio/webm), not the "audio/m4a" the recorder assumes, so it plays back elsewhere.
      const { mimeType, extension } = actualAudioType(blob.type, recording.mimeType);
      recording = { ...recording, mimeType, name: `voice-note.${extension}`, blob };
      const uploaded = await uploadBlogFiles(
        { backendUrl, headers, tripId: activeTripId },
        dayDate,
        [{ blob, mimeType, size: blob.size, name: recording.name }]
      );
      if (!uploaded.succeeded || !uploaded.assets[0]) {
        throw new Error(uploaded.quotaBlocked ? 'Your blog storage is full.' : uploaded.errors?.[0] || 'Unable to add the voice note.');
      }
      await load();
      if (capabilities.trip_blog_audio_transcription) {
        try {
          const result = await transcribeMediaCaption({ assetId: uploaded.assets[0].id }, recording);
          if (result.caption) {
            await saveMediaMetadata({ assetId: uploaded.assets[0].id }, { caption: result.caption, altText: '', isDecorative: false });
            // The upload refresh above happens before transcription. Refresh again after the
            // caption write so the newly-created voice note immediately renders its transcript
            // alongside the playback control instead of remaining on the pre-transcription row.
            await load();
          }
        } catch (error) {
          // The recording itself is already saved at this point -- a failed transcription (no
          // speech detected, quota reached) shouldn't read as if the whole action failed.
          alertMessage('Voice note', `Saved, but couldn't transcribe it: ${error.message || 'unknown error'}`);
        }
      }
    } catch (error) {
      setVoiceUploadFailures((current) => ({ ...current, [dayDate]: error.message || 'Unable to add the voice note.' }));
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
    setRecapNotice(null);
    setCoverProposals({});
    setBlog(null); // switching trips: show the spinner, not the previous trip's blog, until the new one loads
    // No trip selected: show only the "Select a trip" prompt -- never request /trips/undefined/blog.
    if (!activeTripId) return;
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
      body: JSON.stringify({ body: trimBlogNoteEnd(html), version }),
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
        body: JSON.stringify({ kindKey: 'core.text', dayDate: item.localDate, body: trimBlogNoteEnd(localBody) }),
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
    const body = trimBlogNoteEnd(newBody);
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
        setNewTags('');
        setAddingDay(null);
        return;
      }
      const response = await fetch(`${backendUrl}/api/trips/${activeTripId}/blog/items`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kindKey: 'core.text', dayDate, body, tags: newTags.split(',').map((tag) => tag.trim()).filter(Boolean) }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to add blog item');
      setNewBody('');
      setNewTags('');
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

  if (!activeTripId) return <View style={themeStyle('tabs_tripBlog_1', {  }, (theme ?? _styleTheme))}><Text style={styles.sectionTitle}>Select a trip to write its blog.</Text></View>;
  // Only take over the whole tab with a spinner on the very first load (no data yet). Every
  // later refetch — accepting a Day Starter draft, "Load more days", saving a field, any
  // mutation that calls load() — keeps the existing content mounted so the ScrollView doesn't
  // unmount and snap back to the top. A slim "Updating…" bar (below) signals the refresh.
  if (loading && !blog) return <View style={themeStyle('tabs_tripBlog_2', {  }, (theme ?? _styleTheme))}><ActivityIndicator /></View>;
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
    <View style={themeStyle('tabs_tripBlog_3', {  }, (theme ?? _styleTheme))}>
      {loading && blog ? (
        <View style={themeStyle('tabs_tripBlog_4', { theme: theme }, (theme ?? _styleTheme))}>
          <ActivityIndicator size="small" />
          <Text style={themeStyle('tabs_tripBlog_5', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Updating…</Text>
        </View>
      ) : null}
      <ScrollView
        ref={scrollRef}
        style={themeStyle('tabs_tripBlog_6', {  }, (theme ?? _styleTheme))}
        contentContainerStyle={themeStyle('tabs_tripBlog_7', {  }, (theme ?? _styleTheme))}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator
      >
        <View style={themeStyle('tabs_tripBlog_8', {  }, (theme ?? _styleTheme))}>
      <View style={themeStyle('tabs_tripBlog_9', { surfaceColor: surfaceColor }, (theme ?? _styleTheme))}>
        <View testID="blog-masthead-layout" style={themeStyle('tabs_tripBlog_10', { compactMasthead: compactMasthead }, (theme ?? _styleTheme))}>
          {canEdit ? (
            <View style={themeStyle('tabs_tripBlog_11', { compactMasthead: compactMasthead }, (theme ?? _styleTheme))}>
              <TextInput
                testID="blog-masthead-title-input"
                value={mastheadDraft?.title ?? (blog?.title ?? '')}
                onChangeText={(text) => scheduleMastheadSave({ title: text.slice(0, 200) })}
                placeholder="Trip Blog"
                placeholderTextColor={mutedColor}
                style={[styles.sectionTitle, themeStyle('tabs_tripBlog_12', { textColor: textColor, displayFont: displayFont }, (theme ?? _styleTheme))]}
              />
              <TextInput
                testID="blog-masthead-subtitle-input"
                value={mastheadDraft?.subtitle ?? (blog?.subtitle ?? '')}
                onChangeText={(text) => scheduleMastheadSave({ subtitle: text.slice(0, 300) })}
                placeholder="Add a subtitle…"
                placeholderTextColor={mutedColor}
                style={themeStyle('tabs_tripBlog_13', { mutedColor: mutedColor }, (theme ?? _styleTheme))}
              />
              {saveStateLabel('masthead') ? <Text style={themeStyle('tabs_tripBlog_14', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{saveStateLabel('masthead')}</Text> : null}
            </View>
          ) : (
            <View style={themeStyle('tabs_tripBlog_15', { compactMasthead: compactMasthead }, (theme ?? _styleTheme))}>
              <Text style={[styles.sectionTitle, themeStyle('tabs_tripBlog_16', { displayFont: displayFont }, (theme ?? _styleTheme))]}>{blog?.title || 'Trip Blog'}</Text>
              {blog?.subtitle ? <Text style={themeStyle('tabs_tripBlog_17', { mutedColor: mutedColor, displayFontItalic: displayFontItalic }, (theme ?? _styleTheme))}>{blog.subtitle}</Text> : null}
            </View>
          )}
          <View testID="blog-masthead-actions" style={themeStyle('tabs_tripBlog_18', { compactMasthead: compactMasthead }, (theme ?? _styleTheme))}>
            {!readOnly ? (
              <TouchableOpacity
                testID="blog-edit-toggle"
                accessibilityRole="button"
                onPress={toggleEditMode}
                style={[styles.button, themeStyle('tabs_tripBlog_19', { editMode: editMode, theme: theme }, (theme ?? _styleTheme))]}
              >
                <Text style={[styles.buttonText, themeStyle('tabs_tripBlog_20', { editMode: editMode, textColor: textColor }, (theme ?? _styleTheme))]}>{editMode ? 'Done editing' : 'Edit blog'}</Text>
              </TouchableOpacity>
            ) : null}
            {!readOnly && !editMode ? (
              <TouchableOpacity
                testID="blog-camera-capture"
                accessibilityRole="button"
                disabled={quickCapturing || uploading}
                onPress={quickCapturePhoto}
                style={[styles.button, themeStyle('tabs_tripBlog_21', { theme: theme, quickCapturing: quickCapturing, uploading: uploading }, (theme ?? _styleTheme))]}
              >
                <IconText style={[styles.buttonText, themeStyle('tabs_tripBlog_22', { textColor: textColor }, (theme ?? _styleTheme))]}>{quickCapturing ? 'Opening camera…' : '📷 Add photo'}</IconText>
              </TouchableOpacity>
            ) : null}
            {publicPageUrl ? (
              <TouchableOpacity
                accessibilityRole="link"
                onPress={() => { void Linking.openURL(publicPageUrl).catch(() => {}); }}
                style={themeStyle('tabs_tripBlog_23', {  }, (theme ?? _styleTheme))}
              >
                <IconText style={themeStyle('tabs_tripBlog_24', { theme: theme }, (theme ?? _styleTheme))}>View public page ↗</IconText>
              </TouchableOpacity>
            ) : null}
            {canEdit && ((Platform.OS === 'ios' && capabilities.trip_blog_mobile_share_ios) || (Platform.OS === 'android' && capabilities.trip_blog_mobile_share_android)) ? (
              <TouchableOpacity testID="blog-quick-capture" accessibilityRole="button" onPress={() => { const today = new Date().toISOString().slice(0, 10); const day = visibleDays.find((candidate) => candidate.localDate === today)?.localDate ?? visibleDays[0]?.localDate; if (day) { setAddingDay(day); setNewBody(''); } }} style={themeStyle('tabs_tripBlog_25', {  }, (theme ?? _styleTheme))}>
                <Text style={themeStyle('tabs_tripBlog_26', { theme: theme }, (theme ?? _styleTheme))}>Quick capture</Text>
              </TouchableOpacity>
            ) : null}
            {capabilities.trip_blog_keepsake_export ? <BlogKeepsakeButton nativeEnabled={capabilities.planning_native_map === true} backendUrl={backendUrl} headers={headers} tripId={activeTripId} textColor={theme?.colors?.link ?? themeStyle('tabs_tripBlog_193', {  }, (theme ?? _styleTheme))} /> : null}
          </View>
        </View>
        {/* Phase 1 masthead stat row (redesign proposal §1) — the "trip at a glance" strip. */}
        <View testID="blog-trip-stats" style={themeStyle('tabs_tripBlog_27', {  }, (theme ?? _styleTheme))}>
          <Text style={themeStyle('tabs_tripBlog_28', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('tabs_tripBlog_29', { textColor: textColor }, (theme ?? _styleTheme))}>{tripStats.dayCount}</Text> {tripStats.dayCount === 1 ? 'day' : 'days'}
          </Text>
          {tripStats.photoCount > 0 ? (
            <Text style={themeStyle('tabs_tripBlog_30', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
              <Text style={themeStyle('tabs_tripBlog_31', { textColor: textColor }, (theme ?? _styleTheme))}>{tripStats.photoCount}</Text> {tripStats.photoCount === 1 ? 'photo' : 'photos'}
            </Text>
          ) : null}
          {tripStats.videoCount > 0 ? (
            <Text style={themeStyle('tabs_tripBlog_32', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
              <Text style={themeStyle('tabs_tripBlog_33', { textColor: textColor }, (theme ?? _styleTheme))}>{tripStats.videoCount}</Text> {tripStats.videoCount === 1 ? 'video' : 'videos'}
            </Text>
          ) : null}
          {tripStats.contributorCount > 0 ? (
            <Text style={themeStyle('tabs_tripBlog_34', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
              <Text style={themeStyle('tabs_tripBlog_35', { textColor: textColor }, (theme ?? _styleTheme))}>{tripStats.contributorCount}</Text> {tripStats.contributorCount === 1 ? 'traveler' : 'travelers'}
            </Text>
          ) : null}
          {tripStats.distanceKm != null ? (
            <Text style={themeStyle('tabs_tripBlog_36', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
              approx. <Text style={themeStyle('tabs_tripBlog_37', { textColor: textColor }, (theme ?? _styleTheme))}>{tripStats.distanceKm}</Text> km
            </Text>
          ) : null}
          {onChangeTemperatureUnit && hasWeatherFacts ? (
            <View testID="blog-temperature-unit" accessibilityRole="radiogroup" accessibilityLabel="Temperature unit" style={themeStyle('tabs_tripBlog_38', { borderColor: borderColor }, (theme ?? _styleTheme))}>
              {(['fahrenheit', 'celsius'] as TemperatureUnit[]).map((unit) => {
                const selected = temperatureUnit === unit;
                return (
                  <TouchableOpacity
                    key={unit}
                    testID={`blog-temperature-unit-${unit}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={unit === 'fahrenheit' ? 'Fahrenheit' : 'Celsius'}
                    onPress={() => { if (!selected) onChangeTemperatureUnit(unit); }}
                    style={themeStyle('tabs_tripBlog_39', { selected: selected, theme: theme }, (theme ?? _styleTheme))}
                  >
                    <Text style={themeStyle('tabs_tripBlog_40', { selected: selected, mutedColor: mutedColor }, (theme ?? _styleTheme))}>{unit === 'fahrenheit' ? '°F' : '°C'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>
        {tripMapPoints.length ? (
          <TripDayMap points={tripMapPoints} backendUrl={backendUrl} requestHeaders={headers} testID="trip-blog-route-map" />
        ) : null}
        <Text style={themeStyle('tabs_tripBlog_41', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
          {editMode
            ? 'Editing mode — changes are saved to the trip blog.'
            : publicPreview
              ? 'Public preview — only content intended for public sharing is shown.'
              : 'Traveler/follower view — all shared trip blog content is shown.'}
        </Text>
        {capabilities.trip_blog_offline_queue && offlineQueueCount > 0 ? (
          <View testID="blog-offline-queue-status" style={themeStyle('tabs_tripBlog_42', {  }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('tabs_tripBlog_43', {  }, (theme ?? _styleTheme))}>{offlineQueueCount} {offlineQueueCount === 1 ? 'entry is' : 'entries are'} saved on this device</Text>
            <Text style={themeStyle('tabs_tripBlog_44', {  }, (theme ?? _styleTheme))}>{connection.status === 'online' ? 'Syncing now…' : 'They will publish when this device reconnects.'}</Text>
          </View>
        ) : null}
        {canEdit ? (
          <AutoGrowTextInput
            testID="blog-masthead-introduction-input"
            value={mastheadDraft?.introduction ?? (blog?.introduction ?? '')}
            onChangeText={(text) => scheduleMastheadSave({ introduction: text.slice(0, 5000) })}
            placeholder="Add an introduction for readers of this blog…"
            placeholderTextColor={mutedColor}
            minHeight={44}
            maxLines={10}
            lineHeight={20}
            style={themeStyle('tabs_tripBlog_45', { textColor: textColor, borderColor: borderColor, inputColor: inputColor }, (theme ?? _styleTheme))}
          />
        ) : (blog?.introduction ? <Text style={themeStyle('tabs_tripBlog_46', { textColor: textColor }, (theme ?? _styleTheme))}>{blog.introduction}</Text> : null)}
      </View>
        {canEdit && capabilities.trip_blog_photo_composer && visibleDays.length > 0 ? (
          <View style={[styles.row, themeStyle('tabs_tripBlog_47', {  }, (theme ?? _styleTheme))]}>
            {trips.length > 1 ? (
              <View style={[styles.input, styles.dropdown, themeStyle('tabs_tripBlog_48', {  }, (theme ?? _styleTheme))]}>
                <TouchableOpacity testID="blog-upload-trip-select" onPress={() => setShowUploadTripDropdown((open) => !open)}>
                  <Text style={styles.cellText}>{uploadTrip?.name || uploadTrip?.destination || 'Select trip'}</Text>
                </TouchableOpacity>
                {showUploadTripDropdown ? (
                  <View style={styles.dropdownList}>
                    {uploadTripsSorted.map((trip) => (
                      <DropdownOptionButton
                        key={trip.id}
                        styles={styles}
                        testID={`blog-upload-trip-option-${trip.id}`}
                        onPress={() => {
                          uploadTripManuallyPicked.current = true;
                          setUploadTripId(trip.id);
                          setShowUploadTripDropdown(false);
                        }}
                      >
                        <Text style={styles.cellText}>{trip.name || trip.destination}</Text>
                      </DropdownOptionButton>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
            {!isPhoneLayout ? <TouchableOpacity
              testID="blog-add-photos"
              accessibilityRole="button"
              style={[styles.button, themeStyle('tabs_tripBlog_49', {  }, (theme ?? _styleTheme))]}
              onPress={() => openPhotoComposer(localDateString())}
              disabled={uploading}
            >
              <IconText style={styles.buttonText}>＋ Add photos to this trip</IconText>
            </TouchableOpacity> : null}
          </View>
        ) : null}
        {blog?.tripPhotos?.map((photo) => (
          <Image key={photo.assetId || photo.id} accessibilityLabel={photo.altText || 'Trip picture'} source={{ uri: photo.primaryUrl || photo.thumbnailUrl }} style={themeStyle('tabs_tripBlog_layout1', {  }, (theme ?? _styleTheme))} resizeMode="cover" />
        ))}
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
            testID={`blog-day-${day.localDate}`}
            style={themeStyle('tabs_tripBlog_50', { canEdit: canEdit, theme: theme, surfaceColor: surfaceColor, borderColor: borderColor }, (theme ?? _styleTheme))}
          >
            {showHeroHeader ? (
              <ImageBackground
                testID={`blog-day-hero-${day.localDate}`}
                source={{ uri: dayCoverUrl }}
                style={themeStyle('tabs_tripBlog_51', {  }, (theme ?? _styleTheme))}
                imageStyle={themeStyle('tabs_tripBlog_52', {  }, (theme ?? _styleTheme))}
              >
                <LinearGradient
                  colors={[themeStyle('tabs_tripBlog_194', {  }, (theme ?? _styleTheme)), themeStyle('tabs_tripBlog_195', {  }, (theme ?? _styleTheme)), themeStyle('tabs_tripBlog_196', {  }, (theme ?? _styleTheme))]}
                  style={themeStyle('tabs_tripBlog_53', {  }, (theme ?? _styleTheme))}
                >
                  <Text style={themeStyle('tabs_tripBlog_54', {  }, (theme ?? _styleTheme))}>
                    {formatDateLong(day.localDate)}{dayWeatherFact ? `  ·  ${formatWeatherFactValue(dayWeatherFact, temperatureUnit)}` : ''}
                  </Text>
                  <Text style={themeStyle('tabs_tripBlog_55', { displayFont: displayFont }, (theme ?? _styleTheme))}>
                    {day.headline || formatDateLong(day.localDate)}
                  </Text>
                  {day.summary ? (
                    <Text style={themeStyle('tabs_tripBlog_56', { displayFontItalic: displayFontItalic }, (theme ?? _styleTheme))}>{day.summary}</Text>
                  ) : null}
                </LinearGradient>
              </ImageBackground>
            ) : null}
            {/* On phones the edit buttons don't fit beside the headline: stack them under it and
                let them wrap, instead of pushing off-screen and squeezing the headline column. */}
            <View
              testID={`blog-day-header-${day.localDate}`}
              style={themeStyle('tabs_tripBlog_57', { compactMasthead: compactMasthead, canEdit: canEdit, showHeroHeader: showHeroHeader }, (theme ?? _styleTheme))}
            >
              {canEdit ? (
                <View style={themeStyle('tabs_tripBlog_58', { compactMasthead: compactMasthead }, (theme ?? _styleTheme))}>
                  <TextInput
                    testID={`blog-day-headline-input-${day.localDate}`}
                    value={dayHeadline}
                    onChangeText={(text) => scheduleDayMetaSave(day, { headline: text.slice(0, 120) })}
                    placeholder="Add a headline for this day…"
                    placeholderTextColor={mutedColor}
                    style={[styles.sectionTitle, themeStyle('tabs_tripBlog_59', { textColor: textColor }, (theme ?? _styleTheme))]}
                  />
                  <Text style={themeStyle('tabs_tripBlog_60', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{formatDateLong(day.localDate)}</Text>
                  <TextInput
                    testID={`blog-day-summary-input-${day.localDate}`}
                    value={daySummary}
                    onChangeText={(text) => scheduleDayMetaSave(day, { summary: text.slice(0, 500) })}
                    placeholder="Add a one-line summary of this day…"
                    placeholderTextColor={mutedColor}
                    style={themeStyle('tabs_tripBlog_61', { mutedColor: mutedColor }, (theme ?? _styleTheme))}
                  />
                  {saveStateLabel(`day-meta-${day.localDate}`) ? (
                    <Text style={themeStyle('tabs_tripBlog_62', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{saveStateLabel(`day-meta-${day.localDate}`)}</Text>
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
                <View style={themeStyle('tabs_tripBlog_63', {  }, (theme ?? _styleTheme))}>
                  <Text style={styles.sectionTitle}>{day.headline || formatDateLong(day.localDate)}</Text>
                  {day.headline ? <Text style={themeStyle('tabs_tripBlog_64', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{formatDateLong(day.localDate)}</Text> : null}
                  {day.summary ? <Text style={themeStyle('tabs_tripBlog_65', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{day.summary}</Text> : null}
                </View>
              )}
              <View testID={`blog-day-actions-${day.localDate}`} style={themeStyle('tabs_tripBlog_66', {  }, (theme ?? _styleTheme))}>
                {canEdit && (
                  <TouchableOpacity
                    style={[styles.button, themeStyle('tabs_tripBlog_67', {  }, (theme ?? _styleTheme))]}
                    onPress={() => { setAddingDay(day.localDate); setNewBody(''); }}
                  >
                    <IconText style={[styles.buttonText, themeStyle('tabs_tripBlog_68', {  }, (theme ?? _styleTheme))]}>+ Add note</IconText>
                  </TouchableOpacity>
                )}
                {/* Recording only needs voice notes on; handleRecordedVoiceNote skips the transcript when
                    transcription is off, so the audio is still saved. */}
                {canEdit && capabilities.trip_blog_audio ? (
                  <VoiceNoteRecorder
                    testID={`blog-record-voice-${day.localDate}`}
                    disabled={uploading}
                    processingLabel={capabilities.trip_blog_audio_transcription ? 'Transcribing…' : 'Saving…'}
                    onRecorded={(recording) => handleRecordedVoiceNote(day.localDate, recording)}
                    onError={(message) => setVoiceUploadFailures((current) => ({ ...current, [day.localDate]: message }))}
                    style={[styles.button, themeStyle('tabs_tripBlog_71', { theme: theme }, (theme ?? _styleTheme))]}
                    activeStyle={themeStyle('tabs_tripBlog_72', { theme: theme }, (theme ?? _styleTheme))}
                    textStyle={[styles.buttonText, themeStyle('tabs_tripBlog_73', {  }, (theme ?? _styleTheme))]}
                  />
                ) : null}
                {canEdit && (
                  <TouchableOpacity
                    style={[styles.button, themeStyle('tabs_tripBlog_74', {  }, (theme ?? _styleTheme))]}
                    onPress={() => (capabilities.trip_blog_photo_composer ? openPhotoComposer(day.localDate) : handleUpload(day.localDate))}
                    disabled={uploading}
                  >
                    <Text style={[styles.buttonText, themeStyle('tabs_tripBlog_75', {  }, (theme ?? _styleTheme))]}>{uploading ? (uploadProgress ? `${uploadProgress.current}/${uploadProgress.total}…` : '…') : '+ Photo/Video'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {canEdit && voiceUploadFailures[day.localDate] ? (
              <View testID={`blog-voice-upload-failure-${day.localDate}`} style={themeStyle('tabs_tripBlog_76', { theme: theme }, (theme ?? _styleTheme))}>
                <Text style={themeStyle('tabs_tripBlog_77', { theme: theme }, (theme ?? _styleTheme))}>Voice note failed: {voiceUploadFailures[day.localDate]}</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss voice note failure" onPress={() => setVoiceUploadFailures((current) => ({ ...current, [day.localDate]: null }))}>
                  <Text style={themeStyle('tabs_tripBlog_78', { textColor: textColor }, (theme ?? _styleTheme))}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {/* Phase 0 elastic fact strip (docs/trip-blog-social-prd.md §6.2, FR-C1.1) — chips with
                no data are absent, not greyed out, so a photos-only day still reads as intentional.
                Weather moved here from the old header pill; distance/places/media are newly
                surfaced from an endpoint the client never called before this redesign.
                Phase 2: `dayMap`'s value is a signed image URL (the background render job's
                static map artifact), not display text — it gets its own thumbnail rather than
                being stringified into a text chip like every other fact. */}
            {dayFacts[day.localDate]?.some((fact) => fact.key !== 'media' && (canEdit || (fact.key !== 'places' && fact.key !== 'plannedVsActual'))) ? (
              <View style={themeStyle('tabs_tripBlog_79', {  }, (theme ?? _styleTheme))}>
                {dayFacts[day.localDate].filter((fact) => fact.key !== 'dayMap' && fact.key !== 'media' && (canEdit || (fact.key !== 'places' && fact.key !== 'plannedVsActual'))).map((fact) => (
                  <View
                    key={fact.key}
                    testID={`blog-day-fact-${day.localDate}-${fact.key}`}
                    style={themeStyle('tabs_tripBlog_80', { theme: theme }, (theme ?? _styleTheme))}
                  >
                    <Text style={themeStyle('tabs_tripBlog_81', { theme: theme }, (theme ?? _styleTheme))}>
                      {fact.key === 'weather' ? formatWeatherFactValue(fact, temperatureUnit) : `${fact.label}: ${fact.value}`}
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
                      style={themeStyle('tabs_tripBlog_82', { theme: theme }, (theme ?? _styleTheme))}
                      resizeMode="cover"
                    />
                  );
                })()}
              </View>
            ) : null}
            {!publicPreview && dayMapPoints[day.localDate] ? (
              <View style={themeStyle('tabs_tripBlog_83', {  }, (theme ?? _styleTheme))}>
                <TripMap
                  nativeEnabled={capabilities.planning_native_map === true}
                  testID={`blog-day-map-${day.localDate}`}
                  points={dayMapPoints[day.localDate].points.map((point, index) => ({
                    id: `blog-map-${day.localDate}-${index}`, kind: 'activity' as const, lat: point.lat, lng: point.lng,
                    coordinateSource: 'manual' as const,
                    title: dayMapPoints[day.localDate].precision === 'approximate' ? `Approximate area ${index + 1}` : `Photo location ${index + 1}`,
                  }))}
                />
                {dayMapPoints[day.localDate].precision === 'approximate' ? (
                  <Text style={themeStyle('tabs_tripBlog_84', { theme: theme }, (theme ?? _styleTheme))}>Locations are approximate (about 1 km) and omit where the travelers stayed.</Text>
                ) : null}
              </View>
            ) : null}
            {(day.items || []).filter((item) => item.kindKey !== 'core.gallery' && !(item.kindKey && item.kindKey.startsWith('media.'))).map((item) => (
              <View
                key={item.id}
                style={themeStyle('tabs_tripBlog_85', {  }, (theme ?? _styleTheme))}
                ref={Platform.OS === 'web' && canEdit && capabilities.trip_blog_authoring_assist ? (node) => {
                  // react-native-web's View only forwards a fixed prop allowlist onto the
                  // underlying <div> (modules/forwardedProps) -- draggable/onDragStart/onDragOver/
                  // onDrop aren't in it, so passing them as JSX props (the old approach here) gets
                  // silently stripped before the DOM ever sees them, and drag-and-drop never fires.
                  // `ref` IS forwarded straight to that div, so set the native DOM properties
                  // directly instead of going through RN's synthetic prop system.
                  if (!node) return;
                  node.draggable = true;
                  node.ondragstart = (event) => {
                    draggedItemId.current = item.id;
                    event?.dataTransfer?.setData?.('text/plain', item.id);
                  };
                  node.ondragover = (event) => event?.preventDefault?.();
                  node.ondrop = (event) => { event?.preventDefault?.(); void dropItem(day, item); };
                } : undefined}
              >
                {canEdit && capabilities.trip_blog_authoring_assist ? <Text style={themeStyle('tabs_tripBlog_86', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>⠿ Drag to reorder</Text> : null}
                {canEdit && item.sourceId ? <Text style={themeStyle('tabs_tripBlog_87', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{item.sourceDetached ? 'Copied from trip note/location · independent' : 'Linked to trip note/location · editing here disconnects it'}</Text> : null}
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
                    backgroundColor={themeStyle('tabs_tripBlog_197', {  }, (theme ?? _styleTheme))}
                    textColor={textColor}
                  />
                )}
                {(item.tags || []).length ? <Text style={themeStyle('tabs_tripBlog_88', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Note tags: {(item.tags || []).map((tag) => `#${tag}`).join(' ')}</Text> : null}
                {!editMode && item.engagement ? (
                  <View style={themeStyle('tabs_tripBlog_89', {  }, (theme ?? _styleTheme))}>
                    <BlogReactionBar
                      testID={`blog-item-reactions-${item.id}`}
                      targetKind="item"
                      targetId={item.id}
                      summary={engagement.getSummary('item', item.id)}
                      canEngage={canReact}
                      onToggle={engagement.toggle}
                      onError={handleEngagementError}
                      textColor={textColor}
                      mutedColor={mutedColor}
                      theme={theme}
                      size="compact"
                    />
                  </View>
                ) : null}
                {canEdit ? (
                  <>
                    <View style={themeStyle('tabs_tripBlog_90', {  }, (theme ?? _styleTheme))}>
                      {/* FR-A5.1/A5.2: the explicit Save button is gone — edits autosave 1.5s after
                          the last keystroke, and this text is the only save-state affordance. */}
                      {saveStateLabel(`item-${item.id}`) ? (
                        <Text style={themeStyle('tabs_tripBlog_91', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{saveStateLabel(`item-${item.id}`)}</Text>
                      ) : null}
                      {capabilities.trip_blog_authoring_assist ? (
                        <>
                          <TouchableOpacity accessibilityLabel="Move entry up" disabled={reorderBusy || (day.items || [])[0]?.id === item.id} onPress={() => moveItem(day, item, -1)} style={themeStyle('tabs_tripBlog_92', {  }, (theme ?? _styleTheme))}><IconText style={themeStyle('tabs_tripBlog_93', { textColor: textColor }, (theme ?? _styleTheme))}>↑</IconText></TouchableOpacity>
                          <TouchableOpacity accessibilityLabel="Move entry down" disabled={reorderBusy || (day.items || [])[(day.items || []).length - 1]?.id === item.id} onPress={() => moveItem(day, item, 1)} style={themeStyle('tabs_tripBlog_94', {  }, (theme ?? _styleTheme))}><IconText style={themeStyle('tabs_tripBlog_95', { textColor: textColor }, (theme ?? _styleTheme))}>↓</IconText></TouchableOpacity>
                        </>
                      ) : null}
                      <TouchableOpacity style={[styles.button, themeStyle('tabs_tripBlog_96', { theme: theme }, (theme ?? _styleTheme))]} disabled={deleting} onPress={() => deleteItem(item)}><Text style={styles.buttonText}>{deleting ? 'Removing…' : 'Remove'}</Text></TouchableOpacity>
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
              // Voice notes are pulled out of the photo/video set entirely, not just filtered by
              // readiness -- DayMediaGallery's mosaic forces every tile into a fixed-height cropped
              // frame built for images, which mangles an <audio> player (or squishes the native
              // "Play voice note" button) even once it has a real primaryUrl. A voice note reads
              // as its own note (transcript first, playback control below), same idea as a plain
              // text note, never as a mosaic tile.
              const isAudioMediaItem = (item) => item.mediaKind === 'audio' || item.kindKey === 'media.audio';
              const audioItems = allMedia.filter(isAudioMediaItem);
              const visualMedia = allMedia.filter((item) => !isAudioMediaItem(item));
              const readyMedia = visualMedia.filter((item) => item.thumbnailUrl || item.primaryUrl);
              const processingMedia = visualMedia.filter((item) => !(item.thumbnailUrl || item.primaryUrl));
              return (
                <>
                  {readyMedia.length ? (
                    <>
                      {canEdit && capabilities.trip_blog_reactions ? (
                        <TouchableOpacity testID={`blog-cover-proposal-${day.localDate}`} onPress={() => loadCoverProposal(day.localDate)} style={themeStyle('tabs_tripBlog_97', {  }, (theme ?? _styleTheme))}>
                          <IconText style={themeStyle('tabs_tripBlog_98', { theme: theme }, (theme ?? _styleTheme))}>{coverProposals[day.localDate] ? '♥ Most-loved photo selected below' : 'Find the most-loved photo'}</IconText>
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
                        theme={theme}
                        canEditMetadata={canEdit && capabilities.trip_blog_alt_text}
                        canSuggestMetadata={canEdit && capabilities.trip_blog_caption_ai}
                        canRecordCaption={canEdit && capabilities.trip_blog_audio_transcription}
                        metadataBusy={Boolean(metadataBusyAssetId)}
                        onSaveMetadata={saveMediaMetadata}
                        onSuggestMetadata={suggestMediaMetadata}
                        onTranscribeMetadata={transcribeMediaCaption}
                        proposedCoverAssetId={coverProposals[day.localDate]?.assetId}
                      />
                    </>
                  ) : null}
                  {processingMedia.map((item) => (
                    <View key={item.id} style={themeStyle('tabs_tripBlog_99', { borderColor: borderColor, inputColor: inputColor }, (theme ?? _styleTheme))}>
                      <IconText style={themeStyle('tabs_tripBlog_100', { textColor: textColor }, (theme ?? _styleTheme))}>{item.kindKey === 'media.video' ? '🎬 Video' : '📷 Photo'} — {item.state === 'ready' ? 'processed, no preview available' : (item.state || 'processing')}</IconText>
                      {item.caption ? <Text style={themeStyle('tabs_tripBlog_101', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{item.caption}</Text> : null}
                      {canEdit ? (
                        <TouchableOpacity style={[styles.button, themeStyle('tabs_tripBlog_102', { theme: theme }, (theme ?? _styleTheme))]} disabled={deleting} onPress={() => removeMediaItem(item)}>
                          <Text style={styles.buttonText}>{deleting ? 'Removing…' : 'Remove'}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ))}
                  {audioItems.map((item) => (
                    <View key={item.id} testID={`blog-voice-note-${item.id}`} style={themeStyle('tabs_tripBlog_103', { borderColor: borderColor, inputColor: inputColor }, (theme ?? _styleTheme))}>
                      <IconText style={themeStyle('tabs_tripBlog_104', { textColor: textColor }, (theme ?? _styleTheme))}>🎙 Voice note</IconText>
                      {item.caption ? <Text style={themeStyle('tabs_tripBlog_105', { textColor: textColor }, (theme ?? _styleTheme))}>{item.caption}</Text> : null}
                      {item.primaryUrl ? (
                        <View style={themeStyle('tabs_tripBlog_106', {  }, (theme ?? _styleTheme))}>
                          <BlogMediaPreview item={item} backgroundColor={inputColor} />
                        </View>
                      ) : (
                        <Text style={themeStyle('tabs_tripBlog_107', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
                          {item.state === 'ready' ? 'Audio unavailable — please add this voice note again.' : 'Upload incomplete — please add this voice note again.'}
                        </Text>
                      )}
                      {canEdit ? (
                        <TouchableOpacity style={[styles.button, themeStyle('tabs_tripBlog_108', { theme: theme }, (theme ?? _styleTheme))]} disabled={deleting} onPress={() => removeMediaItem(item)}>
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
                    canRemove={canEdit}
                    removing={deleting}
                    onRemove={(item) => removeMediaItem(item)}
                    canEngage={canEngage}
                    canReact={canReact}
                    getEngagementSummary={(assetId) => engagement.getSummary('asset', assetId)}
                    onToggleReaction={engagement.toggle}
                    onReactionError={handleEngagementError}
                    theme={theme}
                    currentUserId={currentUserId}
                    canModerate={isTripOwnerOrAdmin || !readOnly}
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
                reactionTotal={editMode ? 0 : day.engagement?.reactionTotal}
                spotlightUserId={editMode ? null : spotlightForDay(day)}
                mutedColor={mutedColor}
              />
            ) : null}
            {!publicPreview && day.engagement && (day.items || []).length > 0 ? (
              <View style={themeStyle('tabs_tripBlog_109', { borderColor: borderColor }, (theme ?? _styleTheme))}>
                <BlogCommentThread
                  testID={`blog-day-comments-${day.localDate}`}
                  comments={comments.getDayState(day.localDate).comments.filter((c) => c.targetKind === 'day' && c.targetId === day.id)}
                  targetKind="day"
                  targetId={day.id}
                  currentUserId={currentUserId}
                  canModerate={isTripOwnerOrAdmin || !readOnly}
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
            {canEdit && (day.activities || []).length > 0 ? (
              <View style={themeStyle('tabs_tripBlog_110', {  }, (theme ?? _styleTheme))}>
                <Text style={themeStyle('tabs_tripBlog_111', { textColor: textColor }, (theme ?? _styleTheme))}>Planned activities</Text>
                {(day.activities || []).map((activity) => (
                  <View key={activity.id} style={themeStyle('tabs_tripBlog_112', { theme: theme }, (theme ?? _styleTheme))}>
                    <Text style={themeStyle('tabs_tripBlog_113', { textColor: textColor }, (theme ?? _styleTheme))}>{activity.name}</Text>
                    <Text style={themeStyle('tabs_tripBlog_114', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{activity.activityType}{activity.startTime ? ` · ${activity.startTime}` : ''}{activity.startLocation ? ` · ${activity.startLocation}` : ''}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {canEdit && addingDay === day.localDate ? (
              <View style={themeStyle('tabs_tripBlog_115', {  }, (theme ?? _styleTheme))}>
                {capabilities.trip_blog_authoring_assist ? (
                  <View testID={`blog-writing-prompts-${day.localDate}`} style={themeStyle('tabs_tripBlog_116', {  }, (theme ?? _styleTheme))}>
                    {promptsForDay(day.localDate).map((prompt) => (
                      <TouchableOpacity key={prompt} accessibilityRole="button" onPress={() => setNewBody(`<p><strong>${prompt}</strong></p><p></p>`)} style={themeStyle('tabs_tripBlog_117', { borderColor: borderColor, inputColor: inputColor }, (theme ?? _styleTheme))}>
                        <Text style={themeStyle('tabs_tripBlog_118', { textColor: textColor }, (theme ?? _styleTheme))}>{prompt}</Text>
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
                <TextInput
                  testID={`blog-new-note-tags-${day.localDate}`}
                  value={newTags}
                  onChangeText={setNewTags}
                  placeholder="Tags (optional, comma-separated)"
                  placeholderTextColor={mutedColor}
                  style={themeStyle('tabs_tripBlog_119', { textColor: textColor, borderColor: borderColor }, (theme ?? _styleTheme))}
                />
                <View style={themeStyle('tabs_tripBlog_120', {  }, (theme ?? _styleTheme))}>
                  <TouchableOpacity style={styles.button} disabled={creating || isRichTextEmpty(newBody)} onPress={() => createTextItem(day.localDate)}><Text style={styles.buttonText}>{creating ? 'Adding…' : 'Add to blog'}</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.button, themeStyle('tabs_tripBlog_121', { theme: theme }, (theme ?? _styleTheme))]} onPress={() => { setAddingDay(null); setNewTags(''); }}><Text style={themeStyle('tabs_tripBlog_122', { textColor: textColor }, (theme ?? _styleTheme))}>Cancel</Text></TouchableOpacity>
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
                    accentColor={theme?.colors?.link ?? themeStyle('tabs_tripBlog_198', {  }, (theme ?? _styleTheme))}
                    styles={styles}
                  />
                ) : null}
                <Text style={themeStyle('tabs_tripBlog_123', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
                  {dayStarters[day.localDate]?.draft ? 'Or start from scratch — click “+ Add note”.' : 'No notes yet. Click “+ Add note” to start this day.'}
                </Text>
                {capabilities.trip_blog_authoring_assist ? (
                  <View style={themeStyle('tabs_tripBlog_124', {  }, (theme ?? _styleTheme))}>
                    {promptsForDay(day.localDate).map((prompt) => (
                      <TouchableOpacity key={prompt} onPress={() => { setAddingDay(day.localDate); setNewBody(`<p><strong>${prompt}</strong></p><p></p>`); }} style={themeStyle('tabs_tripBlog_125', { borderColor: borderColor }, (theme ?? _styleTheme))}>
                        <Text style={themeStyle('tabs_tripBlog_126', { textColor: textColor }, (theme ?? _styleTheme))}>{prompt}</Text>
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
            style={[styles.button, themeStyle('tabs_tripBlog_127', {  }, (theme ?? _styleTheme))]}
            onPress={loadMore}
            disabled={loading}
          >
            <Text style={[styles.buttonText, themeStyle('tabs_tripBlog_128', {  }, (theme ?? _styleTheme))]}>
              {loading ? 'Loading...' : 'Load more days'}
            </Text>
          </TouchableOpacity>
        ) : null}
        {/* Phase 0 reorder — the recap is the "Relive this trip" moment (redesign notes §1), kept
            prominent after the last day rather than buried above the story. */}
        {capabilities.trip_blog_recap && canReliveTrip ? (
          <View style={themeStyle('tabs_tripBlog_129', {  }, (theme ?? _styleTheme))} onLayout={(e) => { recapY.current = e.nativeEvent.layout.y; }}>
            {recap ? (
              <TripRecapCards
                nativeEnabled={capabilities.planning_native_map === true}
                mapDays={Object.entries(publicPreview ? {} : dayMapPoints).map(([dayDate, mapPoints]) => ({ dayDate, mapPoints }))}
                recap={recap}
                topPhotoUrl={visibleDays.flatMap(mediaForDay).find((item) => item.assetId === recap?.topPhoto?.assetId)?.primaryUrl}
                fallbackPhotoUrl={visibleDays.flatMap(mediaForDay).find((item) => item.mediaKind === 'photo' && (item.primaryUrl || item.thumbnailUrl))?.primaryUrl}
                shareUrl={publicPageUrl}
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
              <View>
                <TouchableOpacity testID="trip-blog-build-recap" accessibilityRole="button" disabled={recapBusy} onPress={() => loadRecap()} style={[styles.button, themeStyle('tabs_tripBlog_130', { theme: theme }, (theme ?? _styleTheme))]}>
                  <Text style={styles.buttonText}>{recapBusy ? 'Building recap…' : 'Relive this trip'}</Text>
                </TouchableOpacity>
                {recapNotice ? <Text style={themeStyle('tabs_tripBlog_131', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{recapNotice}</Text> : null}
              </View>
            )}
          </View>
        ) : null}
        {/* Phase 0 reorder — search, places, privacy/publication, and the spend figure are utility
            controls, not story — collapsed here instead of crowding the masthead (redesign notes
            §1/§4's "Blog tools" drawer). Hidden entirely when the current viewer (e.g. a follower)
            has nothing in it. */}
        {blogToolsHasContent ? (
        <View style={themeStyle('tabs_tripBlog_132', {  }, (theme ?? _styleTheme))}>
          <TouchableOpacity
            testID="blog-tools-toggle"
            accessibilityRole="button"
            onPress={() => setShowBlogTools((current) => !current)}
            style={themeStyle('tabs_tripBlog_133', {  }, (theme ?? _styleTheme))}
          >
            <IconText style={themeStyle('tabs_tripBlog_134', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{showBlogTools ? '▾' : '▸'} Blog tools</IconText>
          </TouchableOpacity>
          {showBlogTools ? (
            <View testID="blog-tools-panel" style={themeStyle('tabs_tripBlog_135', { surfaceColor: surfaceColor }, (theme ?? _styleTheme))}>
              {canEdit && activeTripId ? (
                <>
                  <TouchableOpacity testID="blog-public-preview-open" accessibilityRole="button" style={styles.button} onPress={() => setShowPublicPreview(true)}>
                    <Text style={styles.buttonText}>Preview as public</Text>
                  </TouchableOpacity>
                  <BlogPublicPreview visible={showPublicPreview} tripId={activeTripId} headers={headers} onClose={() => setShowPublicPreview(false)} styles={styles} />
                </>
              ) : null}
              {canEdit ? (
                <View style={themeStyle('tabs_tripBlog_136', { borderColor: borderColor, inputColor: inputColor }, (theme ?? _styleTheme))}>
                  <View style={themeStyle('tabs_tripBlog_137', {  }, (theme ?? _styleTheme))}>
                    <Text style={themeStyle('tabs_tripBlog_138', { textColor: textColor }, (theme ?? _styleTheme))}>
                      Public viewing: {publicationState === 'public' ? 'On' : publicationState === 'pending_consent' ? 'Awaiting consent' : 'Off'}
                    </Text>
                    {publicationState === 'public' ? (
                      <TouchableOpacity testID="blog-make-private" accessibilityRole="button" style={[styles.button, themeStyle('tabs_tripBlog_139', { theme: theme }, (theme ?? _styleTheme))]} disabled={publicationBusy} onPress={() => setPublicOptOut(true)}>
                        <Text style={themeStyle('tabs_tripBlog_140', { textColor: textColor }, (theme ?? _styleTheme))}>{publicationBusy ? 'Updating…' : 'Make private'}</Text>
                      </TouchableOpacity>
                    ) : hasPendingConsent ? (
                      <View style={themeStyle('tabs_tripBlog_141', {  }, (theme ?? _styleTheme))}>
                        <TouchableOpacity style={[styles.button, themeStyle('tabs_tripBlog_142', {  }, (theme ?? _styleTheme))]} disabled={publicationBusy} onPress={() => respondToPublication('approved')}>
                          <Text style={styles.buttonText}>{publicationBusy ? 'Updating…' : 'Approve'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.button, themeStyle('tabs_tripBlog_143', { theme: theme }, (theme ?? _styleTheme))]} disabled={publicationBusy} onPress={() => respondToPublication('declined')}>
                          <Text style={themeStyle('tabs_tripBlog_144', { textColor: textColor }, (theme ?? _styleTheme))}>Decline</Text>
                        </TouchableOpacity>
                      </View>
                    ) : publicationState === 'pending_consent' ? (
                      <Text style={themeStyle('tabs_tripBlog_145', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Waiting for other adult travelers</Text>
                    ) : blog?.publicOptOut ? (
                      <TouchableOpacity testID="blog-allow-public" accessibilityRole="button" style={[styles.button, themeStyle('tabs_tripBlog_146', {  }, (theme ?? _styleTheme))]} disabled={publicationBusy} onPress={() => setPublicOptOut(false)}>
                        <Text style={styles.buttonText}>{publicationBusy ? 'Updating…' : 'Allow public viewing'}</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={[styles.button, themeStyle('tabs_tripBlog_147', {  }, (theme ?? _styleTheme))]} disabled={publicationBusy} onPress={requestPublication}>
                        <Text style={styles.buttonText}>{publicationBusy ? 'Requesting…' : 'Make public'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {publicationState !== 'public' && activeTripId ? <BlogPublicationChecklist tripId={activeTripId} backendUrl={backendUrl} headers={headers} refreshKey={`${publicationState}:${blog?.publicOptOut ? 1 : 0}:${missingAccessibilityCount}`} styles={styles} /> : null}
                  {publicationNotice ? <Text style={themeStyle('tabs_tripBlog_148', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{publicationNotice}</Text> : null}
                  {publicationState === 'public' && capabilities.trip_blog_alt_text && missingAccessibilityCount > 0 ? (
                    <Text testID="blog-accessibility-remediation" style={themeStyle('tabs_tripBlog_149', {  }, (theme ?? _styleTheme))}>
                      Accessibility reminder: {missingAccessibilityCount} public {missingAccessibilityCount === 1 ? 'photo needs' : 'photos need'} alt text or a decorative mark. Your existing public blog remains available while you fix this.
                    </Text>
                  ) : null}
                  <Text style={themeStyle('tabs_tripBlog_150', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
                    {publicationState === 'public'
                      ? 'Anyone can view this blog on the web. Any traveler can make it private.'
                      : blog?.publicOptOut
                        ? 'A traveler made this blog private for public viewing.'
                        : 'The blog goes public automatically when the trip starts, if every traveler is 16+ with a date of birth in their profile, public photos have alt text, and no one has chosen private. Otherwise, public viewing needs consent from all adult account travelers.'}
                    {' '}Travelers and followers can always see this blog.
                  </Text>
                </View>
              ) : null}
              {canEdit && !readOnly && <ActivitySharingControls tripId={activeTripId} backendUrl={backendUrl} headers={headers} />}
              {canEdit && !readOnly ? (
                <View testID="blog-photo-location-settings" style={themeStyle('tabs_tripBlog_151', { borderColor: borderColor, inputColor: inputColor }, (theme ?? _styleTheme))}>
                  <Text style={themeStyle('tabs_tripBlog_152', { textColor: textColor }, (theme ?? _styleTheme))}>Keep photo locations: {blog?.photoLocationEnabled ? 'On' : 'Off'}</Text>
                  <Text style={themeStyle('tabs_tripBlog_153', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
                    Off by default. When on, photos added from now on keep where they were taken, which lets this trip draw a map of each day. Photos already added are not changed, and turning this off does not remove locations already saved. Only travelers see exact locations; followers see a map only if you also share day maps below.
                  </Text>
                  <TouchableOpacity
                    testID="blog-photo-location-toggle"
                    accessibilityRole="switch"
                    accessibilityState={{ checked: Boolean(blog?.photoLocationEnabled), disabled: photoLocationBusy }}
                    disabled={photoLocationBusy}
                    onPress={() => setPhotoLocation(!blog?.photoLocationEnabled)}
                    style={[styles.button, themeStyle('tabs_tripBlog_154', { blog: blog, theme: theme }, (theme ?? _styleTheme))]}
                  >
                    <Text style={blog?.photoLocationEnabled ? themeStyle('tabs_tripBlog_155', { textColor: textColor }, (theme ?? _styleTheme)) : styles.buttonText}>{photoLocationBusy ? 'Updating…' : blog?.photoLocationEnabled ? 'Stop keeping locations' : 'Keep photo locations'}</Text>
                  </TouchableOpacity>
                  {photoLocationNotice ? <Text style={themeStyle('tabs_tripBlog_156', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{photoLocationNotice}</Text> : null}
                </View>
              ) : null}
              {canEdit && !readOnly ? (
                <View testID="blog-shared-map-settings" style={themeStyle('tabs_tripBlog_157', { borderColor: borderColor, inputColor: inputColor }, (theme ?? _styleTheme))}>
                  <Text style={themeStyle('tabs_tripBlog_158', { textColor: textColor }, (theme ?? _styleTheme))}>Follower day maps: {blog?.sharedMapEnabled ? 'On' : 'Off'}</Text>
                  <Text style={themeStyle('tabs_tripBlog_159', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
                    Off by default. When on, followers see a map of each day built from your photo locations, rounded to about 1 km, without places near where you stayed. Any traveler can change this. Travelers always see their own exact locations.
                  </Text>
                  {blog?.sharedMapEnabled ? (
                    <TouchableOpacity testID="blog-shared-map-off" accessibilityRole="button" disabled={mapShareBusy} onPress={() => setSharedMap(false)} style={[styles.button, themeStyle('tabs_tripBlog_160', { theme: theme }, (theme ?? _styleTheme))]}>
                      <Text style={themeStyle('tabs_tripBlog_161', { textColor: textColor }, (theme ?? _styleTheme))}>{mapShareBusy ? 'Updating…' : 'Stop sharing maps'}</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={themeStyle('tabs_tripBlog_162', {  }, (theme ?? _styleTheme))}>
                      <TouchableOpacity testID="blog-shared-map-preview" accessibilityRole="button" disabled={mapShareBusy} onPress={loadMapPreview} style={[styles.button, themeStyle('tabs_tripBlog_163', { theme: theme }, (theme ?? _styleTheme))]}>
                        <Text style={themeStyle('tabs_tripBlog_164', { textColor: textColor }, (theme ?? _styleTheme))}>{mapShareBusy && !mapPreview ? 'Building preview…' : 'Preview what followers would see'}</Text>
                      </TouchableOpacity>
                      {mapPreview ? (
                        <View testID="blog-shared-map-preview-result" style={themeStyle('tabs_tripBlog_165', {  }, (theme ?? _styleTheme))}>
                          {mapPreview.length === 0 ? (
                            <Text style={themeStyle('tabs_tripBlog_166', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>No day has enough photo locations to show a map, so followers would see none.</Text>
                          ) : (
                            <>
                              <Text style={themeStyle('tabs_tripBlog_167', { textColor: textColor }, (theme ?? _styleTheme))}>Followers would see a map on {mapPreview.length} {mapPreview.length === 1 ? 'day' : 'days'}:</Text>
                              {mapPreview.map((day) => (
                                <View key={day.dayDate} style={themeStyle('tabs_tripBlog_168', {  }, (theme ?? _styleTheme))}>
                                  <Text style={themeStyle('tabs_tripBlog_169', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{day.dayDate} · {day.points.length} approximate areas</Text>
                                  {Platform.OS === 'web' ? (
                                    <TripMap
                                      testID={`blog-shared-map-preview-${day.dayDate}`}
                                      points={day.points.map((point, index) => ({ id: `preview-${day.dayDate}-${index}`, kind: 'activity' as const, lat: point.lat, lng: point.lng, coordinateSource: 'manual' as const, title: `Approximate area ${index + 1}` }))}
                                    />
                                  ) : null}
                                </View>
                              ))}
                            </>
                          )}
                          <TouchableOpacity testID="blog-shared-map-on" accessibilityRole="button" disabled={mapShareBusy || mapPreview.length === 0} onPress={() => setSharedMap(true)} style={[styles.button, themeStyle('tabs_tripBlog_170', { mapPreview: mapPreview }, (theme ?? _styleTheme))]}>
                            <Text style={styles.buttonText}>{mapShareBusy ? 'Updating…' : 'Share these maps with followers'}</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  )}
                  {mapShareNotice ? <Text style={themeStyle('tabs_tripBlog_171', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{mapShareNotice}</Text> : null}
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
                onRated={() => { void load(); }}
              />
              {capabilities.trip_blog_spend_summary && !readOnly ? (
                <View testID="trip-blog-spend-summary" style={themeStyle('tabs_tripBlog_172', { borderColor: borderColor, inputColor: inputColor }, (theme ?? _styleTheme))}>
                  <Text style={themeStyle('tabs_tripBlog_173', { textColor: textColor }, (theme ?? _styleTheme))}>Trip spend: {new Intl.NumberFormat(undefined, { style: 'currency', currency: tripCurrency }).format(spendTotal)}</Text>
                  <Text style={themeStyle('tabs_tripBlog_174', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Calculated on this device from the trip's expenses.</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        ) : null}
        </View>
      </ScrollView>
      <PhotoFirstComposer
        visible={!!composerFiles}
        files={composerFiles || []}
        dayDates={visibleDays.map((day) => day.localDate)}
        defaultDayDate={composerDefaultDay}
        defaultTags={composerDefaultTags}
        context={{ backendUrl, headers, tripId: uploadTripId || activeTripId }}
        onClose={closePhotoComposer}
        onCommitted={handleComposerCommitted}
        styles={styles}
        theme={theme}
        textColor={textColor}
        mutedColor={mutedColor}
        borderColor={borderColor}
        backgroundColor={surfaceColor}
      />
      <Modal visible={!!quickCaptureAsset} transparent animationType="slide" onRequestClose={() => setQuickCaptureAsset(null)}>
        <View style={themeStyle('tabs_tripBlog_175', {  }, (theme ?? _styleTheme))}>
          <View style={themeStyle('tabs_tripBlog_176', { surfaceColor: surfaceColor }, (theme ?? _styleTheme))}>
            <ScrollView>
              <Text style={themeStyle('tabs_tripBlog_177', { textColor: textColor }, (theme ?? _styleTheme))}>Photo added</Text>
              <Text style={themeStyle('tabs_tripBlog_178', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Add a caption now, or tap Done to add one later.</Text>
              {quickCaptureAsset ? (
                <BlogMediaMetadataEditor
                  item={quickCaptureAsset}
                  canSuggest={Boolean(capabilities.trip_blog_caption_ai)}
                  canRecord={Boolean(capabilities.trip_blog_audio_transcription)}
                  busy={metadataBusyAssetId === quickCaptureAsset.assetId}
                  onSave={(patch) => saveMediaMetadata(quickCaptureAsset, patch)}
                  onSuggest={() => suggestMediaMetadata(quickCaptureAsset)}
                  onTranscribe={(recording) => transcribeMediaCaption(quickCaptureAsset, recording)}
                  textColor={textColor}
                  mutedColor={mutedColor}
                  borderColor={borderColor}
                  backgroundColor={inputColor}
                  styles={styles}
                  theme={theme}
                />
              ) : null}
              <TouchableOpacity
                testID="blog-quick-capture-done"
                style={[styles.button, themeStyle('tabs_tripBlog_179', { theme: theme }, (theme ?? _styleTheme))]}
                onPress={() => setQuickCaptureAsset(null)}
              >
                <Text style={themeStyle('tabs_tripBlog_180', { textColor: textColor }, (theme ?? _styleTheme))}>Done</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal visible={showQuotaModal} transparent animationType="slide" onRequestClose={() => setShowQuotaModal(false)}>
        <View style={themeStyle('tabs_tripBlog_181', {  }, (theme ?? _styleTheme))}>
          <View style={themeStyle('tabs_tripBlog_182', { surfaceColor: surfaceColor }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('tabs_tripBlog_183', { textColor: textColor }, (theme ?? _styleTheme))}>Storage quota exceeded</Text>
            <Text style={themeStyle('tabs_tripBlog_184', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>You don't have enough storage to upload this photo. Upgrade your storage to continue.</Text>
            {storagePlans.map(plan => (
              <TouchableOpacity
                key={plan.planKey}
                style={[styles.button, themeStyle('tabs_tripBlog_185', {  }, (theme ?? _styleTheme))]}
                onPress={() => purchaseStorage(plan.planKey)}
              >
                <Text style={styles.buttonText}>Add {plan.planKey.split('_')[1].toUpperCase()} Storage</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.button, themeStyle('tabs_tripBlog_187', { theme: theme }, (theme ?? _styleTheme))]}
              onPress={() => setShowQuotaModal(false)}
            >
              <Text style={themeStyle('tabs_tripBlog_188', { textColor: textColor }, (theme ?? _styleTheme))}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default TripBlogTab;
