import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { Tour } from '../tabs/activities';
import type { AppTheme } from '../theme/theme';
import ActivityPhoto from './ActivityPhoto';
import GetYourGuideCta from './GetYourGuideCta';
import { formatClockTime } from '../utils/timeFormat';

type Props = {
  activity: Tour;
  styles: Record<string, any>;
  theme?: AppTheme;
  onPress: () => void;
  testID: string;
  photoTestID?: string;
  bookingTestID?: string;
  travelers?: string;
  controls?: React.ReactNode;
  backendUrl: string;
  headers?: Record<string, string>;
  destination?: string | null;
  /** Opens the start location in the traveler's maps app. */
  onOpenLocation?: (address: string) => void;
};

/** Shared activity summary for itinerary days and the mobile Activities page. */
export default function ActivitySummaryCard({ activity, styles, theme, onPress, testID, photoTestID,
  bookingTestID, travelers, controls, backendUrl, headers, destination, onOpenLocation }: Props) {
  const location = activity.startLocation?.trim() ?? '';
  return (
    <View style={styles.dayInfoRow}>
      <View style={styles.dayInfoText}>
        <TouchableOpacity testID={testID} onPress={onPress} accessibilityRole="button">
          <Text style={[styles.dayInfoRoute, styles.linkText]}>{activity.name}</Text>
        </TouchableOpacity>
        <Text style={styles.helperText}>
          {`${formatClockTime(activity.startTime) || 'Time TBD'} · `}
          {location && onOpenLocation ? (
            <Text style={styles.linkText} accessibilityRole="link" accessibilityLabel={`Open ${location} in maps`}
              testID={`${testID}-location`} onPress={() => onOpenLocation(location)}>{location}</Text>
          ) : location || 'Location TBD'}
          {activity.duration ? ` · ${activity.duration}` : ''}
        </Text>
        {activity.notes ? <Text style={styles.helperText}>{activity.notes}</Text> : null}
        <ActivityPhoto image={activity.image} name={activity.name} testID={photoTestID} />
        {travelers ? <Text style={styles.helperText}>Travelers: {travelers}</Text> : null}
        <GetYourGuideCta backendUrl={backendUrl} headers={headers} activity={activity}
          destination={destination} theme={theme} testID={bookingTestID} />
      </View>
      {controls}
    </View>
  );
}
