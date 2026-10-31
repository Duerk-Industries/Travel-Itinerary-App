import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * Monochrome line icons (24 px grid, rounded 1.75 stroke) that replace the colored emoji.
 * They draw in `color`, so they follow the theme's text color in light and dark mode.
 */
const ICON_PATHS = {
  home: ['M4 11 12 4l8 7', 'M6 9.8V20h4.5v-5.5h3V20H18V9.8'],
  itinerary: ['M4 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M16 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16'],
  blog: ['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7z', 'M7 3v18', 'M11 8h4', 'M11 12h4'],
  flight: ['M12 2.5c.9 0 1.5.8 1.5 1.8V9l7 4v2l-7-2v4.5l2 1.5v1.5l-3.5-1-3.5 1V19l2-1.5V13l-7 2v-2l7-4V4.3c0-1 .6-1.8 1.5-1.8z'],
  lodging: ['M3 19V6', 'M3 15h18v4', 'M21 15v-3a3 3 0 0 0-3-3h-7v6', 'M5.5 11a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0'],
  activity: ['M4 7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4z', 'M14.5 6.5v1.5M14.5 11v2M14.5 16v1.5'],
  transfer: ['M9 3h6a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z', 'M6 10h12', 'M9.5 13.5h.01M14.5 13.5h.01', 'M9 21l1.5-4M15 21l-1.5-4'],
  car: ['M3.5 16.5v-4l2-5a1.5 1.5 0 0 1 1.4-1h10.2a1.5 1.5 0 0 1 1.4 1l2 5v4z', 'M3.5 12.5h17', 'M6 19.5v-3M18 19.5v-3', 'M7 14.5h.01M17 14.5h.01'],
  expense: ['M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21z', 'M9 8h6M9 12h6M9 16h3'],
  report: ['M4 20h16', 'M7 16v-5M12 16V6M17 16v-8'],
  packing: ['M6 7h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M9 13.5l2 2 4-4'],
  import: ['M12 3v9', 'M8.5 8.5 12 12l3.5-3.5', 'M4 14h4l1 2h6l1-2h4v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'],
  trips: ['M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0', 'M3.5 12h17', 'M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z'],
  profile: ['M8.5 8.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0', 'M5 20a7 7 0 0 1 14 0'],
  sparkle: ['M12 4l1.8 4.7 4.7 1.8-4.7 1.8L12 17l-1.8-4.7-4.7-1.8 4.7-1.8z', 'M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z'],
  chat: ['M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-4 3.5V17H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
  note: ['M6 3h9l4 4v14H6z', 'M15 3v4h4', 'M9 12h7M9 16h7'],
  checklist: ['M4 6.5 5.5 8 8 5.5', 'M4 12.5 5.5 14 8 11.5', 'M4 18.5 5.5 20 8 17.5', 'M11 7h9M11 13h9M11 19h9'],
  bulb: ['M9 18h6M10 21h4', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6.5 7l1 13h9l1-13', 'M10 11v5M14 11v5'],
  star: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z'],
  plus: ['M12 5v14M5 12h14'],
  close: ['M6.5 6.5l11 11M17.5 6.5l-11 11'],
  calendar: ['M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M4 10h16M9 3v4M15 3v4'],
  share: ['M12 15V3', 'M8 7l4-4 4 4', 'M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7'],
  download: ['M12 3v12', 'M8 11l4 4 4-4', 'M5 20h14'],
  back: ['M15 5 8 12l7 7'],
  forward: ['M9 5l7 7-7 7'],
  logout: ['M7 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7', 'M11 16l-4-4 4-4', 'M7 12h9'],
} as const;

export type IconName = keyof typeof ICON_PATHS;

type Props = {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
  filled?: boolean;
  testID?: string;
};

const Icon: React.FC<Props> = ({ name, size = 22, color, strokeWidth = 1.75, filled = false, testID }) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? color : 'none'}
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    accessibilityElementsHidden
    importantForAccessibility="no"
    testID={testID}
  >
    {ICON_PATHS[name].map((d) => <Path key={d} d={d} />)}
  </Svg>
);

export default Icon;
