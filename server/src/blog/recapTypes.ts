export type BlogRecapAudienceClass = 'travelers' | 'followers';

export type BlogRecapPayload = {
  tripId: string;
  title: string;
  dayCount: number;
  startDate: string | null;
  endDate: string | null;
  placeCount: number;
  distanceKm: number;
  photoCount: number;
  videoCount: number;
  travelerCount: number;
  followerParticipantCount: number;
  topPhoto: { assetId: string; reactionTotal: number; caption: string | null; altText: string | null } | null;
  topContributors: Array<{ userId: string; displayName: string; contributionCount: number }>;
  topPhotoContributor: { userId: string; displayName: string; photoCount: number } | null;
  mostCommentedDay: { dayDate: string; commentCount: number } | null;
  generatedAt: string;
  audienceClass: BlogRecapAudienceClass;
};

export type BlogRecapRevision = {
  tripId: string;
  title: string;
  contentRevision: number;
  engagementRevision: number;
};

export type BlogRecapSnapshot = BlogRecapRevision & {
  audienceClass: BlogRecapAudienceClass;
  state: 'pending' | 'ready' | 'failed';
  payload: BlogRecapPayload | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
};

export type BlogRecapSource = {
  dayCount: number;
  startDate: string | null;
  endDate: string | null;
  placeCount: number;
  distanceKm: number;
  photoCount: number;
  videoCount: number;
  travelerCount: number;
  followerParticipantCount: number;
  media: Array<{ assetId: string; caption: string | null; altText: string | null; reactionTotal: number }>;
  contributors: Array<{ userId: string; displayName: string; contributionCount: number }>;
  topPhotoContributor: { userId: string; displayName: string; photoCount: number } | null;
  mostCommentedDay: { dayDate: string; commentCount: number } | null;
};
