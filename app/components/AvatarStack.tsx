import { themeStyle, avatarColor as colorForUser } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// Small overlapping initials avatars for a set of travelers (itinerary traveler row, voters on a
// booking). Same deterministic palette as BlogContributorStrip/PresenceAvatars via
// colorForUser/initialsForName, so one traveler is the same color everywhere in the app.
import React from 'react';
import { Text, View } from 'react-native';
import { initialsForName } from '../../packages/messaging/src/colors';


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
  const _styleTheme = useStyleTheme();
  if (!people.length) return null;
  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;
  const overlap = Math.round(size * 0.27);
  const fontSize = Math.max(8, Math.round(size * 0.41));
  const circle = themeStyle('components_AvatarStack_1', { size: size }, _styleTheme);
  return (
    <View testID={testID} style={themeStyle('components_AvatarStack_2', {  }, _styleTheme)}>
      {visible.map((person, index) => (
        <View
          key={person.id}
          testID={testID ? `${testID}-${person.id}` : undefined}
          accessibilityLabel={person.name}
          style={[circle, themeStyle('components_AvatarStack_3', { colorForUser: colorForUser, person: person, index: index, overlap: overlap }, _styleTheme)]}
        >
          <Text style={themeStyle('components_AvatarStack_4', { fontSize: fontSize }, _styleTheme)}>{initialsForName(person.name)}</Text>
        </View>
      ))}
      {overflow > 0 ? (
        <View style={[circle, themeStyle('components_AvatarStack_5', { overlap: overlap }, _styleTheme)]}>
          <Text style={themeStyle('components_AvatarStack_6', { fontSize: fontSize }, _styleTheme)}>+{overflow}</Text>
        </View>
      ) : null}
    </View>
  );
};

export default AvatarStack;
