import IconText from './IconText';
import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
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
  theme?: AppTheme;
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
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
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

  const themedStyles = theme ? {
    count: themeStyle('components_ReactionBar_1', { theme: theme }, (theme ?? _styleTheme)),
    countActive: themeStyle('components_ReactionBar_2', { theme: theme }, (theme ?? _styleTheme)),
    score: themeStyle('components_ReactionBar_3', { theme: theme }, (theme ?? _styleTheme)),
  } : null;

  return (
    <View style={styles((theme ?? _styleTheme)).row} accessibilityRole="toolbar" testID={`reaction-bar-${detailId}`}>
      <Pressable
        testID={`reaction-up-${detailId}`}
        accessibilityRole="button"
        accessibilityLabel={upActive ? 'Remove your upvote' : 'Upvote this item'}
        accessibilityState={{ disabled, selected: upActive }}
        disabled={disabled}
        onPress={() => handlePress(1)}
        style={[styles((theme ?? _styleTheme)).button, upActive && styles((theme ?? _styleTheme)).buttonActiveUp, disabled && styles((theme ?? _styleTheme)).buttonDisabled]}
      >
        <IconText style={[styles((theme ?? _styleTheme)).glyph, upActive && styles((theme ?? _styleTheme)).glyphActive]}>{'👍'}</IconText>
        <Text style={[styles((theme ?? _styleTheme)).count, themedStyles?.count, upActive && (themedStyles?.countActive ?? styles((theme ?? _styleTheme)).countActive)]}>{localSummary.upCount}</Text>
      </Pressable>
      <Text style={[styles((theme ?? _styleTheme)).score, themedStyles?.score]} testID={`reaction-score-${detailId}`}>
        {localSummary.score > 0 ? `+${localSummary.score}` : `${localSummary.score}`}
      </Text>
      <Pressable
        testID={`reaction-down-${detailId}`}
        accessibilityRole="button"
        accessibilityLabel={downActive ? 'Remove your downvote' : 'Downvote this item'}
        accessibilityState={{ disabled, selected: downActive }}
        disabled={disabled}
        onPress={() => handlePress(-1)}
        style={[styles((theme ?? _styleTheme)).button, downActive && styles((theme ?? _styleTheme)).buttonActiveDown, disabled && styles((theme ?? _styleTheme)).buttonDisabled]}
      >
        <IconText style={[styles((theme ?? _styleTheme)).glyph, downActive && styles((theme ?? _styleTheme)).glyphActive]}>{'👎'}</IconText>
        <Text style={[styles((theme ?? _styleTheme)).count, themedStyles?.count, downActive && (themedStyles?.countActive ?? styles((theme ?? _styleTheme)).countActive)]}>{localSummary.downCount}</Text>
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
  prev.onError === next.onError &&
  prev.theme === next.theme;

const ReactionBar = React.memo(ReactionBarBase, propsAreEqual);

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_ReactionBar_4', { StyleSheet: StyleSheet }, _theme);

export default ReactionBar;
