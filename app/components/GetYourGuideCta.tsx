import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  GETYOURGUIDE_DISCLOSURE_TEXT,
  getGetYourGuideCtaLabel,
  isGetYourGuideActivityEligible,
  openGetYourGuideDescriptor,
  requestGetYourGuideDescriptor,
  type GetYourGuideClientActivity,
  type GetYourGuideClientDescriptor,
} from '../utils/getYourGuideLinks';
import type { GetYourGuideTravelerContext } from '../utils/getYourGuideEligibility';
import type { AppTheme } from '../theme/theme';

export type GetYourGuideCtaProps = {
  backendUrl: string;
  headers?: Record<string, string>;
  activity: GetYourGuideClientActivity;
  destination?: string | null;
  context?: GetYourGuideTravelerContext;
  featureEnabled?: boolean;
  testID?: string;
  theme?: AppTheme;
};

/**
 * Optional, additive CTA. It deliberately renders nothing while the
 * descriptor is loading or unavailable, so the ordinary activity row never
 * waits on or visually advertises a disabled provider.
 */
export const GetYourGuideCta: React.FC<GetYourGuideCtaProps> = ({
  backendUrl,
  headers,
  activity,
  destination,
  context,
  featureEnabled,
  testID,
  theme,
}) => {
  const [descriptor, setDescriptor] = useState<GetYourGuideClientDescriptor | null>(null);

  useEffect(() => {
    let active = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setDescriptor(null);
    if (featureEnabled === false || !isGetYourGuideActivityEligible(activity, destination, context)) {
      return () => {
        active = false;
        controller?.abort();
      };
    }
    void requestGetYourGuideDescriptor({
      backendUrl,
      headers,
      activity,
      destination,
      context,
      featureEnabled,
      signal: controller?.signal,
    }).then((next) => {
      if (active) setDescriptor(next);
    });
    return () => {
      active = false;
      controller?.abort();
    };
  }, [activity, backendUrl, context, destination, featureEnabled, headers]);

  if (!descriptor) return null;
  const label = getGetYourGuideCtaLabel(activity.name, activity.activityType);
  return (
    <View testID={testID ?? `getyourguide-cta-${activity.id}`} style={{ marginTop: 4 }}>
      <TouchableOpacity
        accessibilityRole="link"
        accessibilityLabel={label}
        onPress={() => {
          void openGetYourGuideDescriptor(backendUrl, descriptor);
        }}
        testID={`${testID ?? `getyourguide-cta-${activity.id}`}-link`}
      >
        <Text style={{ color: theme?.colors.link ?? '#2563eb', textDecorationLine: 'underline' }}>{label}</Text>
      </TouchableOpacity>
      <Text accessibilityRole="text" style={{ fontSize: 11, opacity: 0.75, color: theme?.colors.textMuted }}>
        {GETYOURGUIDE_DISCLOSURE_TEXT}
      </Text>
    </View>
  );
};

export default GetYourGuideCta;
