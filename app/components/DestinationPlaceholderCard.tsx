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

// Monochrome graphite pairs (base, highlight): each title still gets a stable, slightly
// different shade so neighboring cards don't look identical.
const palettes = [
  ['#0A0A0A', '#3A3A3A'], ['#141414', '#4A4A4A'], ['#1C1C1C', '#525252'],
  ['#0F0F0F', '#2E2E2E'], ['#181818', '#5C5C5C'], ['#111111', '#424242'],
];

const hashText = (value: string): number => Array.from(value).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 7);

const labelShadow = Platform.OS === 'web'
  ? { textShadow: '0px 1px 3px rgba(0,0,0,0.3)' }
  : { textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 };

const DestinationPlaceholderCard: React.FC<DestinationPlaceholderCardProps> = ({ title, style, testID, showLabel = true }) => {
  const label = String(title ?? '').trim() || 'Your destination';
  const [start, end] = useMemo(() => palettes[hashText(label) % palettes.length], [label]);
  return (
    <View style={[style, { overflow: 'hidden', backgroundColor: start }]} testID={testID}>
      <View style={{ position: 'absolute', left: '-15%', top: '-35%', width: '75%', height: '130%', borderRadius: 999, backgroundColor: end, opacity: 0.75, transform: [{ rotate: '-18deg' }] }} />
      <View style={{ position: 'absolute', right: '-20%', bottom: '-45%', width: '80%', height: '120%', borderRadius: 999, backgroundColor: start, opacity: 0.7, transform: [{ rotate: '22deg' }] }} />
      {showLabel ? (
        <View style={{ flex: 1, justifyContent: 'flex-end', padding: 18 }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', ...labelShadow }} numberOfLines={2}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
};

export default DestinationPlaceholderCard;
