import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import type { CarRental } from '../../server/src/types';
import { useAppTheme } from '../theme/ThemeContext';
import { resolveComponentTheme, themeStyle, type AppTheme } from '../theme/theme';

type Props = {
  rental: Pick<CarRental, 'vendor' | 'model' | 'pickupLocation' | 'dropoffLocation'>;
  onPress: () => void;
  theme?: AppTheme;
  testID?: string;
};

/** One rental summary layout for itinerary days and the compact rental list. */
export default function CarRentalSummaryCard({ rental, onPress, theme: providedTheme, testID }: Props) {
  const theme = resolveComponentTheme(providedTheme, useAppTheme());
  const styles = themeStyle('carRentalSummary', {}, theme);
  return (
    <TouchableOpacity style={styles.summary} onPress={onPress} accessibilityRole="button" testID={testID}>
      <Text style={styles.title}>{`${rental.vendor || 'Rental car'} · ${rental.model || 'Vehicle'}`}</Text>
      <Text style={styles.route}>{`${rental.pickupLocation || 'Pickup'} → ${rental.dropoffLocation || 'Dropoff'}`}</Text>
    </TouchableOpacity>
  );
}
