import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useMemo } from 'react';
import { Platform, Text, View } from 'react-native';

type DestinationPlaceholderCardProps = {
  title?: string | null;
  style?: any;
  testID?: string;
  // Off when the placeholder sits behind a card that prints its own title (Home trip banner,
  // itinerary day cards); otherwise the two titles overlap. The title still picks the colors.
  showLabel?: boolean;
};

const palettes = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_DestinationPlaceholderCard_6', {  }, _theme);

const hashText = (value: string): number => Array.from(value).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 7);

const labelShadow = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_DestinationPlaceholderCard_7', { Platform: Platform }, _theme);

const DestinationPlaceholderCard: React.FC<DestinationPlaceholderCardProps> = ({ title, style, testID, showLabel = true }) => {
  const _styleTheme = useStyleTheme();
  const label = String(title ?? '').trim() || 'Your destination';
  const [start, end] = useMemo(() => palettes(_styleTheme)[hashText(label) % palettes(_styleTheme).length], [label, _styleTheme]);
  return (
    <View style={[style, themeStyle('components_DestinationPlaceholderCard_1', { start: start }, _styleTheme)]} testID={testID}>
      <View style={themeStyle('components_DestinationPlaceholderCard_2', { end: end }, _styleTheme)} />
      <View style={themeStyle('components_DestinationPlaceholderCard_3', { start: start }, _styleTheme)} />
      {showLabel ? (
        <View style={themeStyle('components_DestinationPlaceholderCard_4', {  }, _styleTheme)}>
          <Text style={themeStyle('components_DestinationPlaceholderCard_5', { labelShadow: labelShadow(_styleTheme) }, _styleTheme)} numberOfLines={2}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
};

export default DestinationPlaceholderCard;
