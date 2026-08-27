import React from 'react';
import { ImageBackground, Share, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type Props = {
  recap: any;
  topPhotoUrl?: string | null;
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

// Phase 2 (redesign proposal §5.6 "printable/shareable recap treatment") — restyled to the same
// hero-photo + Fraunces language as the day cards from Phase 1, so the recap and the daily story
// read as one product instead of the recap looking like a settings summary bolted onto the end.
// Every existing string/testID/accessibility label is unchanged — only the container changed.
const TripRecapCards: React.FC<Props> = ({
  recap, topPhotoUrl, spendTotal = null, currency = 'USD', textColor = '#111827', mutedColor = '#6b7280',
  borderColor = '#d1d5db', backgroundColor = '#fff', showAwards = false, theme, displayFont, displayFontItalic,
}) => {
  const accentColor = theme?.colors?.link ?? '#2563eb';
  const stats = [
    `${recap?.dayCount ?? 0} days`, `${recap?.placeCount ?? 0} places`, recap?.distanceKm > 0 ? `${recap.distanceKm.toLocaleString()} km` : null,
    `${recap?.photoCount ?? 0} photos`, `${recap?.videoCount ?? 0} videos`,
  ].filter(Boolean);
  const statsLine = stats.join(' · ');
  const share = () => Share.share({ message: `${recap?.title || 'Our trip'} — ${statsLine}` }).catch(() => {});

  const shareButton = (
    <TouchableOpacity accessibilityRole="button" testID="trip-recap-share" onPress={share} style={{ padding: 8 }}>
      <Text style={{ color: accentColor, fontWeight: '700' }}>Share</Text>
    </TouchableOpacity>
  );

  return (
    <View testID="trip-recap-cards" style={{ borderRadius: 16, overflow: 'hidden', backgroundColor, marginBottom: 16 }}>
      {topPhotoUrl ? (
        <ImageBackground
          source={{ uri: topPhotoUrl }}
          accessibilityLabel={recap?.topPhoto?.altText || recap?.topPhoto?.caption || 'Most-loved trip photo'}
          style={{ minHeight: 220, justifyContent: 'flex-end' }}
        >
          <LinearGradient colors={['rgba(11,23,38,0)', 'rgba(11,23,38,0.05)', 'rgba(11,23,38,0.82)']} style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 24, fontFamily: displayFont }}>{recap?.title || 'Trip recap'}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.88)', marginTop: 3 }}>{statsLine}</Text>
              </View>
              <View style={{ backgroundColor: 'rgba(11,23,38,0.4)', borderRadius: 8 }}>{shareButton}</View>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.7)', marginTop: 6, fontSize: 12, fontFamily: displayFontItalic }}>♥ Most-loved photo</Text>
          </LinearGradient>
        </ImageBackground>
      ) : (
        <View style={{ padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: textColor, fontSize: 22, fontFamily: displayFont }}>{recap?.title || 'Trip recap'}</Text>
            <Text style={{ color: mutedColor, marginTop: 3 }}>{statsLine}</Text>
          </View>
          {shareButton}
        </View>
      )}
      <View style={{ padding: 14, paddingTop: topPhotoUrl ? 12 : 0 }}>
        {(recap?.topContributors || []).length ? (
          <Text style={{ color: textColor, marginTop: 4 }}>Traveler spotlight: {(recap.topContributors || []).map((c: any) => c.displayName).join(', ')}</Text>
        ) : null}
        {recap?.mostCommentedDay ? <Text style={{ color: textColor, marginTop: 6 }}>Most-commented day: {recap.mostCommentedDay.dayDate} · {recap.mostCommentedDay.commentCount} comments</Text> : null}
        {showAwards ? (
          <View testID="trip-awards" style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: borderColor, paddingTop: 10 }}>
            <Text style={{ color: textColor, fontWeight: '800', marginBottom: 5 }}>Trip Awards</Text>
            {recap?.topPhoto ? <Text style={{ color: textColor }}>🏆 Crowd favorite · {recap.topPhoto.reactionTotal} reactions</Text> : null}
            {recap?.topPhotoContributor ? <Text style={{ color: textColor, marginTop: 4 }}>📸 Shutterbug · {recap.topPhotoContributor.displayName} · {recap.topPhotoContributor.photoCount} photos</Text> : null}
            {recap?.mostCommentedDay ? <Text style={{ color: textColor, marginTop: 4 }}>💬 Conversation starter · {recap.mostCommentedDay.dayDate}</Text> : null}
          </View>
        ) : null}
        {spendTotal != null ? <Text testID="trip-recap-spend" style={{ color: textColor, marginTop: 8, fontWeight: '700' }}>Trip spend: {new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(spendTotal)}</Text> : null}
        <Text style={{ color: mutedColor, fontSize: 11, marginTop: 8 }}>Generated {new Date(recap?.generatedAt || Date.now()).toLocaleString()}</Text>
      </View>
    </View>
  );
};

export default TripRecapCards;
