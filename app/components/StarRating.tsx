import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from './Icon';
import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import { canRateItem, formatRating, normalizeAverageRating, normalizeStarRating } from '../utils/votes';

export const STAR_COUNT = 5;

/** How much of star `index` (0-based) a rating fills: 1 whole, 0 empty, or the fraction a partial rating leaves. */
export const starFill = (value: number | null | undefined, index: number): number => {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return 0;
  return Math.min(1, Math.max(0, rating - index));
};

type Props = {
  /** The rating to show, 0 to 5. Fractions fill a star partway (4.3 shows four full stars and a third of the fifth). */
  value: number | null | undefined;
  size?: number;
  /** When given, each star can be pressed to rate 1 to 5 and the stars show `value` (the person's own rating). */
  onChange?: (stars: number) => void;
  disabled?: boolean;
  testID?: string;
  /** Read aloud for a display-only row, e.g. "Average rating". */
  label?: string;
  /** What is being rated, read aloud on each star ("Rate Museum 4 stars"). */
  name?: string;
  theme?: AppTheme;
};

const StarRating: React.FC<Props> = ({ value, size = 18, onChange, disabled, testID, label = 'Rating', name, theme: providedTheme }) => {
  const styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(providedTheme, styleTheme) ?? styleTheme;
  const s = themeStyle('components_StarRating_1', { StyleSheet }, theme);
  const rated = Number.isFinite(Number(value)) && Number(value) > 0;
  const summary = rated ? `${label}: ${Math.round(Number(value) * 10) / 10} out of ${STAR_COUNT} stars` : `${label}: not rated`;
  return (
    <View style={s.row} testID={testID} accessible={!onChange} accessibilityLabel={onChange ? undefined : summary}>
      {Array.from({ length: STAR_COUNT }, (_, index) => {
        const fraction = starFill(value, index);
        const star = (
          <View style={[s.star, themeStyle('components_StarRating_2', { size }, theme)]}>
            <Icon name="star" size={size} color={theme.colors.border} fill={theme.colors.border} />
            {fraction > 0 ? (
              <View style={[s.fill, themeStyle('components_StarRating_3', { size, fraction }, theme)]} testID={testID ? `${testID}-fill-${index + 1}` : undefined}>
                <Icon name="star" size={size} color={theme.colors.warning} fill={theme.colors.warning} />
              </View>
            ) : null}
          </View>
        );
        if (!onChange) return <React.Fragment key={index}>{star}</React.Fragment>;
        const stars = index + 1;
        return (
          <TouchableOpacity
            key={index}
            disabled={disabled}
            hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
            // The stars sit inside pressable rows, so a tap must rate and not also open the row.
            onPress={(event: any) => { event?.stopPropagation?.(); if (!disabled) onChange(stars); }}
            accessibilityRole="button"
            accessibilityLabel={name ? `Rate ${name} ${stars} ${stars === 1 ? 'star' : 'stars'}` : `Rate ${stars} ${stars === 1 ? 'star' : 'stars'}`}
            accessibilityState={{ selected: Math.round(Number(value)) === stars, disabled: Boolean(disabled) }}
            testID={testID ? `${testID}-star-${stars}` : undefined}
          >
            {star}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

type ItemRatingProps = {
  status: unknown;
  averageRating?: number | null;
  ratingCount?: number;
  userStars?: number | null;
  readOnly?: boolean;
  onRate?: (stars: number) => void;
  name: string;
  size?: number;
  /** Stars to tap are `${testID}-star-N`; the group's average is `${testID}-average`. */
  testID?: string;
  theme?: AppTheme;
};

/**
 * The rating of a trip item: travelers rate it once it is Completed. Once the viewer has rated it, their own stars
 * stand in for the group average (and can still be changed); until then the average shows (with how many ratings it
 * is over) and, for someone who may rate, empty stars to tap.
 */
export const ItemRating: React.FC<ItemRatingProps> = ({ status, averageRating, ratingCount, userStars, readOnly = false, onRate, name, size = 16, testID, theme: providedTheme }) => {
  const styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(providedTheme, styleTheme) ?? styleTheme;
  if (!canRateItem(status)) return <Text style={themeStyle('components_ItemRating_2', {}, theme)}>-</Text>;
  const canRate = !readOnly && Boolean(onRate);
  const mine = normalizeStarRating(userStars);
  if (mine !== null) {
    return <StarRating value={mine} size={size} label="Your rating" name={name} testID={testID} onChange={canRate ? onRate : undefined} theme={theme} />;
  }
  const average = normalizeAverageRating(averageRating);
  return (
    <View style={themeStyle('components_ItemRating_1', {}, theme)}>
      <StarRating value={average} size={size} label="Average rating" testID={testID ? `${testID}-average` : undefined} theme={theme} />
      <Text style={themeStyle('components_ItemRating_2', {}, theme)}>{formatRating(average, ratingCount)}</Text>
      {canRate ? <StarRating value={null} size={size} label="Your rating" name={name} testID={testID} onChange={onRate} theme={theme} /> : null}
    </View>
  );
};

export default StarRating;
