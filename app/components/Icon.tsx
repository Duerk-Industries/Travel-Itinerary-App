import React from 'react';
import { Platform } from 'react-native';
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
  plus: ['M12 5v14M5 12h14'],
  close: ['M6.5 6.5l11 11M17.5 6.5l-11 11'],
  calendar: ['M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M4 10h16M9 3v4M15 3v4'],
  share: ['M12 15V3', 'M8 7l4-4 4 4', 'M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7'],
  download: ['M12 3v12', 'M8 11l4 4 4-4', 'M5 20h14'],
  back: ['M15 5 8 12l7 7'],
  forward: ['M9 5l7 7-7 7'],
  logout: ['M7 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7', 'M11 16l-4-4 4-4', 'M7 12h9'],
  trash: ['M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'],
  edit: ['M14 5l5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z'],
  bell: ['M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z', 'M10 21h4M12 2v2'],
  pin: ['M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0z', 'M9.5 10a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0'],
  note: ['M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6'],
  checklist: ['M9 5h11M9 12h11M9 19h11M3 5l1 1 2-3M3 12l1 1 2-3M3 19l1 1 2-3'],
  check: ['M5 12l4 4L19 6'],
  checkbox: ['M4 4h16v16H4zM7 12l3 3 7-7'],
  square: ['M4 4h16v16H4z'],
  circle: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0'],
  camera: ['M3 7h5l2-3h4l2 3h5v13H3z', 'M8 13a4 4 0 1 0 8 0a4 4 0 1 0-8 0'],
  video: ['M3 6h12v12H3zM15 10l6-4v12l-6-4'],
  microphone: ['M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8'],
  image: ['M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M14 7h.01'],
  thumbsUp: ['M8 10l4-7c2 0 3 1 2 4l-1 3h6c2 0 2 1 1 4l-2 6H8zM3 10h5v10H3z'],
  thumbsDown: ['M8 14l4 7c2 0 3-1 2-4l-1-3h6c2 0 2-1 1-4l-2-6H8zM3 4h5v10H3z'],
  heart: ['M12 21 3.5 12.5a5.5 5.5 0 0 1 8.5-7 5.5 5.5 0 0 1 8.5 7z'],
  star: ['M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z'],
  trophy: ['M7 3h10v7a5 5 0 0 1-10 0zM7 5H3v3a4 4 0 0 0 4 4M17 5h4v3a4 4 0 0 1-4 4M12 15v6M8 21h8'],
  bulb: ['M8 16c0-3-3-3-3-7a7 7 0 0 1 14 0c0 4-3 4-3 7zM9 19h6M10 22h4'],
  warning: ['M12 3 2 21h20zM12 9v5M12 17h.01'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  wave: ['M8 12 5 6c-1-2-3-1-2 1l4 10c2 5 10 5 12 0l2-5c1-2-1-3-2-1l-2 3 1-10c0-2-2-2-2 0l-1 7V3c0-2-2-2-2 0v8L11 3c0-2-2-2-2 0l1 9'],
  compass: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M16 8l-3 5-5 3 3-5z'],
  smile: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M8 9h.01M16 9h.01M7 14c2 5 8 5 10 0'],
  wow: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M8 9h.01M16 9h.01M10 16a2 2 0 1 0 4 0a2 2 0 1 0-4 0'],
  fire: ['M12 2c1 6-4 6-3 11-2-1-3-3-3-5-6 8-2 14 6 14s12-8 5-15c0 3-1 4-2 5 1-4 0-7-3-10z'],
  clap: ['M5 12l4 6c3 5 10 1 7-3l-6-9M8 14 3 7M11 12 6 4M14 10 10 3M17 5l2-2M20 9h3'],
  thanks: ['M12 4v14M12 4 9 7l-2 8-4 3 3 3 6-3 6 3 3-3-4-3-2-8z'],
  sun: ['M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2'],
  cloud: ['M6 18h12a4 4 0 0 0 0-8h-1a6 6 0 0 0-11-1 4.5 4.5 0 0 0 0 9z'],
  rain: ['M6 14h12a4 4 0 0 0 0-8h-1A6 6 0 0 0 6 5a4.5 4.5 0 0 0 0 9zM7 18l-1 3M12 18l-1 3M17 18l-1 3'],
  snow: ['M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3'],
  undo: ['M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12'],
  redo: ['M16 4l5 5-5 5M21 9H10a6 6 0 0 0 0 12'],
  play: ['M7 3l14 9-14 9z'],
  up: ['M5 15l7-7 7 7'],
  down: ['M5 9l7 7 7-7'],
} as const;

export type IconName = keyof typeof ICON_PATHS;

type Props = {
  name: IconName;
  size?: number;
  color: string;
  /** Fills the shape (e.g. a solid star); outline-only when omitted. */
  fill?: string;
  strokeWidth?: number;
  testID?: string;
};

// react-native-svg forwards props straight to the <svg> on web, where the native accessibility props are unknown
// DOM attributes (React warns about each); aria-hidden is the web equivalent.
const hiddenFromAssistiveTech = Platform?.OS === 'web'
  ? ({ 'aria-hidden': true } as Record<string, unknown>)
  : { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const };

const Icon: React.FC<Props> = ({ name, size = 22, color, fill = 'none', strokeWidth = 1.75, testID }) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...hiddenFromAssistiveTech}
    testID={testID}
  >
    {ICON_PATHS[name].map((d) => <Path key={d} d={d} />)}
  </Svg>
);

export default Icon;
