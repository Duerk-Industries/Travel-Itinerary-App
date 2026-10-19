import React from 'react';
import { Text, View } from 'react-native';
import type { TripMapProps } from './TripMap.types';
// Native entry point deliberately imports no DOM, map library, or web CSS.
export default function TripMap({ points, testID }: TripMapProps) {
  return <View testID={testID}>{points.map(point => <Text key={point.id}>{point.title}</Text>)}</View>;
}
