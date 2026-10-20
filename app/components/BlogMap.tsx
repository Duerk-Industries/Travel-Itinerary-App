import React from 'react';
import { Text, View } from 'react-native';
import TripMap from './TripMap';
import type { BlogDayMapPoints } from '../../server/src/services/blogMapProjection';
export default function BlogMap({ map, testID, nativeEnabled }: { map: BlogDayMapPoints; testID?: string; nativeEnabled?: boolean }) {
  return <View testID={testID}>
    <TripMap nativeEnabled={nativeEnabled} points={map.points.slice(0, 100).map((p, n) => ({ id: `area-${n}`, kind: 'activity', ...p, coordinateSource: 'manual', title: `${map.precision === 'approximate' ? 'Approximate area' : 'Photo location'} ${n + 1}` }))} />
    {map.precision === 'approximate' && <Text>Approximate areas (about 1 km); locations near lodging are omitted.</Text>}
  </View>;
}
