import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// Profile setting: whether trip blogs I travel on may be shown to the public web by default.
// On by default. A blog goes public automatically only when every traveler is 16+ with a date of
// birth in their profile and none has this switched off (or made the trip's blog private).
// Travelers and followers can always see the blog regardless of this setting.
import React, { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';


type Props = {
  backendUrl: string;
  headers: Record<string, string> | Headers | any;
  styles: Record<string, any>;
  theme: AppTheme;
};

const BlogPublicDefaultToggle: React.FC<Props> = ({ backendUrl, headers, styles, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [publicByDefault, setPublicByDefault] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${backendUrl}/api/account/blog-defaults`, { headers });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setPublicByDefault(data.publicByDefault !== false);
      } catch {
        // Keep the default (on); the switch stays usable.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl]);

  const change = async (next: boolean) => {
    const previous = publicByDefault;
    setPublicByDefault(next);
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${backendUrl}/api/account/blog-defaults`, {
        method: 'PATCH',
        headers: { ...(headers as any), 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicByDefault: next }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to save');
    } catch (err: any) {
      setPublicByDefault(previous);
      setError(err?.message || 'Unable to save');
    } finally {
      setSaving(false);
    }
  };

  const offTrack = theme.mode === 'dark' ? themeStyle('components_BlogPublicDefaultToggle_5', {  }, (theme ?? _styleTheme)) : themeStyle('components_BlogPublicDefaultToggle_6', {  }, (theme ?? _styleTheme));
  return (
    <View testID="blog-public-default-setting" style={themeStyle('components_BlogPublicDefaultToggle_1', {  }, (theme ?? _styleTheme))}>
      <Text style={styles.modalLabel}>Trip blogs</Text>
      <View style={[styles.row, themeStyle('components_BlogPublicDefaultToggle_2', {  }, (theme ?? _styleTheme))]}>
        <Text style={[styles.cellText, themeStyle('components_BlogPublicDefaultToggle_3', {  }, (theme ?? _styleTheme))]}>Make my trip blogs public by default</Text>
        <Switch
          testID="blog-public-default-switch"
          accessibilityLabel="Make my trip blogs public by default"
          value={publicByDefault}
          disabled={!loaded || saving}
          onValueChange={change}
          trackColor={{ false: offTrack, true: theme.colors.link }}
          thumbColor={theme.mode === 'dark' ? theme.colors.text : themeStyle('components_BlogPublicDefaultToggle_7', {  }, (theme ?? _styleTheme))}
          ios_backgroundColor={offTrack}
        />
      </View>
      <Text style={styles.helperText}>
        A trip blog is shown on the public web only when every traveler is 16+ with a date of birth in their profile and none has chosen private. Travelers and followers can always see the blog.
      </Text>
      {error ? <Text style={[styles.helperText, themeStyle('components_BlogPublicDefaultToggle_4', { theme: theme }, (theme ?? _styleTheme))]}>{error}</Text> : null}
    </View>
  );
};

export default BlogPublicDefaultToggle;
