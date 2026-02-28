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
};

const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    background: '#FAFCFD',
    backgroundAlt: '#F2F5F7',
    surface: '#FFFFFF',
    surfaceMuted: '#F2F5F7',
    text: '#111827',
    textMuted: '#6B7280',
    border: '#E6ECEF',
    primary: '#152944',
    link: '#45B7C6',
    nature: '#5E6B3F',
    cta: '#F59E0B',
    alert: '#E76F51',
    premium: '#D97706',
    success: '#2E7D32',
    warning: '#ED6C02',
    error: '#C62828',
    info: '#0288D1',
    onPrimary: '#E6ECEF',
    onSurface: '#111827',
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
};

const darkTheme: AppTheme = {
  mode: 'dark',
  colors: {
    background: '#0B1726',
    backgroundAlt: '#1C2B3A',
    surface: '#243647',
    surfaceMuted: '#1C2B3A',
    text: '#E6ECEF',
    textMuted: '#B8C2CC',
    border: '#385266',
    primary: '#152944',
    link: '#5FD2E0',
    nature: '#7E8D5A',
    cta: '#F59E0B',
    alert: '#E76F51',
    premium: '#D97706',
    success: '#2E7D32',
    warning: '#ED6C02',
    error: '#C62828',
    info: '#0288D1',
    onPrimary: '#E6ECEF',
    onSurface: '#E6ECEF',
  },
  typography: lightTheme.typography,
};

export const getAppTheme = (
  appearancePreference: AppearancePreference,
  systemScheme: 'light' | 'dark' | null | undefined
): AppTheme => {
  const resolved = resolveAppearance(appearancePreference, systemScheme);
  return resolved === 'dark' ? darkTheme : lightTheme;
};
