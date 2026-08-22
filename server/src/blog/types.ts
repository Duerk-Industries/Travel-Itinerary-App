import { BlogMediaAsset } from './mediaTypes';

export type BlogAudience = 'travelers' | 'followers' | 'public';

export type BlogItemKind =
  | 'core.text'
  | 'media.photo'
  | 'media.video'
  | 'media.audio'
  | 'media.panorama'
  | 'core.gallery'
  | 'core.structured_card'
  | 'core.export'
  | 'core.translation'
  | 'core.ai_highlight';

export interface BlogItemTypeDescriptor {
  kindKey: BlogItemKind;
  schemaVersion: number;
  featureFlag: string;
  defaultAudience: BlogAudience;
  supportsPublic: boolean;
  supportsExport: boolean;
  maxBytes?: number;
}

export interface BlogTextItem {
  id: string;
  tripId: string;
  blogDayId: string;
  localDate: string;
  kindKey: 'core.text';
  schemaVersion: number;
  audience: BlogAudience;
  sortKey: string;
  authorUserId: string;
  lastEditorUserId: string;
  version: number;
  body: string;
  languageTag: string | null;
  createdAt: string;
  updatedAt: string;
  sourceType?: 'itinerary_detail' | 'day_starter' | null;
  sourceId?: string | null;
  sourceDetached?: boolean;
}

export interface BlogGalleryItem {
  id: string;
  tripId: string;
  blogDayId: string;
  localDate: string;
  kindKey: 'core.gallery';
  schemaVersion: number;
  audience: BlogAudience;
  sortKey: string;
  authorUserId: string;
  lastEditorUserId: string;
  version: number;
  caption: string | null;
  createdAt: string;
  updatedAt: string;
  assets: BlogMediaAsset[];
}

export interface BlogDay {
  id: string;
  tripId: string;
  localDate: string;
  headline: string | null;
  summary: string | null;
  items: BlogTextItem[];
  activities?: BlogActivity[];
  weather?: {
    icon: string;
    description: string;
    temperatureHighC: number | null;
  };
  // `coverAssetId` is the raw blog_media_assets id a traveler explicitly picked (or null),
  // as returned straight from the repository layer. The route resolves it (plus that day's
  // merged media items, not visible to the repository at this stage) into `coverItemId`/
  // `coverIsExplicit` before the response goes out — see GET /:tripId/blog in blogRoutes.ts.
  // A cover can point at an asset that's since been hidden/deleted; ON DELETE SET NULL on the
  // column handles a hard delete, but a grace-hidden asset is still a row, just absent from
  // `items`, so the route must re-verify presence rather than trusting this id blindly.
  coverAssetId?: string | null;
  coverItemId?: string | null;
  coverIsExplicit?: boolean;
  // Optimistic-concurrency counter for headline/summary edits (architecture §4.05, FR-A3.3).
  // Every PATCH to a day's headline/summary must echo this value back; a mismatch means someone
  // else edited the day first and the write is rejected with 409 VERSION_CONFLICT rather than
  // silently overwritten — the same contract blog_items.version already gives text items.
  updateVersion?: number;
}

export interface BlogActivity {
  id: string;
  name: string;
  activityType: string;
  date: string;
  startTime: string | null;
  duration: string | null;
  status: string | null;
  startLocation: string | null;
  notes: string | null;
}

export interface BlogDocument {
  id: string;
  tripId: string;
  title: string;
  subtitle: string | null;
  introduction: string | null;
  contentRevision: number;
  visibilityState: 'private' | 'pending_consent' | 'public';
  visibilityEpoch: number;
  // Phase 5 (C2, PR-3) — off by default; see BlogMastheadPatch.photoLocationEnabled.
  photoLocationEnabled: boolean;
  days: BlogDay[];
}

export interface BlogCapabilities {
  enabled: boolean;
  writable: boolean;
  kinds: Array<BlogItemTypeDescriptor & { enabled: boolean }>;
  limits: {
    maxTextBlocksPerDay: number;
    maxMediaItemsPerDay: number;
    videoMaxDurationSeconds: number;
    maxAssetsPerGallery: number;
  };
}

export interface BlogTextInput {
  dayDate: string;
  body: string;
  languageTag?: string | null;
  audience?: BlogAudience;
  // Phase 5 (A1) — stamped 'day_starter' when this item was accepted from the Day Starter
  // suggestion, so its acceptance rate is measurable (architecture §8's stage-2 rollout gate
  // depends on this existing). Unset for every other authoring path.
  sourceType?: string | null;
}

export interface BlogTextPatch {
  body?: string;
  languageTag?: string | null;
  audience?: BlogAudience;
  version: number;
}

// Returned instead of `null` specifically for a version mismatch, so the route can shape a 409
// body carrying the latest authorized state (architecture §5.5's autosave conflict contract) —
// as opposed to a bare `null`, which still means "item not found or already deleted" and keeps
// today's plain 409 with no state attached.
export type BlogTextUpdateResult = BlogTextItem | { conflict: true; latest: BlogTextItem | null } | null;

// Phase 1 (A3/A4): day headline/summary and blog masthead editing. Both PATCH shapes are
// partial — an omitted field is left unchanged — so a client editing only the headline never
// has to round-trip the summary it isn't touching.
export interface BlogDayMetaPatch {
  headline?: string | null;
  summary?: string | null;
  updateVersion: number;
}

export type BlogDayMetaUpdateResult = BlogDay | { conflict: true; latest: BlogDay | null } | null;

export interface BlogMastheadPatch {
  title?: string;
  subtitle?: string | null;
  introduction?: string | null;
  // Phase 5 (C2, PR-3) — the trip-level geotag toggle. Not retroactive: turning this on does not
  // backfill lat/lng onto assets already uploaded while it was off (see initUpload in
  // postgresMediaRepository.ts/firebaseMediaRepository.ts, which reads the current value at
  // upload time only).
  photoLocationEnabled?: boolean;
}
