import { layoutMetrics, resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';


import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
/**
 * PresenceAvatars
 *
 * Renders small colored circles with user initials for every other user
 * currently viewing the same trip. Positioned to the immediate left of the
 * user's own name in the top bar.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { PresenceUser } from '../../packages/messaging/src/types';


interface Props {
  /** The current user's own ID — excluded from the list */
  currentUserId: string;
  /** Live presence list from Socket.IO */
  presenceUsers: PresenceUser[];
  /** Max avatars to display before showing "+N" overflow */
  maxVisible?: number;
  theme?: AppTheme;
}

const AVATAR_SIZE = layoutMetrics.PresenceAvatars_AVATAR_SIZE;
const OVERLAP = layoutMetrics.PresenceAvatars_OVERLAP;

const PresenceAvatars: React.FC<Props> = ({
  currentUserId,
  presenceUsers,
  maxVisible = 5,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const others = presenceUsers.filter((u) => u.userId !== currentUserId);
  if (others.length === 0) return null;

  const visible = others.slice(0, maxVisible);
  const overflow = others.length - maxVisible;

  return (
    <View style={styles((theme ?? _styleTheme)).row} testID="presence-avatars">
      {visible.map((user, idx) => (
        <View
          key={user.userId}
          style={[
            styles((theme ?? _styleTheme)).avatar,
            themeStyle('components_PresenceAvatars_1', { user: user, idx: idx, OVERLAP: OVERLAP, theme: theme }, (theme ?? _styleTheme)),
          ]}
          testID={`presence-avatar-${user.userId}`}
        >
          <Text style={styles((theme ?? _styleTheme)).initials}>{user.initials}</Text>
        </View>
      ))}
      {overflow > 0 && (
        <View style={[styles((theme ?? _styleTheme)).avatar, styles((theme ?? _styleTheme)).overflow, themeStyle('components_PresenceAvatars_2', { OVERLAP: OVERLAP, theme: theme }, (theme ?? _styleTheme))]}>
          <Text style={styles((theme ?? _styleTheme)).initials}>+{overflow}</Text>
        </View>
      )}
    </View>
  );
};

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_PresenceAvatars_3', { StyleSheet: StyleSheet, AVATAR_SIZE: AVATAR_SIZE }, _theme);

export default PresenceAvatars;
