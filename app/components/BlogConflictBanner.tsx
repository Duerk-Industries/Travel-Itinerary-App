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
  textColor = '#111827',
  mutedColor = '#6b7280',
  borderColor = '#f59e0b',
  backgroundColor = '#fffbeb',
  styles,
  theme,
  testID,
}) => {
  const editorLabel = latest?.lastEditorUserId ? 'Someone else' : 'Another editor';
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={{ borderWidth: 1, borderColor, backgroundColor, borderRadius: 8, padding: 10, marginTop: 6, marginBottom: 6 }}
    >
      <Text style={{ color: textColor, fontWeight: '700', marginBottom: 4 }}>
        ⚠ {editorLabel} edited this while you were writing.
      </Text>
      <Text style={{ color: mutedColor, marginBottom: 8, fontSize: 12 }}>
        Your draft is saved locally and won't be lost — choose how to resolve it.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <TouchableOpacity
          testID={testID ? `${testID}-keep-mine` : undefined}
          accessibilityRole="button"
          style={[styles?.button, { paddingVertical: 6, paddingHorizontal: 10 }]}
          disabled={busy}
          onPress={onKeepMine}
        >
          <Text style={styles?.buttonText}>{busy ? 'Working…' : 'Keep mine'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID={testID ? `${testID}-use-theirs` : undefined}
          accessibilityRole="button"
          style={[styles?.button, { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? '#e5e7eb' }]}
          disabled={busy}
          onPress={onUseTheirs}
        >
          <Text style={{ color: textColor }}>Use theirs</Text>
        </TouchableOpacity>
        {onShowBoth ? (
          <TouchableOpacity
            testID={testID ? `${testID}-show-both` : undefined}
            accessibilityRole="button"
            style={[styles?.button, { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? '#e5e7eb' }]}
            disabled={busy}
            onPress={onShowBoth}
          >
            <Text style={{ color: textColor }}>Show both</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

export default BlogConflictBanner;
