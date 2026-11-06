import { themeStyle } from '../theme/theme';
import { useAppTheme } from '../theme/ThemeContext';
import React from 'react';
import { TouchableOpacity } from 'react-native';
import Icon from './Icon';
import { ThemedText as Text } from './ThemedText';

type Props = {
  open: boolean;
  onPress: () => void;
  testID?: string;
};

/** Shows or hides a trip map. Drawn as an outlined button so it reads as something to press, not a caption. */
const MapToggleButton: React.FC<Props> = ({ open, onPress, testID }) => {
  const theme = useAppTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      testID={testID}
      style={themeStyle('components_MapToggleButton_1', {}, theme)}
    >
      <Icon name="pin" size={18} color={theme.colors.text} />
      <Text style={themeStyle('components_MapToggleButton_2', {}, theme)}>{open ? 'Hide map' : 'Show map'}</Text>
      <Text tone="muted" accessibilityElementsHidden importantForAccessibility="no">{open ? '▴' : '▾'}</Text>
    </TouchableOpacity>
  );
};

export default MapToggleButton;
