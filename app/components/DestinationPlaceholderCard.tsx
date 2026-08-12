import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

type DestinationPlaceholderCardProps = {
  title?: string | null;
  style?: any;
  testID?: string;
};

const palettes = [
  ['#12344d', '#3a7d8c'], ['#3f2b63', '#b06ab3'], ['#7b341e', '#d97706'],
  ['#164e63', '#0f766e'], ['#334155', '#64748b'], ['#365314', '#65a30d'],
];

const hashText = (value: string): number => Array.from(value).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 7);

const DestinationPlaceholderCard: React.FC<DestinationPlaceholderCardProps> = ({ title, style, testID }) => {
  const label = String(title ?? '').trim() || 'Your destination';
  const [start, end] = useMemo(() => palettes[hashText(label) % palettes.length], [label]);
  return (
    <View style={[style, { overflow: 'hidden', backgroundColor: start }]} testID={testID}>
      <View style={{ position: 'absolute', left: '-15%', top: '-35%', width: '75%', height: '130%', borderRadius: 999, backgroundColor: end, opacity: 0.75, transform: [{ rotate: '-18deg' }] }} />
      <View style={{ position: 'absolute', right: '-20%', bottom: '-45%', width: '80%', height: '120%', borderRadius: 999, backgroundColor: start, opacity: 0.7, transform: [{ rotate: '22deg' }] }} />
      <View style={{ flex: 1, justifyContent: 'flex-end', padding: 18 }}>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }} numberOfLines={2}>{label}</Text>
      </View>
    </View>
  );
};

export default DestinationPlaceholderCard;
