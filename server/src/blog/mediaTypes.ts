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
  caption: string | null;
  altText: string | null;
  createdAt?: string;
  primaryUrl?: string | null;
  thumbnailUrl?: string | null;
  isHighlight?: boolean;
}

export interface BlogUploadInitInput {
  tripId: string;
  dayDate: string;
  mediaKind: BlogMediaKind;
  mimeType: string;
  byteSize: number;
  capturedAt?: string | null;
  caption?: string | null;
  altText?: string | null;
  idempotencyKey: string;
}

export interface BlogUploadInitResult {
  asset: BlogMediaAsset;
  uploadUrl: string | null;
  objectKey: string;
  expiresAt: string;
  storageMode: 'gcs' | 'managed';
}
