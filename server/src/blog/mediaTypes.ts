export type BlogMediaKind = 'photo' | 'video' | 'audio' | 'panorama';

export interface BlogStorageSummary {
  userId: string;
  includedBytes: number;
  purchasedBytes: number;
  reservedBytes: number;
  visibleCommittedBytes: number;
  graceHiddenBytes: number;
  availableBytes: number;
  entitlementActive: boolean;
  graceStartedAt: string | null;
}

export interface BlogMediaAsset {
  id: string;
  tripId: string;
  blogItemId: string;
  dayDate: string;
  uploaderUserId: string;
  mediaKind: BlogMediaKind;
  state: string;
  sourceMimeType: string;
  physicalBytes: number;
  billableBytes: number;
  capturedAt: string | null;
  // Phase 5 of docs/trip-blog-social-implementation-plan.md, architecture §3.3/§7.1/C2 — EXIF
  // geotags captured client-side at upload (server never parses EXIF itself), stored only when the
  // trip's photo_location_enabled toggle was on at upload time (PR-3: enabling later is not
  // retroactive — see initUpload in postgresMediaRepository.ts). `undefined` here means "this read
  // path doesn't project it at all" (e.g. any public/follower-facing asset shape); `null` means "no
  // geotag, or the toggle was off."
  capturedLat?: number | null;
  capturedLng?: number | null;
  caption: string | null;
  altText: string | null;
  isDecorative?: boolean;
  createdAt?: string;
  primaryUrl?: string | null;
  thumbnailUrl?: string | null;
  isHighlight?: boolean;
  // The parent blog_items row's kind_key ('media.photo' | 'media.video' | 'core.gallery') — distinct
  // from mediaKind above, which is the asset's own photo/video/audio/panorama type. Used by
  // GET /:tripId/blog to decide whether an asset renders as its own standalone item or gets grouped
  // into its parent gallery's `assets` array.
  parentKindKey?: string;
  position?: number;
}

export interface BlogUploadInitInput {
  tripId: string;
  dayDate: string;
  mediaKind: BlogMediaKind;
  mimeType: string;
  byteSize: number;
  capturedAt?: string | null;
  // Only ever persisted by the repository when the trip's photo_location_enabled toggle is on at
  // upload time — the route/repository, not the caller, enforces that gate (see initUpload).
  capturedLat?: number | null;
  capturedLng?: number | null;
  caption?: string | null;
  altText?: string | null;
  idempotencyKey: string;
  // When set, the uploaded asset joins this existing core.gallery item instead of creating a new
  // standalone blog item. The gallery's own day is authoritative; dayDate above is ignored in that case.
  galleryItemId?: string | null;
}

export type BlogMediaAuthoringContext = {
  id: string;
  tripId: string;
  dayDate: string;
  dayHeadline: string | null;
  caption: string | null;
  altText: string | null;
  isDecorative: boolean;
};

export type BlogMediaMetadataPatch = {
  caption?: string | null;
  altText?: string | null;
  isDecorative?: boolean;
};

export interface BlogUploadInitResult {
  asset: BlogMediaAsset;
  uploadUrl: string | null;
  objectKey: string;
  expiresAt: string;
  storageMode: 'gcs' | 'managed';
}
