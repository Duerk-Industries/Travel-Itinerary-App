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
  textColor = '#111827',
  mutedColor = '#6b7280',
  theme,
  size = 'default',
  testID,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const activeChipBg = theme?.colors?.surfaceMuted ?? '#e5e7eb';
  const compact = size === 'compact';

  const presentEmojis = BLOG_REACTION_EMOJIS.filter((emoji) => (summary.reactionCounts[emoji] ?? 0) > 0);

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

  const chipStyle = (active: boolean) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    paddingHorizontal: compact ? 5 : 7,
    paddingVertical: compact ? 3 : 4,
    borderRadius: 999,
    minHeight: compact ? 28 : 32,
    backgroundColor: active ? activeChipBg : 'transparent',
    borderWidth: 1,
    borderColor: active ? (theme?.colors?.border ?? '#ccd4df') : 'transparent',
  });

  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
      {presentEmojis.map((emoji) => (
        <Pressable
          key={emoji}
          testID={testID ? `${testID}-chip-${emoji}` : undefined}
          accessibilityRole="button"
          accessibilityLabel={`${summary.userReaction === emoji ? 'Remove' : 'React with'} ${emoji}, ${summary.reactionCounts[emoji]} ${summary.reactionCounts[emoji] === 1 ? 'reaction' : 'reactions'}`}
          accessibilityState={{ disabled: !canEngage || pending, selected: summary.userReaction === emoji }}
          disabled={!canEngage || pending}
          hitSlop={8}
          onPress={() => handlePress(emoji)}
          style={chipStyle(summary.userReaction === emoji)}
        >
          <Text style={{ fontSize: compact ? 13 : 15 }}>{EMOJI_GLYPH[emoji]}</Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: summary.userReaction === emoji ? textColor : mutedColor }}>
            {summary.reactionCounts[emoji]}
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
          style={[chipStyle(false), { minWidth: compact ? 28 : 32, justifyContent: 'center' }]}
        >
          <Text style={{ fontSize: compact ? 13 : 15, color: mutedColor }}>{expanded ? '×' : '＋'}</Text>
        </Pressable>
      ) : null}
      {expanded ? (
        <View
          testID={testID ? `${testID}-picker` : undefined}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, width: '100%', marginTop: 2 }}
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
              <Text style={{ fontSize: 16 }}>{EMOJI_GLYPH[emoji]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
};

export default BlogReactionBar;
