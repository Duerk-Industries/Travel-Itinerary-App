// Small overlapping initials avatars for a set of travelers (itinerary traveler row, voters on a
// booking). Same deterministic palette as BlogContributorStrip/PresenceAvatars via
// colorForUser/initialsForName, so one traveler is the same color everywhere in the app.
import React from 'react';
import { Text, View } from 'react-native';
import { colorForUser, initialsForName } from '../../packages/messaging/src/colors';

export type AvatarPerson = {
  // Prefer the account's userId so colors match other surfaces (blog, chat); guest members
  // without an account fall back to their member id.
  id: string;
  name: string;
};

type Props = {
  people: AvatarPerson[];
  size?: number;
  max?: number;
  testID?: string;
};

const AvatarStack: React.FC<Props> = ({ people, size = 22, max = 5, testID }) => {
  if (!people.length) return null;
  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;
  const overlap = Math.round(size * 0.27);
  const fontSize = Math.max(8, Math.round(size * 0.41));
  const circle = { width: size, height: size, borderRadius: size / 2, justifyContent: 'center' as const, alignItems: 'center' as const, borderWidth: 1.5, borderColor: '#fff' };
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center' }}>
      {visible.map((person, index) => (
        <View
          key={person.id}
          testID={testID ? `${testID}-${person.id}` : undefined}
          accessibilityLabel={person.name}
          style={[circle, { backgroundColor: colorForUser(person.id), marginLeft: index === 0 ? 0 : -overlap }]}
        >
          <Text style={{ color: '#fff', fontSize, fontWeight: '700' }}>{initialsForName(person.name)}</Text>
        </View>
      ))}
      {overflow > 0 ? (
        <View style={[circle, { backgroundColor: '#9e9e9e', marginLeft: -overlap }]}>
          <Text style={{ color: '#fff', fontSize, fontWeight: '700' }}>+{overflow}</Text>
        </View>
      ) : null}
    </View>
  );
};

export default AvatarStack;
