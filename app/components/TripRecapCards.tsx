import IconText from './IconText';
import { resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import BlogMap from './BlogMap';
import type { BlogMapDay } from '../../server/src/services/blogMapService';
import React, { useState } from 'react';
import { ImageBackground, Linking, Platform, Share, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { copyToClipboard } from '../utils/clipboard';
import { formatDateLong } from '../utils/formatDateLong';

type Props = {
  recap: any;
  mapDays?: BlogMapDay[];
  nativeEnabled?: boolean;
  topPhotoUrl?: string | null;
  // Used for the hero image when no photo has reactions yet — the recap should still show a photo.
  fallbackPhotoUrl?: string | null;
  // The public blog URL, when the blog is published — makes the recap link somewhere and gives
  // Share something worth sharing.
  shareUrl?: string | null;
  spendTotal?: number | null;
  currency?: string;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  showAwards?: boolean;
  theme?: any;
  displayFont?: string;
  displayFontItalic?: string;
};

const dateRange = (start?: string | null, end?: string | null): string | null => {
  if (!start && !end) return null;
  if (start && end && start !== end) return `${formatDateLong(start)} – ${formatDateLong(end)}`;
  return formatDateLong(start || end || '');
};

// Phase 2 (redesign proposal §5.6 "printable/shareable recap treatment") — restyled to the same
// hero-photo + Fraunces language as the day cards from Phase 1, so the recap and the daily story
// read as one product instead of the recap looking like a settings summary bolted onto the end.
const TripRecapCards: React.FC<Props> = ({
  recap, mapDays = [], nativeEnabled, topPhotoUrl, fallbackPhotoUrl = null, shareUrl = null, spendTotal = null, currency = 'USD',
  textColor: _textColorOverride, mutedColor: _mutedColorOverride, borderColor: _borderColorOverride, backgroundColor: _backgroundColorOverride,
  showAwards = false, theme: _providedTheme, displayFont, displayFontItalic,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const textColor = _textColorOverride ?? themeStyle('components_TripRecapCards_34', {  }, (theme ?? _styleTheme));
  const mutedColor = _mutedColorOverride ?? themeStyle('components_TripRecapCards_35', {  }, (theme ?? _styleTheme));
  const borderColor = _borderColorOverride ?? themeStyle('components_TripRecapCards_36', {  }, (theme ?? _styleTheme));
  const backgroundColor = _backgroundColorOverride ?? themeStyle('components_TripRecapCards_37', {  }, (theme ?? _styleTheme));
  const accentColor = theme?.colors?.link ?? themeStyle('components_TripRecapCards_38', {  }, (theme ?? _styleTheme));
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const heroUrl = topPhotoUrl || fallbackPhotoUrl || null;
  const heroIsMostLoved = Boolean(topPhotoUrl);
  const when = dateRange(recap?.startDate, recap?.endDate);

  const stats = [
    `${recap?.dayCount ?? 0} days`, `${recap?.placeCount ?? 0} places`, recap?.distanceKm > 0 ? `${recap.distanceKm.toLocaleString()} km` : null,
    `${recap?.photoCount ?? 0} photos`, recap?.videoCount ? `${recap.videoCount} videos` : null,
  ].filter(Boolean);
  const statsLine = stats.join(' · ');

  const shareText = [
    recap?.title || 'Our trip',
    when ? when : null,
    statsLine,
    shareUrl || null,
  ].filter(Boolean).join('\n');

  const share = async () => {
    // Native, and web browsers that support the Web Share API, get the real share sheet.
    if (Platform.OS !== 'web' || (typeof navigator !== 'undefined' && (navigator as any).share)) {
      try {
        await Share.share(shareUrl ? { message: shareText, url: shareUrl } : { message: shareText });
        return;
      } catch {
        // fall through to clipboard
      }
    }
    const result = await copyToClipboard(shareText);
    setShareFeedback(result === 'copied' ? 'Copied to clipboard' : 'Couldn’t copy — select the text manually');
    setTimeout(() => setShareFeedback(null), 2500);
  };

  const shareButton = (onDark: boolean) => (
    <View style={themeStyle('components_TripRecapCards_1', {  }, (theme ?? _styleTheme))}>
      <TouchableOpacity accessibilityRole="button" testID="trip-recap-share" onPress={share} style={themeStyle('components_TripRecapCards_2', {  }, (theme ?? _styleTheme))}>
        <Text style={themeStyle('components_TripRecapCards_3', { onDark: onDark, accentColor: accentColor }, (theme ?? _styleTheme))}>Share</Text>
      </TouchableOpacity>
      {shareFeedback ? (
        <Text testID="trip-recap-share-feedback" style={themeStyle('components_TripRecapCards_4', { onDark: onDark, mutedColor: mutedColor }, (theme ?? _styleTheme))}>{shareFeedback}</Text>
      ) : null}
    </View>
  );

  return (
    <View testID="trip-recap-cards" style={themeStyle('components_TripRecapCards_5', { backgroundColor: backgroundColor, borderColor: borderColor }, (theme ?? _styleTheme))}>
      {heroUrl ? (
        <ImageBackground
          source={{ uri: heroUrl }}
          accessibilityLabel={recap?.topPhoto?.altText || recap?.topPhoto?.caption || 'Trip photo'}
          style={themeStyle('components_TripRecapCards_6', {  }, (theme ?? _styleTheme))}
        >
          <LinearGradient colors={[themeStyle('components_TripRecapCards_39', {  }, (theme ?? _styleTheme)), themeStyle('components_TripRecapCards_40', {  }, (theme ?? _styleTheme)), themeStyle('components_TripRecapCards_41', {  }, (theme ?? _styleTheme))]} style={themeStyle('components_TripRecapCards_7', {  }, (theme ?? _styleTheme))}>
            <View style={themeStyle('components_TripRecapCards_8', {  }, (theme ?? _styleTheme))}>
              <View style={themeStyle('components_TripRecapCards_9', {  }, (theme ?? _styleTheme))}>
                <Text style={themeStyle('components_TripRecapCards_10', {  }, (theme ?? _styleTheme))}>Trip recap</Text>
                <Text style={themeStyle('components_TripRecapCards_11', { displayFont: displayFont }, (theme ?? _styleTheme))}>{recap?.title || 'Our trip'}</Text>
                {when ? <Text style={themeStyle('components_TripRecapCards_12', { displayFontItalic: displayFontItalic }, (theme ?? _styleTheme))}>{when}</Text> : null}
                <Text style={themeStyle('components_TripRecapCards_13', {  }, (theme ?? _styleTheme))}>{statsLine}</Text>
              </View>
              <View style={themeStyle('components_TripRecapCards_14', {  }, (theme ?? _styleTheme))}>{shareButton(true)}</View>
            </View>
            {heroIsMostLoved ? (
              <IconText style={themeStyle('components_TripRecapCards_15', { displayFontItalic: displayFontItalic }, (theme ?? _styleTheme))}>♥ Most-loved photo</IconText>
            ) : null}
          </LinearGradient>
        </ImageBackground>
      ) : (
        <View style={themeStyle('components_TripRecapCards_16', {  }, (theme ?? _styleTheme))}>
          <View style={themeStyle('components_TripRecapCards_17', {  }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('components_TripRecapCards_18', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Trip recap</Text>
            <Text style={themeStyle('components_TripRecapCards_19', { textColor: textColor, displayFont: displayFont }, (theme ?? _styleTheme))}>{recap?.title || 'Our trip'}</Text>
            {when ? <Text style={themeStyle('components_TripRecapCards_20', { mutedColor: mutedColor, displayFontItalic: displayFontItalic }, (theme ?? _styleTheme))}>{when}</Text> : null}
            <Text style={themeStyle('components_TripRecapCards_21', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{statsLine}</Text>
          </View>
          {shareButton(false)}
        </View>
      )}
      <View style={themeStyle('components_TripRecapCards_22', { heroUrl: heroUrl }, (theme ?? _styleTheme))}>
        {mapDays.length > 0 && <BlogMap nativeEnabled={nativeEnabled} testID="trip-recap-map" map={{ precision: mapDays.some(d => d.mapPoints.precision === 'approximate') ? 'approximate' : 'exact', points: mapDays.flatMap(d => d.mapPoints.points).slice(0, 100) }} />}
        {(recap?.topContributors || []).length ? (
          <Text style={themeStyle('components_TripRecapCards_23', { textColor: textColor }, (theme ?? _styleTheme))}>Traveler spotlight: {(recap.topContributors || []).map((c: any) => c.displayName).join(', ')}</Text>
        ) : null}
        {recap?.mostCommentedDay ? <Text style={themeStyle('components_TripRecapCards_24', { textColor: textColor }, (theme ?? _styleTheme))}>Most-commented day: {formatDateLong(recap.mostCommentedDay.dayDate)} · {recap.mostCommentedDay.commentCount} comment{recap.mostCommentedDay.commentCount === 1 ? '' : 's'}</Text> : null}
        {showAwards ? (
          <View testID="trip-awards" style={themeStyle('components_TripRecapCards_25', { borderColor: borderColor }, (theme ?? _styleTheme))}>
            <Text style={themeStyle('components_TripRecapCards_26', { textColor: textColor }, (theme ?? _styleTheme))}>Trip Awards</Text>
            {recap?.topPhoto ? <IconText style={themeStyle('components_TripRecapCards_27', { textColor: textColor }, (theme ?? _styleTheme))}>🏆 Crowd favorite · {recap.topPhoto.reactionTotal} reactions</IconText> : null}
            {recap?.topPhotoContributor ? <IconText style={themeStyle('components_TripRecapCards_28', { textColor: textColor }, (theme ?? _styleTheme))}>📸 Shutterbug · {recap.topPhotoContributor.displayName} · {recap.topPhotoContributor.photoCount} photos</IconText> : null}
            {recap?.mostCommentedDay ? <IconText style={themeStyle('components_TripRecapCards_29', { textColor: textColor }, (theme ?? _styleTheme))}>💬 Conversation starter · {formatDateLong(recap.mostCommentedDay.dayDate)}</IconText> : null}
          </View>
        ) : null}
        {spendTotal != null ? <Text testID="trip-recap-spend" style={themeStyle('components_TripRecapCards_30', { textColor: textColor }, (theme ?? _styleTheme))}>Trip spend: {new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(spendTotal)}</Text> : null}
        {shareUrl ? (
          <TouchableOpacity accessibilityRole="link" testID="trip-recap-open-public" onPress={() => { void Linking.openURL(shareUrl).catch(() => {}); }} style={themeStyle('components_TripRecapCards_31', {  }, (theme ?? _styleTheme))}>
            <IconText style={themeStyle('components_TripRecapCards_32', { accentColor: accentColor }, (theme ?? _styleTheme))}>Read the full story ↗</IconText>
          </TouchableOpacity>
        ) : null}
        <Text style={themeStyle('components_TripRecapCards_33', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>Generated {new Date(recap?.generatedAt || Date.now()).toLocaleDateString()}</Text>
      </View>
    </View>
  );
};

export default TripRecapCards;
