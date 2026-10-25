import { resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// Phase 3 of docs/trip-blog-social-implementation-plan.md (B1) — the reaction control for a blog
// day, text item, photo or video. Collapsed by default to existing (non-zero) reaction chips plus
// a compact "+" — the PRD's mobile note is specific about this: six full-width emoji buttons don't
// fit a 320px phone, so the full set only appears once the "+" is tapped, not on every render.
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BLOG_REACTION_EMOJIS, type BlogEngagementSummary, type BlogEngagementTargetKind, type BlogReactionEmoji } from '../utils/useBlogEngagement';

const EMOJI_GLYPH: Record<BlogReactionEmoji, string> = {
  heart: '❤️', laugh: '😂', wow: '😮', fire: '🔥', clap: '👏', thanks: '🙏',
};

type Props = {
  targetKind: BlogEngagementTargetKind;
  targetId: string;
  summary: BlogEngagementSummary;
  canEngage: boolean;
  onToggle: (targetKind: BlogEngagementTargetKind, targetId: string, emoji: BlogReactionEmoji) => Promise<void>;
  onError?: (message: string) => void;
  textColor?: string;
  mutedColor?: string;
  theme?: any;
  size?: 'default' | 'compact';
  testID?: string;
};

const BlogReactionBar: React.FC<Props> = ({
  targetKind,
  targetId,
  summary,
  canEngage,
  onToggle,
  onError,
  textColor: _textColorOverride,
  mutedColor: _mutedColorOverride,
  theme: _providedTheme,
  size = 'default',
  testID,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const textColor = _textColorOverride ?? themeStyle('components_BlogReactionBar_9', {  }, (theme ?? _styleTheme));
  const mutedColor = _mutedColorOverride ?? themeStyle('components_BlogReactionBar_10', {  }, (theme ?? _styleTheme));
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const activeChipBg = theme?.colors?.surfaceMuted ?? themeStyle('components_BlogReactionBar_11', {  }, (theme ?? _styleTheme));
  const compact = size === 'compact';

  // The caller's saved choice should remain visible even if an eventually consistent
  // counter is briefly behind the individual reaction record.
  const presentEmojis = BLOG_REACTION_EMOJIS.filter((emoji) => (summary.reactionCounts[emoji] ?? 0) > 0 || summary.userReaction === emoji);
  const visibleCount = (emoji: BlogReactionEmoji) => Math.max(summary.userReaction === emoji ? 1 : 0, summary.reactionCounts[emoji] ?? 0);

  const handlePress = async (emoji: BlogReactionEmoji) => {
    if (!canEngage || pending) return;
    setPending(true);
    try {
      await onToggle(targetKind, targetId, emoji);
      setExpanded(false);
    } catch (error: any) {
      onError?.(error?.message || 'Unable to save your reaction');
    } finally {
      setPending(false);
    }
  };

  const chipStyle = (active: boolean) => (themeStyle('components_BlogReactionBar_1', { compact: compact, active: active, activeChipBg: activeChipBg, theme: theme }, (theme ?? _styleTheme)));

  return (
    <View testID={testID} style={themeStyle('components_BlogReactionBar_2', {  }, (theme ?? _styleTheme))}>
      {presentEmojis.map((emoji) => (
        <Pressable
          key={emoji}
          testID={testID ? `${testID}-chip-${emoji}` : undefined}
          accessibilityRole="button"
          accessibilityLabel={`${summary.userReaction === emoji ? 'Remove' : 'React with'} ${emoji}, ${visibleCount(emoji)} ${visibleCount(emoji) === 1 ? 'reaction' : 'reactions'}`}
          accessibilityState={{ disabled: !canEngage || pending, selected: summary.userReaction === emoji }}
          disabled={!canEngage || pending}
          hitSlop={8}
          onPress={() => handlePress(emoji)}
          style={chipStyle(summary.userReaction === emoji)}
        >
          <Text style={themeStyle('components_BlogReactionBar_3', { compact: compact }, (theme ?? _styleTheme))}>{EMOJI_GLYPH[emoji]}</Text>
          <Text style={themeStyle('components_BlogReactionBar_4', { summary: summary, emoji: emoji, textColor: textColor, mutedColor: mutedColor }, (theme ?? _styleTheme))}>
            {visibleCount(emoji)}
          </Text>
        </Pressable>
      ))}
      {canEngage ? (
        <Pressable
          testID={testID ? `${testID}-add` : undefined}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Hide reaction picker' : 'Add a reaction'}
          hitSlop={8}
          disabled={pending}
          onPress={() => setExpanded((current) => !current)}
          style={[chipStyle(false), themeStyle('components_BlogReactionBar_5', { compact: compact }, (theme ?? _styleTheme))]}
        >
          <Text style={themeStyle('components_BlogReactionBar_6', { compact: compact, mutedColor: mutedColor }, (theme ?? _styleTheme))}>{expanded ? '×' : '＋'}</Text>
        </Pressable>
      ) : null}
      {expanded ? (
        <View
          testID={testID ? `${testID}-picker` : undefined}
          style={themeStyle('components_BlogReactionBar_7', {  }, (theme ?? _styleTheme))}
        >
          {BLOG_REACTION_EMOJIS.map((emoji) => (
            <Pressable
              key={emoji}
              testID={testID ? `${testID}-pick-${emoji}` : undefined}
              accessibilityRole="button"
              accessibilityLabel={`React with ${emoji}`}
              accessibilityState={{ disabled: pending, selected: summary.userReaction === emoji }}
              disabled={pending}
              hitSlop={8}
              onPress={() => handlePress(emoji)}
              style={chipStyle(summary.userReaction === emoji)}
            >
              <Text style={themeStyle('components_BlogReactionBar_8', {  }, (theme ?? _styleTheme))}>{EMOJI_GLYPH[emoji]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
};

export default BlogReactionBar;
