// @ts-nocheck
import IconText from './IconText';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// @ts-nocheck
// Phase 5 (A1) of docs/trip-blog-social-implementation-plan.md — the Day Starter card.
//
// The server assembles a deterministic draft from that day's itinerary (transfers, activities,
// lodging, car rentals) or, with nothing else, a "N photos from Tuesday" fallback. It is a
// suggestion, never a stored item (FR-A1.2): "Use this draft" accepts it as an editable
// core.text item authored to the tapping user; "Not now" suppresses it for this user and day
// permanently (FR-A1.3).
//
// "Rewrite with AI" (architecture §8) is deliberately not here yet — it belongs behind
// trip_blog_ai_highlights with its own rate-limited endpoint, which does not exist.
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  draft: string;
  onUse: () => void;
  onDismiss: () => void;
  busy?: boolean;
  displayFont?: string;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  accentColor?: string;
  styles: any;
  testID?: string;
};

const BlogDayStarterCard: React.FC<Props> = ({
  draft, onUse, onDismiss, busy = false,
  displayFont, textColor: _textColorOverride, mutedColor: _mutedColorOverride,
  borderColor: _borderColorOverride, backgroundColor: _backgroundColorOverride, accentColor: _accentColorOverride,
  styles, testID,
}) => { const _styleTheme = useStyleTheme();
  const textColor = _textColorOverride ?? themeStyle('components_BlogDayStarterCard_11', {  }, _styleTheme);
  const mutedColor = _mutedColorOverride ?? themeStyle('components_BlogDayStarterCard_12', {  }, _styleTheme);
  const borderColor = _borderColorOverride ?? themeStyle('components_BlogDayStarterCard_13', {  }, _styleTheme);
  const backgroundColor = _backgroundColorOverride ?? themeStyle('components_BlogDayStarterCard_14', {  }, _styleTheme);
  const accentColor = _accentColorOverride ?? themeStyle('components_BlogDayStarterCard_15', {  }, _styleTheme); return ((
  <View
    testID={testID}
    style={themeStyle('components_BlogDayStarterCard_1', { borderColor: borderColor, backgroundColor: backgroundColor }, _styleTheme)}
  >
    <View style={themeStyle('components_BlogDayStarterCard_2', {  }, _styleTheme)}>
      <IconText style={themeStyle('components_BlogDayStarterCard_3', { displayFont: displayFont, accentColor: accentColor }, _styleTheme)}>✨ Day Starter</IconText>
      <TouchableOpacity
        testID={testID ? `${testID}-dismiss` : undefined}
        accessibilityRole="button"
        accessibilityLabel="Dismiss this Day Starter"
        onPress={busy ? undefined : onDismiss}
        disabled={busy}
        style={themeStyle('components_BlogDayStarterCard_4', {  }, _styleTheme)}
      >
        <IconText style={themeStyle('components_BlogDayStarterCard_5', { mutedColor: mutedColor }, _styleTheme)}>✕</IconText>
      </TouchableOpacity>
    </View>

    <Text style={themeStyle('components_BlogDayStarterCard_6', { textColor: textColor }, _styleTheme)}>{draft}</Text>

    <View style={themeStyle('components_BlogDayStarterCard_7', {  }, _styleTheme)}>
      <TouchableOpacity
        testID={testID ? `${testID}-use` : undefined}
        accessibilityRole="button"
        style={[styles.button, busy ? themeStyle('components_BlogDayStarterCard_8', {  }, _styleTheme) : null]}
        disabled={busy}
        onPress={busy ? undefined : onUse}
      >
        {busy ? <ActivityIndicator size="small" color={themeStyle('components_BlogDayStarterCard_16', {  }, _styleTheme)} /> : <Text style={styles.buttonText}>Use this draft</Text>}
      </TouchableOpacity>
      <TouchableOpacity
        testID={testID ? `${testID}-notnow` : undefined}
        accessibilityRole="button"
        style={[styles.button, themeStyle('components_BlogDayStarterCard_9', { borderColor: borderColor }, _styleTheme)]}
        disabled={busy}
        onPress={busy ? undefined : onDismiss}
      >
        <Text style={themeStyle('components_BlogDayStarterCard_10', { textColor: textColor }, _styleTheme)}>Not now</Text>
      </TouchableOpacity>
    </View>
  </View>
)); };

export default BlogDayStarterCard;
