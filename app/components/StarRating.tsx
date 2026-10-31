import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from './Icon';
import { MAX_STARS, canRateItem, formatRating } from '../utils/votes';

type StarRatingProps = {
  /** The stars currently filled in. */
  value: number | null | undefined;
  onRate?: (stars: number) => void;
  /** What is being rated, for screen readers. */
  name: string;
  disabled?: boolean;
  testID?: string;
  theme?: AppTheme;
};

const STARS = Array.from({ length: MAX_STARS }, (_, index) => index + 1);

const StarRating: React.FC<StarRatingProps> = ({ value, onRate, name, disabled = false, testID, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme) ?? _styleTheme;
  return (
    <View testID={testID} style={themeStyle('components_StarRating_1', {}, theme)}>
      {STARS.map((stars) => (
        <TouchableOpacity
          key={stars}
          testID={testID ? `${testID}-star-${stars}` : undefined}
          accessibilityRole="button"
          accessibilityLabel={`Rate ${name} ${stars} ${stars === 1 ? 'star' : 'stars'}`}
          accessibilityState={{ selected: value === stars, disabled }}
          disabled={disabled}
          hitSlop={{ top: 8, bottom: 8 }}
          onPress={(event: any) => { event?.stopPropagation?.(); onRate?.(stars); }}
          style={themeStyle('components_StarRating_2', {}, theme)}
        >
          <Icon name="star" size={20} color={theme.colors.warning} filled={(value ?? 0) >= stars} />
        </TouchableOpacity>
      ))}
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
  testID?: string;
  theme?: AppTheme;
};

/** The rating of a trip item: travelers rate it once it is Completed, and see the group's average. */
export const ItemRating: React.FC<ItemRatingProps> = ({ status, averageRating, ratingCount, userStars, readOnly = false, onRate, name, testID, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme) ?? _styleTheme;
  if (!canRateItem(status)) return <Text style={themeStyle('components_StarRating_3', {}, theme)}>-</Text>;
  return (
    <View style={themeStyle('components_StarRating_4', {}, theme)}>
      {!readOnly && onRate ? <StarRating value={userStars} onRate={onRate} name={name} testID={testID} theme={theme} /> : null}
      <Text style={themeStyle('components_StarRating_3', {}, theme)}>{formatRating(averageRating, ratingCount)}</Text>
    </View>
  );
};

export default StarRating;
