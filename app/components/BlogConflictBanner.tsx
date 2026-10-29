import { resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// Conflict banner for the trip blog's autosave contract — architecture §5.5, FR-A5.3. Replaces
// the old `Alert.alert('Someone else edited this block. Reload to resolve the conflict.')` flow
// in app/tabs/tripBlog.tsx, which discarded whatever the user was typing. This banner never does:
// the caller keeps the local draft alive through all three resolutions until each one's terminal
// operation actually succeeds.
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

export type BlogConflictLatest = {
  body?: string;
  version?: number;
  headline?: string | null;
  summary?: string | null;
  updateVersion?: number;
  updatedAt?: string;
  lastEditorUserId?: string;
};

type Props = {
  latest: BlogConflictLatest | null;
  onKeepMine: () => void;
  onUseTheirs: () => void;
  // "Show both" only makes sense for an item body — a day has exactly one headline, not two — so
  // this is optional and the button is omitted entirely when the caller doesn't provide it,
  // rather than shown-and-disabled.
  onShowBoth?: () => void;
  busy?: boolean;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  styles: any;
  theme?: any;
  testID?: string;
};

const BlogConflictBanner: React.FC<Props> = ({
  latest,
  onKeepMine,
  onUseTheirs,
  onShowBoth,
  busy = false,
  textColor: _textColorOverride,
  mutedColor: _mutedColorOverride,
  borderColor: _borderColorOverride,
  backgroundColor: _backgroundColorOverride,
  styles,
  theme: _providedTheme,
  testID,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const textColor = _textColorOverride ?? themeStyle('components_BlogConflictBanner_10', {  }, (theme ?? _styleTheme));
  const mutedColor = _mutedColorOverride ?? themeStyle('components_BlogConflictBanner_11', {  }, (theme ?? _styleTheme));
  const borderColor = _borderColorOverride ?? themeStyle('components_BlogConflictBanner_12', {  }, (theme ?? _styleTheme));
  const backgroundColor = _backgroundColorOverride ?? themeStyle('components_BlogConflictBanner_13', {  }, (theme ?? _styleTheme));
  const editorLabel = latest?.lastEditorUserId ? 'Someone else' : 'Another editor';
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={themeStyle('components_BlogConflictBanner_1', { borderColor: borderColor, backgroundColor: backgroundColor }, (theme ?? _styleTheme))}
    >
      <Text style={themeStyle('components_BlogConflictBanner_2', { textColor: textColor }, (theme ?? _styleTheme))}>
        ⚠ {editorLabel} edited this while you were writing.
      </Text>
      <Text style={themeStyle('components_BlogConflictBanner_3', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>
        Your draft is saved locally and won't be lost — choose how to resolve it.
      </Text>
      <View style={themeStyle('components_BlogConflictBanner_4', {  }, (theme ?? _styleTheme))}>
        <TouchableOpacity
          testID={testID ? `${testID}-keep-mine` : undefined}
          accessibilityRole="button"
          style={[styles?.button, themeStyle('components_BlogConflictBanner_5', {  }, (theme ?? _styleTheme))]}
          disabled={busy}
          onPress={onKeepMine}
        >
          <Text style={styles?.buttonText}>{busy ? 'Working…' : 'Keep mine'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID={testID ? `${testID}-use-theirs` : undefined}
          accessibilityRole="button"
          style={[styles?.button, themeStyle('components_BlogConflictBanner_6', { theme: theme }, (theme ?? _styleTheme))]}
          disabled={busy}
          onPress={onUseTheirs}
        >
          <Text style={themeStyle('components_BlogConflictBanner_7', { textColor: textColor }, (theme ?? _styleTheme))}>Use theirs</Text>
        </TouchableOpacity>
        {onShowBoth ? (
          <TouchableOpacity
            testID={testID ? `${testID}-show-both` : undefined}
            accessibilityRole="button"
            style={[styles?.button, themeStyle('components_BlogConflictBanner_8', { theme: theme }, (theme ?? _styleTheme))]}
            disabled={busy}
            onPress={onShowBoth}
          >
            <Text style={themeStyle('components_BlogConflictBanner_9', { textColor: textColor }, (theme ?? _styleTheme))}>Show both</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

export default BlogConflictBanner;
