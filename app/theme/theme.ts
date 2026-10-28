import { Platform } from 'react-native';
import { resolveAppearance, type AppearancePreference, type ResolvedAppearance } from '../utils/appearancePreference';

export type AppTheme = {
  mode: ResolvedAppearance;
  colors: {
    background: string;
    backgroundAlt: string;
    surface: string;
    surfaceMuted: string;
    text: string;
    textMuted: string;
    border: string;
    primary: string;
    link: string;
    nature: string;
    cta: string;
    alert: string;
    premium: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    onPrimary: string;
    onSurface: string;
    /** Text and icons on `cta` buttons. */
    onCta: string;
  };
  /**
   * Soft two-stop gradients for the monochrome look: `cta` for primary buttons, `hero` for
   * banners and photo-less cards. Each is [top, bottom]; `cta`'s average is close to `colors.cta`.
   */
  gradients: {
    cta: [string, string];
    hero: [string, string];
  };
  typography: {
    display: number;
    h1: number;
    h2: number;
    h3: number;
    body: number;
    small: number;
    caption: number;
    weightRegular: '400';
    weightMedium: '500';
    weightSemibold: '600';
    weightBold: '700';
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
};

// Shared spacing scale (mode-independent) — use these instead of ad-hoc pixel
// values so padding/margin/gap stay consistent across tabs and dialogs.
const spacing: AppTheme['spacing'] = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

// Minimum recommended tap target sizes (iOS HIG: 44pt, Material: 48dp) and a
// hitSlop preset to compensate when a control is visually smaller than that
// without growing its footprint in dense layouts (e.g. icon button rows).
export const MIN_TOUCH_TARGET = 44;
export const hitSlop = {
  small: { top: 8, bottom: 8, left: 8, right: 8 },
  medium: { top: 10, bottom: 10, left: 10, right: 10 },
} as const;

const lightTheme: AppTheme = {
  mode: 'light',
  // Monochrome: white surfaces, near-black ink, and soft graphite gradients for emphasis.
  // Semantic colors (success / warning / error / info) keep their hues.
  colors: {
    background: '#FFFFFF',
    backgroundAlt: '#F5F5F5',
    surface: '#FFFFFF',
    surfaceMuted: '#F4F4F4',
    text: '#0A0A0A',
    textMuted: '#6B6B6B',
    border: '#E8E8E8',
    primary: '#0A0A0A',
    link: '#0A0A0A',
    nature: '#3F3F3F',
    cta: '#141414',
    alert: '#E76F51',
    premium: '#8A6D2B',
    success: '#2E7D32',
    warning: '#ED6C02',
    error: '#C62828',
    info: '#0288D1',
    onPrimary: '#FFFFFF',
    onSurface: '#0A0A0A',
    onCta: '#FFFFFF',
  },
  gradients: {
    cta: ['#2B2B2B', '#050505'],
    hero: ['#3A3A3A', '#0A0A0A'],
  },
  typography: {
    display: 44,
    h1: 32,
    h2: 24,
    h3: 20,
    body: 16,
    small: 14,
    caption: 12,
    weightRegular: '400',
    weightMedium: '500',
    weightSemibold: '600',
    weightBold: '700',
  },
  spacing,
};

const darkTheme: AppTheme = {
  mode: 'dark',
  // Monochrome dark: true-black ground, graphite surfaces, and white for emphasis.
  colors: {
    background: '#000000',
    backgroundAlt: '#111111',
    surface: '#161616',
    surfaceMuted: '#111111',
    text: '#F5F5F5',
    textMuted: '#A3A3A3',
    border: '#2A2A2A',
    primary: '#1F1F1F',
    link: '#F5F5F5',
    nature: '#BDBDBD',
    cta: '#F2F2F2',
    alert: '#E76F51',
    premium: '#D4B26A',
    success: '#4CAF50',
    warning: '#FF9800',
    error: '#EF5350',
    info: '#4FC3F7',
    onPrimary: '#F5F5F5',
    onSurface: '#F5F5F5',
    onCta: '#0A0A0A',
  },
  gradients: {
    cta: ['#FFFFFF', '#D9D9D9'],
    hero: ['#2E2E2E', '#0A0A0A'],
  },
  typography: lightTheme.typography,
  spacing: lightTheme.spacing,
};

/**
 * Color for text that acts as a link or button label: near-black on light surfaces, near-white on dark ones.
 */
export const linkTextColor = (theme: AppTheme): string => (theme.mode === 'dark' ? theme.colors.link : theme.colors.primary);

/**
 * Style that paints a vertical two-stop gradient behind a view, on top of its solid
 * `backgroundColor` (which stays the fallback where gradients aren't supported). Web uses CSS;
 * native uses React Native's `experimental_backgroundImage` (new architecture).
 */
export const gradientFill = ([top, bottom]: [string, string]): Record<string, string> => {
  const css = `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`;
  return Platform.OS === 'web' ? { backgroundImage: css } : { experimental_backgroundImage: css };
};

/**
 * Background for buttons whose label is fixed white (admin tools): the main button color in
 * light mode, and graphite in dark mode, where the main button color is near-white.
 */
export const whiteLabelButtonColor = (theme: AppTheme): string => (theme.mode === 'dark' ? '#333333' : theme.colors.cta);

export const getAppTheme = (
  appearancePreference: AppearancePreference,
  systemScheme: 'light' | 'dark' | null | undefined
): AppTheme => {
  const resolved = resolveAppearance(appearancePreference, systemScheme);
  return resolved === 'dark' ? darkTheme : lightTheme;
};
