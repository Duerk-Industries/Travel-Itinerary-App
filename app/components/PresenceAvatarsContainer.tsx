import { resolveComponentTheme as resolveStyleTheme, type AppTheme } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import PresenceAvatars from './PresenceAvatars';
import { usePresenceUsers } from '../contexts/PresenceContext';


type Props = {
  currentUserId: string;
  maxVisible?: number;
  theme?: AppTheme;
};

/**
 * Subscribes to the presence context and forwards the list to the pure
 * <PresenceAvatars/> view. Only this leaf re-renders on presence updates,
 * so the rest of the AppShell tree is unaffected by heartbeats.
 */
const PresenceAvatarsContainer: React.FC<Props> = ({ currentUserId, maxVisible, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const presenceUsers = usePresenceUsers();
  return (
    <PresenceAvatars
      currentUserId={currentUserId}
      presenceUsers={presenceUsers}
      maxVisible={maxVisible}
      theme={theme}
    />
  );
};

export default PresenceAvatarsContainer;
