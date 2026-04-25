import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type ReactionValue = 1 | -1;

export type ReactionSummary = {
  score: number;
  upCount: number;
  downCount: number;
  userValue: ReactionValue | null;
};

export type ReactionBarProps = {
  detailId: string;
  summary: ReactionSummary;
  canReact: boolean;
  onCast: (detailId: string, value: ReactionValue) => Promise<ReactionSummary>;
  onClear: (detailId: string) => Promise<ReactionSummary>;
  onError?: (message: string) => void;
};

const computeOptimisticSummary = (
  current: ReactionSummary,
  next: ReactionValue | null
): ReactionSummary => {
  let upCount = current.upCount;
  let downCount = current.downCount;
  if (current.userValue === 1) upCount = Math.max(0, upCount - 1);
  if (current.userValue === -1) downCount = Math.max(0, downCount - 1);
  if (next === 1) upCount += 1;
  if (next === -1) downCount += 1;
  return {
    upCount,
    downCount,
    score: upCount - downCount,
    userValue: next,
  };
};

const ReactionBarBase: React.FC<ReactionBarProps> = ({
  detailId,
  summary,
  canReact,
  onCast,
  onClear,
  onError,
}) => {
  const [localSummary, setLocalSummary] = useState<ReactionSummary>(summary);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  // Re-sync from the parent prop only when it actually changes AND we are not
  // mid-toggle. This prevents the in-flight optimistic value from being
  // clobbered by a stale prop on a parent re-render.
  useEffect(() => {
    if (pendingRef.current) return;
    setLocalSummary(summary);
  }, [summary.score, summary.upCount, summary.downCount, summary.userValue]);

  const handlePress = useCallback(
    async (value: ReactionValue) => {
      if (!canReact || pendingRef.current) return;
      const previous = localSummary;
      const isToggleOff = previous.userValue === value;
      const optimistic = computeOptimisticSummary(previous, isToggleOff ? null : value);
      setLocalSummary(optimistic);
      pendingRef.current = true;
      setPending(true);
      try {
        const next = isToggleOff ? await onClear(detailId) : await onCast(detailId, value);
        setLocalSummary(next);
      } catch (err) {
        setLocalSummary(previous);
        onError?.((err as Error)?.message ?? 'Could not save reaction');
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [canReact, localSummary, onCast, onClear, detailId, onError]
  );

  const upActive = localSummary.userValue === 1;
  const downActive = localSummary.userValue === -1;
  const disabled = !canReact || pending;

  return (
    <View style={styles.row} accessibilityRole="toolbar" testID={`reaction-bar-${detailId}`}>
      <Pressable
        testID={`reaction-up-${detailId}`}
        accessibilityRole="button"
        accessibilityLabel={upActive ? 'Remove your upvote' : 'Upvote this item'}
        accessibilityState={{ disabled, selected: upActive }}
        disabled={disabled}
        onPress={() => handlePress(1)}
        style={[styles.button, upActive && styles.buttonActiveUp, disabled && styles.buttonDisabled]}
      >
        <Text style={[styles.glyph, upActive && styles.glyphActive]}>{'👍'}</Text>
        <Text style={[styles.count, upActive && styles.countActive]}>{localSummary.upCount}</Text>
      </Pressable>
      <Text style={styles.score} testID={`reaction-score-${detailId}`}>
        {localSummary.score > 0 ? `+${localSummary.score}` : `${localSummary.score}`}
      </Text>
      <Pressable
        testID={`reaction-down-${detailId}`}
        accessibilityRole="button"
        accessibilityLabel={downActive ? 'Remove your downvote' : 'Downvote this item'}
        accessibilityState={{ disabled, selected: downActive }}
        disabled={disabled}
        onPress={() => handlePress(-1)}
        style={[styles.button, downActive && styles.buttonActiveDown, disabled && styles.buttonDisabled]}
      >
        <Text style={[styles.glyph, downActive && styles.glyphActive]}>{'👎'}</Text>
        <Text style={[styles.count, downActive && styles.countActive]}>{localSummary.downCount}</Text>
      </Pressable>
    </View>
  );
};

const propsAreEqual = (prev: ReactionBarProps, next: ReactionBarProps): boolean =>
  prev.detailId === next.detailId &&
  prev.canReact === next.canReact &&
  prev.summary.score === next.summary.score &&
  prev.summary.upCount === next.summary.upCount &&
  prev.summary.downCount === next.summary.downCount &&
  prev.summary.userValue === next.summary.userValue &&
  prev.onCast === next.onCast &&
  prev.onClear === next.onClear &&
  prev.onError === next.onError;

const ReactionBar = React.memo(ReactionBarBase, propsAreEqual);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  buttonActiveUp: {
    backgroundColor: 'rgba(46, 125, 50, 0.12)',
    borderColor: 'rgba(46, 125, 50, 0.6)',
  },
  buttonActiveDown: {
    backgroundColor: 'rgba(198, 40, 40, 0.12)',
    borderColor: 'rgba(198, 40, 40, 0.6)',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  glyph: {
    fontSize: 14,
  },
  glyphActive: {
    fontSize: 14,
  },
  count: {
    fontSize: 12,
    fontWeight: '600',
    color: '#444',
  },
  countActive: {
    color: '#111',
  },
  score: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: '#444',
  },
});

export default ReactionBar;
