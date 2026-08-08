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
  sourceType?: 'itinerary_detail' | null;
  sourceId?: string | null;
  sourceDetached?: boolean;
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
  };
}

export interface BlogTextInput {
  dayDate: string;
  body: string;
  languageTag?: string | null;
  audience?: BlogAudience;
}

export interface BlogTextPatch {
  body?: string;
  languageTag?: string | null;
  audience?: BlogAudience;
  version: number;
}
