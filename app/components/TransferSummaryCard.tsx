import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { Flight } from '../tabs/transfers';
import { useAppTheme } from '../theme/ThemeContext';
import { resolveComponentTheme, themeStyle, type AppTheme } from '../theme/theme';
import { formatTravelerListDisplay, type DisplayableMember } from '../utils/memberDisplay';
import { describeTransferRoute } from '../utils/transferRoute';
import Icon from './Icon';

type Props = {
  flight: Flight;
  members: DisplayableMember[];
  showTravelers?: boolean;
  theme?: AppTheme;
  onPress: () => void;
  testID?: string;
  containerTestID?: string;
};

/** Shared itinerary, Flights, and Ground Transfers summary. The entire summary opens its details. */
export default function TransferSummaryCard({ flight, members, showTravelers = false, theme: providedTheme, onPress, testID, containerTestID }: Props) {
  const theme = resolveComponentTheme(providedTheme, useAppTheme());
  const styles = createStyles(theme);
  const route = describeTransferRoute(flight);
  const showFullNames = (route.fullFrom && route.fullFrom !== route.from) || (route.fullTo && route.fullTo !== route.to);
  const carrierLine = [flight.carrier, flight.flight_number].filter(Boolean).join(' ');
  const passengers = formatTravelerListDisplay(flight.passenger_ids ?? [], flight.passenger_name, members);

  return (
    <View testID={containerTestID}>
      <TouchableOpacity style={styles.summary} testID={testID} onPress={onPress} accessibilityRole="button">
        <View style={styles.routeRow}>
          <Icon name={route.iconName} size={20} color={theme.colors.linkText} />
          <Text style={styles.route}>
            {`${route.from || 'Departure'} → ${route.to || 'Arrival'}`}
          </Text>
        </View>
        {showFullNames ? <Text style={styles.detail}>{`${route.fullFrom || route.from} → ${route.fullTo || route.to}`}</Text> : null}
        <Text style={styles.detail}>{`${flight.departure_time || '--:--'} → ${flight.arrival_time || '--:--'}${carrierLine ? ` · ${carrierLine}` : ''}`}</Text>
        {showTravelers && passengers ? <Text style={styles.detail}>Travelers: {passengers}</Text> : null}
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (theme: AppTheme) => themeStyle('transferSummary', {}, theme);
