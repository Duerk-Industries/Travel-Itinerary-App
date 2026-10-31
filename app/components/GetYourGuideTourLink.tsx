import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { ActivityTourLink } from '../hooks/useGetYourGuideTourLinks';
import { GETYOURGUIDE_DISCLOSURE_TEXT, openGetYourGuideTour } from '../utils/getYourGuideLinks';

type Props = {
  backendUrl: string;
  link: ActivityTourLink;
  activityName: string;
  /** Leave the disclosure to the caller, for a list that shows it once. */
  hideDisclosure?: boolean;
  testID?: string;
  theme?: AppTheme;
};

export const GetYourGuideDisclosure: React.FC<{ theme?: AppTheme }> = ({ theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  return <Text accessibilityRole="text" style={themeStyle('components_GetYourGuideCta_3', { theme: theme }, (theme ?? _styleTheme))}>{GETYOURGUIDE_DISCLOSURE_TEXT}</Text>;
};

/** The tour matched to an activity. */
const GetYourGuideTourLink: React.FC<Props> = ({ backendUrl, link, activityName, hideDisclosure = false, testID, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  return (
    <View testID={testID} style={themeStyle('components_GetYourGuideCta_1', {  }, (theme ?? _styleTheme))}>
      <TouchableOpacity
        accessibilityRole="link"
        accessibilityLabel={`Book ${activityName} on GetYourGuide`}
        onPress={() => { void openGetYourGuideTour(backendUrl, link.path); }}
        testID={testID ? `${testID}-link` : undefined}
      >
        <Text style={themeStyle('components_GetYourGuideCta_2', { theme: theme }, (theme ?? _styleTheme))}>Book on GetYourGuide ↗</Text>
      </TouchableOpacity>
      {hideDisclosure ? null : <GetYourGuideDisclosure theme={theme} />}
    </View>
  );
};

export default GetYourGuideTourLink;
