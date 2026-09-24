import React, { useState } from 'react';
import { ImageBackground, Linking, Platform, Share, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { copyToClipboard } from '../utils/clipboard';
import { formatDateLong } from '../utils/formatDateLong';

type Props = {
  recap: any;
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
  recap, topPhotoUrl, fallbackPhotoUrl = null, shareUrl = null, spendTotal = null, currency = 'USD',
  textColor = '#111827', mutedColor = '#6b7280', borderColor = '#d1d5db', backgroundColor = '#fff',
  showAwards = false, theme, displayFont, displayFontItalic,
}) => {
  const accentColor = theme?.colors?.link ?? '#2563eb';
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
    <View style={{ alignItems: 'flex-end' }}>
      <TouchableOpacity accessibilityRole="button" testID="trip-recap-share" onPress={share} style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
        <Text style={{ color: onDark ? '#fff' : accentColor, fontWeight: '700' }}>Share</Text>
      </TouchableOpacity>
      {shareFeedback ? (
        <Text testID="trip-recap-share-feedback" style={{ color: onDark ? 'rgba(255,255,255,0.85)' : mutedColor, fontSize: 11, paddingRight: 4 }}>{shareFeedback}</Text>
      ) : null}
    </View>
  );

  return (
    <View testID="trip-recap-cards" style={{ borderRadius: 16, overflow: 'hidden', backgroundColor, marginBottom: 16, borderWidth: 1, borderColor }}>
      {heroUrl ? (
        <ImageBackground
          source={{ uri: heroUrl }}
          accessibilityLabel={recap?.topPhoto?.altText || recap?.topPhoto?.caption || 'Trip photo'}
          style={{ minHeight: 240, justifyContent: 'flex-end' }}
        >
          <LinearGradient colors={['rgba(11,23,38,0)', 'rgba(11,23,38,0.1)', 'rgba(11,23,38,0.85)']} style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>Trip recap</Text>
                <Text style={{ color: '#fff', fontSize: 26, fontFamily: displayFont, marginTop: 2 }}>{recap?.title || 'Our trip'}</Text>
                {when ? <Text style={{ color: 'rgba(255,255,255,0.9)', marginTop: 3, fontFamily: displayFontItalic }}>{when}</Text> : null}
                <Text style={{ color: 'rgba(255,255,255,0.9)', marginTop: 6 }}>{statsLine}</Text>
              </View>
              <View style={{ backgroundColor: 'rgba(11,23,38,0.45)', borderRadius: 8 }}>{shareButton(true)}</View>
            </View>
            {heroIsMostLoved ? (
              <Text style={{ color: 'rgba(255,255,255,0.7)', marginTop: 8, fontSize: 12, fontFamily: displayFontItalic }}>♥ Most-loved photo</Text>
            ) : null}
          </LinearGradient>
        </ImageBackground>
      ) : (
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: mutedColor, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>Trip recap</Text>
            <Text style={{ color: textColor, fontSize: 24, fontFamily: displayFont, marginTop: 2 }}>{recap?.title || 'Our trip'}</Text>
            {when ? <Text style={{ color: mutedColor, marginTop: 3, fontFamily: displayFontItalic }}>{when}</Text> : null}
            <Text style={{ color: mutedColor, marginTop: 6 }}>{statsLine}</Text>
          </View>
          {shareButton(false)}
        </View>
      )}
      <View style={{ padding: 16, paddingTop: heroUrl ? 14 : 4 }}>
        {(recap?.topContributors || []).length ? (
          <Text style={{ color: textColor, marginTop: 4 }}>Traveler spotlight: {(recap.topContributors || []).map((c: any) => c.displayName).join(', ')}</Text>
        ) : null}
        {recap?.mostCommentedDay ? <Text style={{ color: textColor, marginTop: 6 }}>Most-commented day: {formatDateLong(recap.mostCommentedDay.dayDate)} · {recap.mostCommentedDay.commentCount} comment{recap.mostCommentedDay.commentCount === 1 ? '' : 's'}</Text> : null}
        {showAwards ? (
          <View testID="trip-awards" style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: borderColor, paddingTop: 10 }}>
            <Text style={{ color: textColor, fontWeight: '800', marginBottom: 5 }}>Trip Awards</Text>
            {recap?.topPhoto ? <Text style={{ color: textColor }}>🏆 Crowd favorite · {recap.topPhoto.reactionTotal} reactions</Text> : null}
            {recap?.topPhotoContributor ? <Text style={{ color: textColor, marginTop: 4 }}>📸 Shutterbug · {recap.topPhotoContributor.displayName} · {recap.topPhotoContributor.photoCount} photos</Text> : null}
            {recap?.mostCommentedDay ? <Text style={{ color: textColor, marginTop: 4 }}>💬 Conversation starter · {formatDateLong(recap.mostCommentedDay.dayDate)}</Text> : null}
          </View>
        ) : null}
        {spendTotal != null ? <Text testID="trip-recap-spend" style={{ color: textColor, marginTop: 10, fontWeight: '700' }}>Trip spend: {new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(spendTotal)}</Text> : null}
        {shareUrl ? (
          <TouchableOpacity accessibilityRole="link" testID="trip-recap-open-public" onPress={() => { void Linking.openURL(shareUrl).catch(() => {}); }} style={{ marginTop: 12 }}>
            <Text style={{ color: accentColor, fontWeight: '700' }}>Read the full story ↗</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={{ color: mutedColor, fontSize: 11, marginTop: 10 }}>Generated {new Date(recap?.generatedAt || Date.now()).toLocaleDateString()}</Text>
      </View>
    </View>
  );
};

export default TripRecapCards;
