import React from 'react';
import { Image, Text, View } from 'react-native';
import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';

export type ActivityImage = { url: string; credit: string; pageUrl?: string };

type Props = {
  image: ActivityImage | null | undefined;
  /** What the picture shows, read aloud and used as the fallback text. */
  name: string;
  testID?: string;
};

/** A picture of an activity with its photographer's credit; renders nothing when the activity has none. */
const ActivityPhoto: React.FC<Props> = ({ image, name, testID }) => {
  const theme = useStyleTheme();
  if (!image?.url) return null;
  return (
    <View style={themeStyle('components_ActivityPhoto_1', {}, theme)} testID={testID}>
      <Image source={{ uri: image.url }} accessibilityIgnoresInvertColors accessibilityLabel={name} style={themeStyle('components_ActivityPhoto_2', {}, theme)} />
      {image.credit ? <Text style={themeStyle('components_ActivityPhoto_3', {}, theme)}>{`Photo: ${image.credit}`}</Text> : null}
    </View>
  );
};

export default ActivityPhoto;
