import React from 'react';
import { Image, Share, Text, TouchableOpacity, View } from 'react-native';

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
};

const TripRecapCards: React.FC<Props> = ({ recap, topPhotoUrl, spendTotal = null, currency = 'USD', textColor = '#111827', mutedColor = '#6b7280', borderColor = '#d1d5db', backgroundColor = '#fff', showAwards = false, theme }) => {
  const accentColor = theme?.colors?.link ?? '#2563eb';
  const stats = [
    `${recap?.dayCount ?? 0} days`, `${recap?.placeCount ?? 0} places`, recap?.distanceKm > 0 ? `${recap.distanceKm.toLocaleString()} km` : null,
    `${recap?.photoCount ?? 0} photos`, `${recap?.videoCount ?? 0} videos`,
  ].filter(Boolean);
  const share = () => Share.share({ message: `${recap?.title || 'Our trip'} — ${stats.join(' · ')}` }).catch(() => {});
  return (
    <View testID="trip-recap-cards" style={{ borderWidth: 1, borderColor, borderRadius: 12, padding: 14, backgroundColor, marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: textColor, fontSize: 20, fontWeight: '800' }}>{recap?.title || 'Trip recap'}</Text>
          <Text style={{ color: mutedColor, marginTop: 3 }}>{stats.join(' · ')}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" testID="trip-recap-share" onPress={share} style={{ padding: 8 }}>
          <Text style={{ color: accentColor, fontWeight: '700' }}>Share</Text>
        </TouchableOpacity>
      </View>
      {topPhotoUrl ? (
        <View style={{ marginTop: 10 }}>
          <Image source={{ uri: topPhotoUrl }} accessibilityLabel={recap?.topPhoto?.altText || recap?.topPhoto?.caption || 'Most-loved trip photo'} style={{ width: '100%', height: 220, borderRadius: 10, backgroundColor: borderColor }} resizeMode="cover" />
          <Text style={{ color: mutedColor, marginTop: 4 }}>♥ Most-loved photo</Text>
        </View>
      ) : null}
      {(recap?.topContributors || []).length ? (
        <Text style={{ color: textColor, marginTop: 8 }}>Traveler spotlight: {(recap.topContributors || []).map((c: any) => c.displayName).join(', ')}</Text>
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
  );
};

export default TripRecapCards;
