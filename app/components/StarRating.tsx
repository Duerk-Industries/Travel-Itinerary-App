import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Icon from './Icon';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';

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
};

const StarRating: React.FC<Props> = ({ value, size = 18, onChange, disabled, testID, label = 'Rating' }) => {
  const theme = useStyleTheme();
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
            onPress={() => { if (!disabled) onChange(stars); }}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${stars} ${stars === 1 ? 'star' : 'stars'}`}
            accessibilityState={{ selected: Math.round(Number(value)) === stars }}
            testID={testID ? `${testID}-star-${stars}` : undefined}
          >
            {star}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

export default StarRating;
