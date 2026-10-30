import IconText from './IconText';
import { layoutMetrics, themeStyle, avatarColor as colorForUser } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// Phase 3 of docs/trip-blog-social-implementation-plan.md (B5) — "3 travelers · 47 photos · 12
// reactions" plus small avatars, crediting everyone who wrote or uploaded on a given day. Reuses
// colorForUser/initialsForName from packages/messaging (the same deterministic avatar palette
// PresenceAvatars.tsx already uses) rather than inventing a second one.
import React from 'react';
import { Text, View } from 'react-native';
import { initialsForName } from '../../packages/messaging/src/colors';


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

const AVATAR_SIZE = layoutMetrics.BlogContributorStrip_AVATAR_SIZE;
const OVERLAP = layoutMetrics.BlogContributorStrip_OVERLAP;
const MAX_VISIBLE = 4;

const BlogContributorStrip: React.FC<Props> = ({ contributors, reactionTotal = 0, spotlightUserId = null, mutedColor: _mutedColorOverride, testID }) => {
  const _styleTheme = useStyleTheme();
  const mutedColor = _mutedColorOverride ?? themeStyle('components_BlogContributorStrip_10', {  }, _styleTheme);
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
    <View testID={testID} style={themeStyle('components_BlogContributorStrip_1', {  }, _styleTheme)}>
      <View style={themeStyle('components_BlogContributorStrip_2', {  }, _styleTheme)}>
        {visible.map((contributor, index) => (
          <View
            key={contributor.userId}
            testID={testID ? `${testID}-avatar-${contributor.userId}` : undefined}
            style={themeStyle('components_BlogContributorStrip_3', { AVATAR_SIZE: AVATAR_SIZE, colorForUser: colorForUser, contributor: contributor, index: index, OVERLAP: OVERLAP }, _styleTheme)}
          >
            <Text style={themeStyle('components_BlogContributorStrip_4', {  }, _styleTheme)}>{initialsForName(contributor.displayName)}</Text>
          </View>
        ))}
        {overflow > 0 ? (
          <View style={themeStyle('components_BlogContributorStrip_5', { AVATAR_SIZE: AVATAR_SIZE, OVERLAP: OVERLAP }, _styleTheme)}>
            <Text style={themeStyle('components_BlogContributorStrip_6', {  }, _styleTheme)}>+{overflow}</Text>
          </View>
        ) : null}
      </View>
      <View style={themeStyle('components_BlogContributorStrip_7', {  }, _styleTheme)}>
        <Text style={themeStyle('components_BlogContributorStrip_8', { mutedColor: mutedColor }, _styleTheme)}>{summaryParts.join(' · ')}</Text>
        {spotlightUserId ? (
          <IconText testID={testID ? `${testID}-spotlight` : undefined} style={themeStyle('components_BlogContributorStrip_9', {  }, _styleTheme)}>
            ✨ Traveler spotlight: {contributors.find((c) => c.userId === spotlightUserId)?.displayName || 'top contributor'}
          </IconText>
        ) : null}
      </View>
    </View>
  );
};

export default BlogContributorStrip;
