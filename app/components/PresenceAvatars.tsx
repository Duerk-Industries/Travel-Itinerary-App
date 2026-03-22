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
import type { AppTheme } from '../theme/theme';

interface Props {
  /** The current user's own ID — excluded from the list */
  currentUserId: string;
  /** Live presence list from Socket.IO */
  presenceUsers: PresenceUser[];
  /** Max avatars to display before showing "+N" overflow */
  maxVisible?: number;
  theme?: AppTheme;
}

const AVATAR_SIZE = 28;
const OVERLAP = 8;

const PresenceAvatars: React.FC<Props> = ({
  currentUserId,
  presenceUsers,
  maxVisible = 5,
  theme,
}) => {
  const others = presenceUsers.filter((u) => u.userId !== currentUserId);
  if (others.length === 0) return null;

  const visible = others.slice(0, maxVisible);
  const overflow = others.length - maxVisible;

  return (
    <View style={styles.row} testID="presence-avatars">
      {visible.map((user, idx) => (
        <View
          key={user.userId}
          style={[
            styles.avatar,
            { backgroundColor: user.color, marginLeft: idx === 0 ? 0 : -OVERLAP, borderColor: theme?.colors.background ?? '#fff' },
          ]}
          testID={`presence-avatar-${user.userId}`}
        >
          <Text style={styles.initials}>{user.initials}</Text>
        </View>
      ))}
      {overflow > 0 && (
        <View style={[styles.avatar, styles.overflow, { marginLeft: -OVERLAP, borderColor: theme?.colors.background ?? '#fff' }]}>
          <Text style={styles.initials}>+{overflow}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  overflow: {
    backgroundColor: '#9e9e9e',
  },
  initials: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export default PresenceAvatars;
