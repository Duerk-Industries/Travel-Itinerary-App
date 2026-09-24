// Phase 3 of docs/trip-blog-social-implementation-plan.md (B5) — "3 travelers · 47 photos · 12
// reactions" plus small avatars, crediting everyone who wrote or uploaded on a given day. Reuses
// colorForUser/initialsForName from packages/messaging (the same deterministic avatar palette
// PresenceAvatars.tsx already uses) rather than inventing a second one.
import React from 'react';
import { Text, View } from 'react-native';
import { colorForUser, initialsForName } from '../../packages/messaging/src/colors';

export type BlogContributor = {
  userId: string;
  displayName: string;
  itemCount: number;
  assetCount: number;
};

type Props = {
  contributors: BlogContributor[];
  reactionTotal?: number;
  spotlightUserId?: string | null;
  mutedColor?: string;
  testID?: string;
};

const AVATAR_SIZE = 22;
const OVERLAP = 6;
const MAX_VISIBLE = 4;

const BlogContributorStrip: React.FC<Props> = ({ contributors, reactionTotal = 0, spotlightUserId = null, mutedColor = '#6b7280', testID }) => {
  if (!contributors.length) return null;

  const visible = contributors.slice(0, MAX_VISIBLE);
  const overflow = contributors.length - MAX_VISIBLE;
  const totalAssets = contributors.reduce((sum, c) => sum + c.assetCount, 0);

  const summaryParts = [
    `${contributors.length} ${contributors.length === 1 ? 'traveler' : 'travelers'}`,
    totalAssets > 0 ? `${totalAssets} ${totalAssets === 1 ? 'photo' : 'photos'}` : null,
    reactionTotal > 0 ? `${reactionTotal} ${reactionTotal === 1 ? 'reaction' : 'reactions'}` : null,
  ].filter(Boolean);

  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
        {visible.map((contributor, index) => (
          <View
            key={contributor.userId}
            testID={testID ? `${testID}-avatar-${contributor.userId}` : undefined}
            style={{
              width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
              justifyContent: 'center', alignItems: 'center',
              backgroundColor: colorForUser(contributor.userId),
              marginLeft: index === 0 ? 0 : -OVERLAP,
              borderWidth: 1.5, borderColor: '#fff',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{initialsForName(contributor.displayName)}</Text>
          </View>
        ))}
        {overflow > 0 ? (
          <View style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, justifyContent: 'center', alignItems: 'center', backgroundColor: '#9e9e9e', marginLeft: -OVERLAP, borderWidth: 1.5, borderColor: '#fff' }}>
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>+{overflow}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ color: mutedColor, fontSize: 12 }}>{summaryParts.join(' · ')}</Text>
        {spotlightUserId ? (
          <Text testID={testID ? `${testID}-spotlight` : undefined} style={{ color: '#7c3aed', fontSize: 11, fontWeight: '700' }}>
            ✨ Traveler spotlight: {contributors.find((c) => c.userId === spotlightUserId)?.displayName || 'top contributor'}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

export default BlogContributorStrip;
