import { Appearance, StyleSheet, Platform, type ViewStyle } from 'react-native';
import type { KeepsakeTheme } from '../utils/keepsake';
import { loadStoredAppearancePreference, resolveAppearance, type AppearancePreference, type ResolvedAppearance } from '../utils/appearancePreference';

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
    ctaGradientStart: string;
    ctaGradientEnd: string;
    changeTripSurface: string;
    alert: string;
    premium: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    onPrimary: string;
    transparent: string;
    scrim: string;
    overlay: string;
    onAccent: string;
    linkText: string;
    accentSurface: string;
    accentBorder: string;
    accentAction: string;
    dangerText: string;
    dangerSurface: string;
    dangerBorder: string;
    dangerAction: string;
    successText: string;
    successSurface: string;
    successAction: string;
    warningText: string;
    warningSurface: string;
    warningAction: string;
    premiumText: string;
    premiumSurface: string;
    premiumBorder: string;
    premiumAction: string;
    onCta: string;
    selectedSurface: string;
    onSelected: string;
    onSurface: string;
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
    background: '#FFFFFF', // Previously #FAFCFD
    backgroundAlt: '#F5F5F5', // Previously #F2F5F7
    surface: '#FFFFFF',
    surfaceMuted: '#F4F4F4', // Previously #F2F5F7
    text: '#0A0A0A', // Previously #111827
    textMuted: '#6B6B6B', // Previously #626C79
    border: '#E8E8E8', // Previously #E6ECEF
    primary: '#0A0A0A', // Previously #152944
    link: '#0A0A0A', // Previously #45B7C6
    nature: '#3F3F3F', // Previously #5E6B3F
    ctaGradientStart: '#2B2B2B',
    ctaGradientEnd: '#050505',
    changeTripSurface: 'rgba(255,255,255,0.85)', // Previously translucent navy via overlay
    cta: '#141414', // Previously #F59E0B
    alert: '#E76F51',
    premium: '#8A6D2B', // Previously #D97706
    success: '#2E7D32',
    warning: '#ED6C02',
    error: '#C62828',
    info: '#0288D1',
    onPrimary: '#FFFFFF', // Previously #E6ECEF
    transparent: 'transparent',
    scrim: 'rgba(0,0,0,0.5)',
    overlay: 'rgba(21,41,68,0.45)',
    onAccent: '#FFFFFF',
    linkText: '#0A0A0A', // Previously #152944
    accentSurface: '#F4F4F4', // Previously #EFFAFB
    accentBorder: '#E8E8E8', // Previously #9DCFD6
    accentAction: '#0A0A0A', // Previously #152944
    dangerText: '#B91C1C',
    dangerSurface: '#FFF1F2',
    dangerBorder: '#BE123C',
    dangerAction: '#B91C1C',
    successText: '#166534',
    successSurface: '#F0FDF4',
    successAction: '#166534',
    warningText: '#854D0E',
    warningSurface: '#FFFBEB',
    warningAction: '#854D0E',
    premiumText: '#705820', // Previously #6D28D9
    premiumSurface: '#FAF7EF', // Previously #F5F3FF
    premiumBorder: '#8A6D2B', // Previously #7C3AED
    premiumAction: '#705820', // Previously #6D28D9
    onCta: '#FFFFFF', // Previously #0B1726
    selectedSurface: '#0A0A0A', // Previously #152944
    onSelected: '#FFFFFF',
    onSurface: '#0A0A0A', // Previously #111827
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
    background: '#000000', // Previously #0B1726
    backgroundAlt: '#111111', // Previously #1C2B3A
    surface: '#161616', // Previously #243647
    surfaceMuted: '#111111', // Previously #1C2B3A
    text: '#F5F5F5', // Previously #E6ECEF
    textMuted: '#A3A3A3', // Previously #B8C2CC
    border: '#2A2A2A', // Previously #385266
    primary: '#1F1F1F', // Previously #152944
    link: '#F5F5F5', // Previously #5FD2E0
    nature: '#BDBDBD', // Previously #7E8D5A
    ctaGradientStart: '#FFFFFF',
    ctaGradientEnd: '#D9D9D9',
    changeTripSurface: 'rgba(255,255,255,0.85)', // Previously translucent black via overlay
    cta: '#F2F2F2', // Previously #F59E0B
    alert: '#E76F51',
    premium: '#D4B26A', // Previously #D97706
    success: '#4CAF50', // Previously #2E7D32
    warning: '#FF9800', // Previously #ED6C02
    error: '#EF5350', // Previously #C62828
    info: '#4FC3F7', // Previously #0288D1
    onPrimary: '#FFFFFF', // Previously #E6ECEF
    transparent: 'transparent',
    scrim: 'rgba(0,0,0,0.65)',
    overlay: 'rgba(0,0,0,0.65)',
    onAccent: '#FFFFFF',
    linkText: '#F5F5F5', // Previously #5FD2E0
    accentSurface: '#111111', // Previously #163D46
    accentBorder: '#2A2A2A', // Previously #397783
    accentAction: '#1F1F1F', // Previously #152944
    dangerText: '#FDA4AF',
    dangerSurface: '#471F2B',
    dangerBorder: '#FB7185',
    dangerAction: '#B91C1C',
    successText: '#86EFAC',
    successSurface: '#153D2E',
    successAction: '#166534',
    warningText: '#FDE68A',
    warningSurface: '#423619',
    warningAction: '#854D0E',
    premiumText: '#D4B26A', // Previously #D8B4FE
    premiumSurface: '#30291B', // Previously #382453
    premiumBorder: '#D4B26A', // Previously #C4B5FD
    premiumAction: '#705820', // Previously #6D28D9
    onCta: '#0A0A0A', // Previously #0B1726
    selectedSurface: '#F5F5F5', // Previously #5FD2E0
    onSelected: '#0A0A0A', // Previously #0B1726
    onSurface: '#F5F5F5', // Previously #E6ECEF
  },
  gradients: {
    cta: ['#FFFFFF', '#D9D9D9'],
    hero: ['#2E2E2E', '#0A0A0A'],
  },
  typography: lightTheme.typography,
  spacing: lightTheme.spacing,
};

/** Semantic link foreground, readable on standard surfaces in either appearance. */
export const linkTextColor = (theme: AppTheme): string => theme.colors.linkText;

/** A surface override must also remove a gradient from an earlier style in an array. */
const solidBackground = <T,>(style: T): T => {
  if (!style || typeof style !== 'object' || !('backgroundColor' in style)) return style;
  const key = Platform.OS === 'web' ? 'backgroundImage' : 'experimental_backgroundImage';
  return key in style ? style : { ...style, [key]: Platform.OS === 'web' ? 'none' : [] };
};
const solidBackgrounds = <T extends Record<string, any>>(styles: T): T =>
  Object.fromEntries(Object.entries(styles).map(([key, value]) => [key, solidBackground(value)])) as T;

/** Shared gradient with a solid CTA fallback; visual definitions stay in this file. */
const ctaGradientStyle = (theme: AppTheme) => ({
  backgroundColor: theme.colors.cta,
  [Platform.OS === 'web' ? 'backgroundImage' : 'experimental_backgroundImage']:
    `linear-gradient(180deg, ${theme.colors.ctaGradientStart}, ${theme.colors.ctaGradientEnd})`,
});

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

/** Used by error boundaries, where React hooks cannot run. */
export const getStandaloneTheme = (): AppTheme => getAppTheme(loadStoredAppearancePreference(), Appearance?.getColorScheme?.() ?? null);

/** Resolve legacy partial theme props against the active provider rather than a fixed light fallback. */
export const resolveComponentTheme = (
  override: { mode?: ResolvedAppearance; colors?: Partial<AppTheme['colors']> } | null | undefined,
  inherited: AppTheme,
): AppTheme => {
  if (!override) return inherited;
  if ('typography' in override && 'spacing' in override && override.colors?.accentSurface) return override as AppTheme;
  return { ...inherited, ...override, colors: { ...inherited.colors, ...override.colors } };
};

/** All app presentation definitions live here. Runtime measurements/animation values are supplied by callers. */
// React Native, native animated values and browser CSS share this integration boundary.
type ThemeStyleValues = Record<string, any>;
const styleFactories = {
  App_layout1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  components_ActionDropdown_layout1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  components_ActionDropdown_layout2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', inset: 0 }),
  components_ActionDropdown_layout3: (_theme: AppTheme, { theme, position, menuWidth, height }: ThemeStyleValues): any => ({ position: 'absolute', top: position.top, right: position.right, width: menuWidth, maxHeight: Math.max(120, height - position.top - 12), backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, paddingVertical: 6, elevation: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }),
  components_ActionDropdown_layout4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingHorizontal: 18, paddingVertical: 13 }),
  components_ActionDropdown_layout5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, fontSize: 15 }),
  components_ActivityEditForm_layout1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }),
  components_ActivityEditForm_layout2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 128 }),
  components_ActivityEditForm_layout3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', minWidth: 0 }),
  components_ActivityEditForm_layout4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 0 }),
  components_BannerPicturePicker_layout1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '90%', maxWidth: 480, padding: 20, gap: 12 }),
  tabs_allTrips_layout1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  tabs_allTrips_layout2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }),
  tabs_allTrips_layout3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', gap: 8 }),
  tabs_allTrips_layout4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 24 }),
  tabs_allTrips_layout5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  tabs_createTripWizard_layout1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', gap: 8 }),
  tabs_overview_layout1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }),
  tabs_overview_layout4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%' }),
  tabs_overview_layout2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center', width: '100%' }),
  tabs_overview_layout3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  tabs_tripBlog_layout1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', height: 280, borderRadius: 16, marginBottom: 16 }),
  richTextRun1: (_theme: AppTheme, { run, linkColor }: ThemeStyleValues): any => ({
        ...(run.bold ? themeStyle('components_BlogRichTextView_1', {  }, _theme) : {}),
        ...(run.italic ? themeStyle('components_BlogRichTextView_2', {  }, _theme) : {}),
        ...((run.underline || run.href) && run.strike ? themeStyle('components_BlogRichTextView_3', {  }, _theme) : {}),
        ...((run.underline || run.href) && !run.strike ? themeStyle('components_BlogRichTextView_4', {  }, _theme) : {}),
        ...(!(run.underline || run.href) && run.strike ? themeStyle('components_BlogRichTextView_5', {  }, _theme) : {}),
        ...(run.code ? themeStyle('components_BlogRichTextView_6', {  }, _theme) : {}),
        ...(run.href ? themeStyle('components_BlogRichTextView_7', { linkColor: linkColor }, _theme) : {}),
      }),
  keepsakeMapLayer1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({circleRadius:12,circleColor: _theme.colors.primary,circleStrokeColor: _theme.colors.onAccent,circleStrokeWidth:2}),
  keepsakeMapLayer2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({textField:['get','label'],textSize:12,textFont:['Noto Sans Regular'],textColor: _theme.colors.onAccent}),
  nativeMapLayer1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ circleRadius: 16, circleColor: _theme.colors.primary, circleStrokeColor: _theme.colors.onAccent, circleStrokeWidth: 2 }),
  nativeMapLayer2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ textField: ['get', 'label'], textSize: 13, textFont: ['Noto Sans Regular'], textColor: _theme.colors.onAccent }),
  nativeMapLayer3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ lineColor: _theme.colors.primary, lineWidth: 3, lineDasharray: [2, 2] }),
  expenseSelectWeb1: (_theme: AppTheme, { toWebStyle, styles, narrowSelectField, webFieldBase }: ThemeStyleValues): any => ({
                      ...toWebStyle(styles.expenseFieldCategory),
                      ...toWebStyle(narrowSelectField),
                      ...webFieldBase,
                    }),
  expenseSelectWeb2: (_theme: AppTheme, { toWebStyle, styles, narrowSelectField, webFieldBase }: ThemeStyleValues): any => ({
                      ...toWebStyle(styles.expenseFieldCurrency),
                      ...toWebStyle(narrowSelectField),
                      ...webFieldBase,
                    }),

  // App.tsx
  App_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            minHeight: 0,
          }),
  // App.tsx
  App_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          }),
  // App.tsx
  App_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center' }),
  // App.tsx
  App_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16 }),
  // App.tsx
  App_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // App.tsx
  App_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', gap: 8 }),
  // App.tsx
  App_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingHorizontal: 8, paddingVertical: 2 }),
  // App.tsx
  App_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexShrink: 1 }),
  // App.tsx
  App_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // App.tsx
  App_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // App.tsx
  App_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxWidth: 200 }),
  // App.tsx
  App_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', marginTop: 24 }),
  // App.tsx
  App_13: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText, fontWeight: theme.typography.weightSemibold }),
  App_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexShrink: 1, minWidth: 0 }),
  // AppEntry.js
  AppEntry_1: (_theme: AppTheme, { StyleSheet, Platform, StatusBar }: ThemeStyleValues): any => (StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: _theme.colors.surfaceMuted,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 24 : 24,
  },
  title: {
    color: _theme.colors.onAccent,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  message: {
    color: _theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  detailsButton: { marginTop: 20, paddingVertical: 12 },
  details: { flexGrow: 0, maxHeight: '60%', marginTop: 8 },
  diagnostic: { color: _theme.colors.textMuted, fontSize: 12, lineHeight: 18, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  stack: {
    color: _theme.colors.linkText,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 12,
  },
})),
  // components/ActivityDescriptionGenerator.tsx
  components_ActivityDescriptionGenerator_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8, marginVertical: 8 }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? _theme.colors.border,
    backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
  }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    backgroundColor: theme ? (theme.mode === 'dark' ? _theme.colors.accentAction : _theme.colors.surfaceMuted) : _theme.colors.surfaceMuted,
    borderColor: theme?.colors.link ?? _theme.colors.border,
  }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text ?? _theme.colors.text, fontWeight: '600' }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text ?? _theme.colors.text }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 0, maxHeight: '100%', flexShrink: 1 }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 420, flexShrink: 1 }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingRight: 12, paddingBottom: 16 }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 220 }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 220 }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 96, textAlignVertical: 'top' }),
  // components/ActivityEditForm.tsx
  components_ActivityEditForm_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between' }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_1: (_theme: AppTheme, { surface }: ThemeStyleValues): any => ({ marginTop: 0, backgroundColor: surface, maxHeight: '100%' }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_2: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_3: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700', marginTop: 6 }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_4: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 2 }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, marginTop: 14 }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.selectedSurface }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.dangerAction }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_9: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 14 }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_10: (_theme: AppTheme, { textColor, borderColor }: ThemeStyleValues): any => ({ color: textColor, borderWidth: 1, borderColor, borderRadius: 8, padding: 10, minHeight: 88, marginTop: 14, textAlignVertical: 'top' }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_11: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12, marginTop: 8 }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_12: (_theme: AppTheme, { textColor, borderColor }: ThemeStyleValues): any => ({ color: textColor, borderWidth: 1, borderColor, borderRadius: 8, padding: 10, marginTop: 6 }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_13: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.mode === 'dark' ? _theme.colors.dangerText : _theme.colors.dangerText, marginTop: 8 }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_16: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.selectedSurface }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_18: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_19: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_21: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/ActivityRecapDialog.tsx
  components_ActivityRecapDialog_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/ActivitySharingControls.tsx
  components_ActivitySharingControls_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8, padding: 12 }),
  // components/ActivitySharingControls.tsx
  components_ActivitySharingControls_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // components/ActivitySharingControls.tsx
  components_ActivitySharingControls_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/ActivitySharingControls.tsx
  components_ActivitySharingControls_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/ActivitySharingControls.tsx
  components_ActivitySharingControls_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 6 }),
  // components/ActivitySharingControls.tsx
  components_ActivitySharingControls_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/AddItemPopover.tsx
  components_AddItemPopover_1: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.surface }),
  // components/AddItemPopover.tsx
  components_AddItemPopover_2: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/AddItemPopover.tsx
  components_AddItemPopover_3: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // components/AddItemPopover.tsx
  components_AddItemPopover_4: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/AddItemPopover.tsx
  components_AddItemPopover_5: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/AddItemPopover.tsx
  components_AddItemPopover_6: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // components/AddItemPopover.tsx
  components_AddItemPopover_7: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/AddItemPopover.tsx
  components_AddItemPopover_8: (_theme: AppTheme, { StyleSheet, Platform }: ThemeStyleValues): any => (StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: _theme.colors.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  menu: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '100%',
    backgroundColor: _theme.colors.surface,
    borderRadius: 12,
    padding: 12,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0px 4px 12px rgba(0,0,0,0.25)' }
      : {
        elevation: 6,
        shadowColor: _theme.colors.scrim,
        shadowOpacity: 0.25,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 12,
      }),
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: _theme.colors.text,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 12,
  },
  optionPressed: {
    backgroundColor: _theme.colors.scrim,
  },
  optionIcon: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  optionImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: _theme.colors.surfaceMuted,
  },
  optionCredit: {
    fontSize: 10,
    color: _theme.colors.textMuted,
    marginTop: 2,
  },
  optionTextWrap: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: _theme.colors.text,
  },
  optionDescription: {
    fontSize: 12,
    color: _theme.colors.text,
    marginTop: 2,
  },
  cancel: {
    marginTop: 6,
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  cancelPressed: {
    backgroundColor: _theme.colors.scrim,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: _theme.colors.text,
  },
})),
  // components/AddToCalendarButton.tsx
  components_AddToCalendarButton_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexShrink: 1 }),
  components_AddToCalendarButton_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingHorizontal: 10, minWidth: 40, alignItems: 'center' }),
  components_AddToCalendarButton_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 16 }),
  // components/admin/aiOps/AiOperationsSection.tsx
  components_admin_aiOps_AiOperationsSection_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOperationsSection.tsx
  components_admin_aiOps_AiOperationsSection_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOperationsSection.tsx
  components_admin_aiOps_AiOperationsSection_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // components/admin/aiOps/AiOperationsSection.tsx
  components_admin_aiOps_AiOperationsSection_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.successActionText }),
  // components/admin/aiOps/AiOpsAiAuditLog.tsx
  components_admin_aiOps_AiOpsAiAuditLog_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsAiAuditLog.tsx
  components_admin_aiOps_AiOpsAiAuditLog_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsCaptures.tsx
  components_admin_aiOps_AiOpsCaptures_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsCaptures.tsx
  components_admin_aiOps_AiOpsCaptures_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/admin/aiOps/AiOpsCaptures.tsx
  components_admin_aiOps_AiOpsCaptures_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/admin/aiOps/AiOpsCaptures.tsx
  components_admin_aiOps_AiOpsCaptures_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // components/admin/aiOps/AiOpsCaptures.tsx
  components_admin_aiOps_AiOpsCaptures_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsCaptures.tsx
  components_admin_aiOps_AiOpsCaptures_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsExecutiveDashboard.tsx
  components_admin_aiOps_AiOpsExecutiveDashboard_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsExecutiveDashboard.tsx
  components_admin_aiOps_AiOpsExecutiveDashboard_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsExecutiveDashboard.tsx
  components_admin_aiOps_AiOpsExecutiveDashboard_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsExecutiveDashboard.tsx
  components_admin_aiOps_AiOpsExecutiveDashboard_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsExperiments.tsx
  components_admin_aiOps_AiOpsExperiments_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsExperiments.tsx
  components_admin_aiOps_AiOpsExperiments_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // components/admin/aiOps/AiOpsExperiments.tsx
  components_admin_aiOps_AiOpsExperiments_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsExperiments.tsx
  components_admin_aiOps_AiOpsExperiments_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsExperiments.tsx
  components_admin_aiOps_AiOpsExperiments_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsExperiments.tsx
  components_admin_aiOps_AiOpsExperiments_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsExperiments.tsx
  components_admin_aiOps_AiOpsExperiments_7: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.successAction }),
  // components/admin/aiOps/AiOpsExperiments.tsx
  components_admin_aiOps_AiOpsExperiments_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.dangerAction }),
  // components/admin/aiOps/AiOpsExperiments.tsx
  components_admin_aiOps_AiOpsExperiments_9: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.dangerAction }),
  // components/admin/aiOps/AiOpsExperiments.tsx
  components_admin_aiOps_AiOpsExperiments_10: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // components/admin/aiOps/AiOpsItineraryInstructions.tsx
  components_admin_aiOps_AiOpsItineraryInstructions_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsItineraryInstructions.tsx
  components_admin_aiOps_AiOpsItineraryInstructions_2: (_theme: AppTheme, { checked, theme }: ThemeStyleValues): any => ({ backgroundColor: checked ? theme.colors.primary : theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }),
  // components/admin/aiOps/AiOpsItineraryInstructions.tsx
  components_admin_aiOps_AiOpsItineraryInstructions_3: (_theme: AppTheme, { checked, theme }: ThemeStyleValues): any => ({ color: checked ? _theme.colors.onAccent : theme.colors.text }),
  // components/admin/aiOps/AiOpsItineraryInstructions.tsx
  components_admin_aiOps_AiOpsItineraryInstructions_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsItineraryInstructions.tsx
  components_admin_aiOps_AiOpsItineraryInstructions_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsItineraryInstructions.tsx
  components_admin_aiOps_AiOpsItineraryInstructions_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // components/admin/aiOps/AiOpsOverview.tsx
  components_admin_aiOps_AiOpsOverview_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsOverview.tsx
  components_admin_aiOps_AiOpsOverview_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsParserQuality.tsx
  components_admin_aiOps_AiOpsParserQuality_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsParserQuality.tsx
  components_admin_aiOps_AiOpsParserQuality_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsParserQuality.tsx
  components_admin_aiOps_AiOpsParserQuality_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 12 }),
  // components/admin/aiOps/AiOpsParserQuality.tsx
  components_admin_aiOps_AiOpsParserQuality_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsParserQuality.tsx
  components_admin_aiOps_AiOpsParserQuality_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.dangerAction }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_7: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_9: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_10: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_11: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_12: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_13: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_14: (_theme: AppTheme, { draft, theme }: ThemeStyleValues): any => ({ backgroundColor: draft.enabled ? theme.colors.successAction : theme.colors.dangerAction }),
  // components/admin/aiOps/AiOpsProviders.tsx
  components_admin_aiOps_AiOpsProviders_15: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // components/admin/aiOps/AiOpsRecommendations.tsx
  components_admin_aiOps_AiOpsRecommendations_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsRecommendations.tsx
  components_admin_aiOps_AiOpsRecommendations_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsRecommendations.tsx
  components_admin_aiOps_AiOpsRecommendations_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsRecommendations.tsx
  components_admin_aiOps_AiOpsRecommendations_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsRecommendations.tsx
  components_admin_aiOps_AiOpsRecommendations_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsRecommendations.tsx
  components_admin_aiOps_AiOpsRecommendations_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.successAction }),
  // components/admin/aiOps/AiOpsRecommendations.tsx
  components_admin_aiOps_AiOpsRecommendations_7: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.dangerAction }),
  // components/admin/aiOps/AiOpsRuntimeSettings.tsx
  components_admin_aiOps_AiOpsRuntimeSettings_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/AiOpsRuntimeSettings.tsx
  components_admin_aiOps_AiOpsRuntimeSettings_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 220, flex: 1 }),
  // components/admin/aiOps/AiOpsRuntimeSettings.tsx
  components_admin_aiOps_AiOpsRuntimeSettings_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsRuntimeSettings.tsx
  components_admin_aiOps_AiOpsRuntimeSettings_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/admin/aiOps/AiOpsRuntimeSettings.tsx
  components_admin_aiOps_AiOpsRuntimeSettings_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/admin/aiOps/AiOpsRuntimeSettings.tsx
  components_admin_aiOps_AiOpsRuntimeSettings_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // components/admin/aiOps/shared.tsx
  components_admin_aiOps_shared_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
}),
  // components/admin/aiOps/shared.tsx
  components_admin_aiOps_shared_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  color: theme.colors.text,
}),
  // components/admin/aiOps/shared.tsx
  components_admin_aiOps_shared_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border }),
  // components/admin/aiOps/shared.tsx
  components_admin_aiOps_shared_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/admin/aiOps/shared.tsx
  components_admin_aiOps_shared_5: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  nav: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  navButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  navButtonActive: { backgroundColor: _theme.colors.accentAction },
  navText: { fontSize: 13, fontWeight: '600' },
  navTextActive: { color: _theme.colors.onAccent },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  cardSub: { fontSize: 13, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  compactRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: _theme.colors.border },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 6 },
  textarea: { minHeight: 220, textAlignVertical: 'top' },
  button: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, alignSelf: 'flex-start', marginTop: 8 },
  buttonText: { color: _theme.colors.onAccent, fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  error: { marginVertical: 8 },
  save: { marginTop: 8, fontWeight: '600' },
  empty: { fontStyle: 'italic' },
})),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_1: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.error }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 12 }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_3: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_4: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_5: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text, marginTop: 0 }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_6: (_theme: AppTheme, { rollout, p, c }: ThemeStyleValues): any => ({ color: rollout[p.key].flagEnabled ? c.text : c.error }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_7: (_theme: AppTheme, { draft, mode, c }: ThemeStyleValues): any => ({ borderColor: draft.mode === mode ? c.primary : c.border, backgroundColor: draft.mode === mode ? c.primary : _theme.colors.transparent }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_8: (_theme: AppTheme, { draft, mode, c }: ThemeStyleValues): any => ({ color: draft.mode === mode ? c.onPrimary : c.text }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_9: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border, color: c.text }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderColor: _theme.colors.transparent, alignItems: 'center' }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_11: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_12: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border, color: c.text }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_13: (_theme: AppTheme, { c, canSave }: ThemeStyleValues): any => ({ borderColor: c.primary, alignSelf: 'flex-start', opacity: canSave ? 1 : 0.5 }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_14: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_15: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_16: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_17: (_theme: AppTheme, { header, c }: ThemeStyleValues): any => ({ color: header ? c.textMuted : c.text }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_18: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_19: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_20: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.error }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_21: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_22: (_theme: AppTheme, { view, v, c }: ThemeStyleValues): any => ({ borderColor: view === v.key ? c.primary : c.border, backgroundColor: view === v.key ? c.primary : _theme.colors.transparent }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_23: (_theme: AppTheme, { view, v, c }: ThemeStyleValues): any => ({ color: view === v.key ? c.onPrimary : c.text }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_24: (_theme: AppTheme, { days, w, c }: ThemeStyleValues): any => ({ borderColor: days === w ? c.primary : c.border }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_25: (_theme: AppTheme, { c, days, w }: ThemeStyleValues): any => ({ color: c.text, fontWeight: days === w ? '700' : '400' }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_26: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_27: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_28: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.error }),
  // components/admin/AnalyticsSection.tsx
  components_admin_AnalyticsSection_29: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  section: { gap: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  heading: { fontSize: 15, fontWeight: '700', marginTop: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  meta: { gap: 2, marginVertical: 4 },
  note: { fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  cell: { flex: 1, fontSize: 13 },
  firstCell: { flex: 1.6 },
  headerCell: { fontWeight: '600', fontSize: 12 },
  card: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
})),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_1: (_theme: AppTheme, { value, option, c }: ThemeStyleValues): any => ({ borderColor: value === option ? c.primary : c.border, backgroundColor: value === option ? c.primary : _theme.colors.transparent }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_2: (_theme: AppTheme, { value, option, c }: ThemeStyleValues): any => ({ color: value === option ? c.onPrimary : c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_3: (_theme: AppTheme, { validDate, c }: ThemeStyleValues): any => ({ borderColor: validDate ? c.border : c.error, color: c.text, backgroundColor: c.surface }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_4: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_5: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_6: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text, marginTop: 0 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_7: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_8: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_9: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_10: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_11: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border, color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_12: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border, color: c.text, minHeight: 48 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_13: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border, color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_14: (_theme: AppTheme, { c, canSave }: ThemeStyleValues): any => ({ borderColor: c.primary, alignSelf: 'flex-start', opacity: canSave ? 1 : 0.5 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_15: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_16: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8, marginTop: 8 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center' }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_19: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text, flex: 1 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_20: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border, color: c.text, minHeight: 48 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_21: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.border, color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_22: (_theme: AppTheme, { c, canSave }: ThemeStyleValues): any => ({ borderColor: c.primary, alignSelf: 'flex-start', opacity: canSave ? 1 : 0.5 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_23: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_24: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.error }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 10 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_26: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.error, color: c.error }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center' }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_28: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ borderColor: c.primary }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_29: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_30: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.error }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_31: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_32: (_theme: AppTheme, { r, c }: ThemeStyleValues): any => ({ borderColor: r.overdue ? c.error : c.border }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_33: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text, marginTop: 0 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_34: (_theme: AppTheme, { r, c }: ThemeStyleValues): any => ({ color: r.overdue ? c.error : c.textMuted }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_35: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_36: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 10 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_37: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_38: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.error }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_39: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_40: (_theme: AppTheme, { job, overdue, c }: ThemeStyleValues): any => ({ borderColor: job.status === 'failed' || overdue ? c.error : c.border }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_41: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text, marginTop: 0 }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_42: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_43: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_44: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.error }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_45: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.error }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_46: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.text }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_47: (_theme: AppTheme, { c }: ThemeStyleValues): any => ({ color: c.textMuted }),
  // components/admin/PrivacyRequestsSection.tsx
  components_admin_PrivacyRequestsSection_48: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  section: { gap: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  heading: { fontSize: 15, fontWeight: '700', marginTop: 12 },
  label: { fontSize: 12, fontWeight: '600' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { fontSize: 12, lineHeight: 18 },
  banner: { borderWidth: 1, borderRadius: 8, padding: 10, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 4 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
})),
  // components/AgeVerificationDialog.tsx
  components_AgeVerificationDialog_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/AgeVerificationDialog.tsx
  components_AgeVerificationDialog_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/AgeVerificationDialog.tsx
  components_AgeVerificationDialog_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/AgeVerificationDialog.tsx
  components_AgeVerificationDialog_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/AppleLogo.tsx
  components_AppleLogo_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/AppleSignInButton.tsx
  components_AppleSignInButton_1: (_theme: AppTheme, { isDark }: ThemeStyleValues): any => ({
        height: 40,
        borderRadius: 4,
        backgroundColor: isDark ? _theme.colors.primary : _theme.colors.surface,
        borderWidth: isDark ? 0 : 1,
        borderColor: _theme.colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        width: '100%',
      }),
  // components/AppleSignInButton.tsx
  components_AppleSignInButton_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 18, height: 18, marginRight: 10 }),
  // components/AppleSignInButton.tsx
  components_AppleSignInButton_3: (_theme: AppTheme, { foreground }: ThemeStyleValues): any => ({
          color: foreground,
          fontSize: 14,
          fontWeight: '500',
        }),
  // components/AppleSignInButton.tsx
  components_AppleSignInButton_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onAccent),
  // components/AppleSignInButton.tsx
  components_AppleSignInButton_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/AssistantActionConfirmDialog.tsx
  components_AssistantActionConfirmDialog_1: (_theme: AppTheme, { theme, Platform }: ThemeStyleValues): any => ({
    modalOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: _theme.colors.scrim,
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 2000,
    },
    confirmModal: {
      backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
      padding: 16,
      borderRadius: 10,
      width: '100%',
      maxWidth: 380,
      ...(Platform.OS === 'web' ? { boxShadow: '0 4px 10px rgba(0,0,0,0.25)' } : null),
      borderWidth: 1,
      borderColor: theme?.colors.border ?? _theme.colors.border,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme?.colors.text ?? _theme.colors.text,
      marginBottom: 8,
    },
    helperText: {
      color: theme?.colors.textMuted ?? _theme.colors.text,
      marginBottom: 8,
      fontSize: 13,
      lineHeight: 18,
    },
    pickerList: {
      maxHeight: 220,
      marginBottom: 8,
    },
    pickerRow: {
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
      marginBottom: 4,
      backgroundColor: theme?.colors.surfaceMuted ?? _theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: _theme.colors.transparent,
    },
    pickerRowSelected: {
      borderColor: _theme.colors.text,
      backgroundColor: theme?.mode === 'dark' ? _theme.colors.accentAction : _theme.colors.surfaceMuted,
    },
    pickerRowTitle: {
      color: theme?.colors.text ?? _theme.colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    pickerRowSubtitle: {
      color: theme?.colors.textMuted ?? _theme.colors.text,
      fontSize: 12,
      marginTop: 2,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 4,
    },
    button: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: theme?.colors.surfaceMuted ?? _theme.colors.surfaceMuted,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: theme?.colors.text ?? _theme.colors.text,
      fontWeight: '600',
      fontSize: 14,
    },
    confirmButton: {
      backgroundColor: _theme.colors.accentAction,
    },
    confirmButtonText: {
      color: _theme.colors.onAccent,
      fontWeight: '700',
      fontSize: 14,
    },
  }),
  // components/AssistantChat.tsx
  components_AssistantChat_1: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  fallback: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: _theme.colors.accentAction,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
})),
  // components/AssistantChatButton.tsx
  components_AssistantChatButton_1: (_theme: AppTheme, { StyleSheet, shadowStyle }: ThemeStyleValues): any => (StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    ...ctaGradientStyle(_theme), // Previously premiumAction
    borderWidth: 1,
    borderColor: _theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    ...shadowStyle(_theme.colors.surfaceMuted, 0.2, 0, 3, 6),
    zIndex: 1000,
  },
  icon: {
    fontSize: 24,
  },
})),
  components_AssistantChatButton_2: (_theme: AppTheme, { floatingInset }: ThemeStyleValues): any => ({ bottom: 24 + floatingInset }),
  components_AssistantChatButton_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onCta),
  // components/AssistantChatPanel.tsx
  components_AssistantChatPanel_1: (_theme: AppTheme, { getResponsivePanelWidth, PANEL_HEIGHT }: ThemeStyleValues): any => ({ width: getResponsivePanelWidth(), height: PANEL_HEIGHT }),
  // components/AssistantChatPanel.tsx
  components_AssistantChatPanel_2: (_theme: AppTheme, { drag, pageY, pageX }: ThemeStyleValues): any => ({
        top: drag.startTop + (pageY - drag.startPageY),
        left: drag.startLeft + (pageX - drag.startPageX),
      }),
  // components/AssistantChatPanel.tsx
  components_AssistantChatPanel_3: (_theme: AppTheme, { pct }: ThemeStyleValues): any => ({ width: `${pct}%` }),
  // components/AssistantChatPanel.tsx
  components_AssistantChatPanel_4: (_theme: AppTheme, { theme, shadowStyle, getResponsivePanelWidth, PANEL_HEIGHT }: ThemeStyleValues): any => ({
  container: {
    backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 8,
    ...shadowStyle(_theme.colors.surfaceMuted, 0.15, 0, 4, 12),
  },
  panelDesktop: {
    // top/left are supplied dynamically (draggable position state) rather
    // than fixed here -- see the `position` style merged in alongside this
    // one where panelStyle is computed.
    position: 'absolute' as any,
    width: getResponsivePanelWidth(),
    height: PANEL_HEIGHT,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? _theme.colors.border,
  },
  panelMobile: {
    position: 'absolute' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: _theme.colors.accentAction,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerTitleDragHandle: {
    flex: 1,
    cursor: 'grab' as any,
    // Without this, dragging the mouse over the "App Guide" text triggers
    // the browser's native text-selection drag, which fights the
    // responder-based drag below and makes it randomly stop tracking
    // mid-gesture -- userSelect: 'none' is inherited by the Text child, so
    // it only needs to be set here, not on headerTitle too.
    userSelect: 'none' as any,
  },
  headerTitleDragging: {
    cursor: 'grabbing' as any,
  },
  headerTitle: {
    color: _theme.colors.onAccent,
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  headerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerBtnText: {
    color: _theme.colors.onAccent,
    fontSize: 15,
    fontWeight: '600',
  },
  stateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  stateTitle: {
    color: theme?.colors.text ?? _theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    color: theme?.colors.textMuted ?? _theme.colors.text,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    color: theme?.colors.error ?? _theme.colors.dangerText,
  },
  inlineError: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  primaryButton: {
    marginTop: 4,
    backgroundColor: _theme.colors.accentAction,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: _theme.colors.onAccent,
    fontWeight: '700',
    fontSize: 14,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: theme?.colors.surfaceMuted ?? _theme.colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: _theme.colors.accentAction,
  },
  messageList: {
    padding: 10,
    paddingBottom: 4,
    flexGrow: 1,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  ownRow: {
    justifyContent: 'flex-end',
  },
  otherRow: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 20,
    justifyContent: 'center',
  },
  ownBubble: {
    backgroundColor: _theme.colors.accentAction,
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: theme?.colors.surfaceMuted ?? _theme.colors.surfaceMuted,
    borderBottomLeftRadius: 4,
  },
  ownText: {
    color: _theme.colors.onAccent,
    fontSize: 14,
  },
  otherText: {
    color: theme?.colors.text ?? _theme.colors.text,
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: theme?.colors.border ?? _theme.colors.border,
    padding: 8,
    backgroundColor: theme?.colors.backgroundAlt ?? _theme.colors.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? _theme.colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 14,
    backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
    color: theme?.colors.text ?? _theme.colors.text,
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: _theme.colors.accentAction,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnDisabled: {
    opacity: 0.6,
  },
  sendBtnText: {
    color: _theme.colors.onAccent,
    fontWeight: '700',
    fontSize: 14,
  },
  footerNote: {
    fontSize: 10,
    color: theme?.colors.textMuted ?? _theme.colors.text,
    textAlign: 'center',
    paddingVertical: 4,
  },
}),
  // components/AssistantChatPanel.tsx
  components_AssistantChatPanel_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.premiumText),
  // components/AssistantChatPanel.tsx
  components_AssistantChatPanel_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/AuthForm.tsx
  components_AuthForm_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // components/AuthForm.tsx
  components_AuthForm_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // components/AuthForm.tsx
  components_AuthForm_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 24, alignItems: 'center', opacity: 0.7 }),
  // components/AuthForm.tsx
  components_AuthForm_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12, textAlign: 'center' }),
  // components/AuthForm.tsx
  components_AuthForm_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 4, marginTop: 4 }),
  // components/AuthForm.tsx
  components_AuthForm_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12, fontWeight: '600' }),
  // components/AuthForm.tsx
  components_AuthForm_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12 }),
  // components/AuthForm.tsx
  components_AuthForm_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12, fontWeight: '600' }),
  // components/AuthForm.tsx
  components_AuthForm_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4 }),
  // components/AuthForm.tsx
  components_AuthForm_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12, fontWeight: '600' }),
  // components/AutoGrowTextInput.tsx
  components_AutoGrowTextInput_1: (_theme: AppTheme, { height, minHeight, maxHeight }: ThemeStyleValues): any => ({ height, minHeight, maxHeight }),
  // components/AutomaticImportSettings.tsx
  components_AutomaticImportSettings_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 12, gap: 8 }),
  // components/AutomaticImportSettings.tsx
  components_AutomaticImportSettings_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, padding: 12 }),
  // components/AutomaticImportSettings.tsx
  components_AutomaticImportSettings_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, padding: 12 }),
  // components/AutomaticImportSettings.tsx
  components_AutomaticImportSettings_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, padding: 12 }),
  // components/AvatarStack.tsx
  components_AvatarStack_1: (_theme: AppTheme, { size }: ThemeStyleValues): any => ({ width: size, height: size, borderRadius: size / 2, justifyContent: 'center' as const, alignItems: 'center' as const, borderWidth: 1.5, borderColor: _theme.colors.border }),
  // components/AvatarStack.tsx
  components_AvatarStack_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center' }),
  // components/AvatarStack.tsx
  components_AvatarStack_3: (_theme: AppTheme, { colorForUser, person, index, overlap }: ThemeStyleValues): any => ({ backgroundColor: colorForUser(person.id), marginLeft: index === 0 ? 0 : -overlap }),
  // components/AvatarStack.tsx
  components_AvatarStack_4: (_theme: AppTheme, { fontSize }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize, fontWeight: '700' }),
  // components/AvatarStack.tsx
  components_AvatarStack_5: (_theme: AppTheme, { overlap }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.surfaceMuted, marginLeft: -overlap }),
  // components/AvatarStack.tsx
  components_AvatarStack_6: (_theme: AppTheme, { fontSize }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize, fontWeight: '700' }),
  // components/BasicTripMap.web.tsx
  components_BasicTripMap_web_1: (_theme: AppTheme, { FONT_STACK, colors }: ThemeStyleValues): any => ({ flex: 2, minWidth: 0, fontFamily: FONT_STACK, fontSize: 14, color: colors.text }),
  // components/BasicTripMap.web.tsx
  components_BasicTripMap_web_2: (_theme: AppTheme, { HEIGHT, colors }: ThemeStyleValues): any => ({ position: 'relative', width: '100%', height: HEIGHT, overflow: 'hidden', borderRadius: 12, background: colors.surfaceMuted }),
  // components/BasicTripMap.web.tsx
  components_BasicTripMap_web_3: (_theme: AppTheme, { tile }: ThemeStyleValues): any => ({ position: 'absolute', left: tile.left, top: tile.top, width: 256, height: 256, userSelect: 'none' }),
  // components/BasicTripMap.web.tsx
  components_BasicTripMap_web_4: (_theme: AppTheme, { spot, isSelected, COLORS, point }: ThemeStyleValues): any => ({ position: 'absolute', left: spot.x, top: spot.y, transform: 'translate(-50%, -50%)', zIndex: isSelected ? 2 : 1, width: isSelected ? 44 : 34, height: isSelected ? 44 : 34, borderRadius: '50%', cursor: 'pointer', fontWeight: 'bold', color: _theme.colors.onAccent, background: COLORS[point.kind], border: `${isSelected ? 3 : 2}px solid white`, boxShadow: '0 1px 4px rgba(0,0,0,.5)', padding: 0 }),
  // components/BasicTripMap.web.tsx
  components_BasicTripMap_web_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', right: 0, bottom: 0, zIndex: 3, padding: '2px 6px', fontSize: 11, background: _theme.colors.surface, color: _theme.colors.text }),
  // components/BasicTripMap.web.tsx
  components_BasicTripMap_web_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ margin: '8px 0 0' }),
  // components/BasicTripMap.web.tsx
  components_BasicTripMap_web_7: (_theme: AppTheme, { linkTextColor, theme }: ThemeStyleValues): any => ({ color: linkTextColor(theme) }),
  // components/BasicTripMap.web.tsx
  components_BasicTripMap_web_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flight: _theme.colors.accentSurface, lodging: _theme.colors.dangerAction, activity: _theme.colors.successAction, car_rental: _theme.colors.premiumAction }),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 6 }),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_2: (_theme: AppTheme, { borderColor, textColor, backgroundColor }: ThemeStyleValues): any => ({
          borderWidth: 1, borderColor, borderRadius: 8, padding: 8, fontSize: 14, lineHeight: 20,
          color: textColor, backgroundColor,
        }),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_4: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ fontSize: 11, fontWeight: '600', color: mutedColor }),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8 }),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_6: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontWeight: '600', paddingVertical: 6, paddingHorizontal: 4 }),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_7: (_theme: AppTheme, { canSubmit }: ThemeStyleValues): any => ({ opacity: canSubmit ? 1 : 0.5, paddingVertical: 6, paddingHorizontal: 12 }),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.border),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/BlogCommentComposer.tsx
  components_BlogCommentComposer_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onCta),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_1: (_theme: AppTheme, { isReply, borderColor }: ThemeStyleValues): any => ({ marginLeft: isReply ? 20 : 0, borderLeftWidth: isReply ? 2 : 0, borderLeftColor: borderColor, paddingLeft: isReply ? 8 : 0, marginTop: isReply ? 8 : 12 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_3: (_theme: AppTheme, { comment, colorForUser, mutedColor, isFollower, theme }: ThemeStyleValues): any => ({
            width: 22, height: 22, borderRadius: 11,
            // Same colored initials as the day's contributor strip, so a commenter is recognizable.
            backgroundColor: comment.authorUserId ? colorForUser(comment.authorUserId) : mutedColor,
            justifyContent: 'center', alignItems: 'center',
            borderWidth: isFollower ? 2 : 0, borderColor: isFollower ? (theme?.colors?.info ?? _theme.colors.accentBorder) : _theme.colors.transparent,
            marginTop: 2,
          }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 9, fontWeight: '700' }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_7: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700' }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_9: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ fontSize: 10, fontWeight: '700', color: theme?.colors?.info ?? _theme.colors.linkText }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_10: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ fontSize: 10, fontWeight: '600', color: mutedColor }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_11: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ fontSize: 10, fontWeight: '700', color: theme?.colors?.error ?? _theme.colors.dangerText }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_13: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontWeight: '700' }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_15: (_theme: AppTheme, { isTombstone, mutedColor, textColor }: ThemeStyleValues): any => ({ color: isTombstone ? mutedColor : textColor, fontStyle: isTombstone ? 'italic' : 'normal', marginTop: 2 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_17: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 11 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_18: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontWeight: '700', fontSize: 11 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_20: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontWeight: '600', fontSize: 12 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_21: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors?.error ?? _theme.colors.dangerText, fontWeight: '600', fontSize: 12 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_22: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontWeight: '600', fontSize: 12 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_23: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors?.error ?? _theme.colors.dangerText, fontWeight: '600', fontSize: 12 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_24: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontWeight: '600', fontSize: 12 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_25: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_26: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_27: (_theme: AppTheme, { borderColor }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_28: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 11 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_29: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 6 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_30: (_theme: AppTheme, { currentUserId, canModerate, canEngage, onEdit, onDelete, onReport, onHide, onUnhide, onError, textColor, mutedColor, borderColor, backgroundColor, styles, theme }: ThemeStyleValues): any => ({ currentUserId, canModerate, canEngage, onEdit, onDelete, onReport, onHide, onUnhide, onError, textColor, mutedColor, borderColor, backgroundColor, styles, theme }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_31: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 20, marginTop: 2 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_32: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontWeight: '600', fontSize: 12 }),
  // components/BlogCommentThread.tsx
  components_BlogCommentThread_33: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_1: (_theme: AppTheme, { borderColor, backgroundColor }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor, backgroundColor, borderRadius: 8, padding: 10, marginTop: 6, marginBottom: 6 }),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_2: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700', marginBottom: 4 }),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_3: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginBottom: 8, fontSize: 12 }),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 6, paddingHorizontal: 10 }),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_7: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_9: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.dangerAction),
  // components/BlogConflictBanner.tsx
  components_BlogConflictBanner_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/BlogContributorStrip.tsx
  components_BlogContributorStrip_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 2 }),
  // components/BlogContributorStrip.tsx
  components_BlogContributorStrip_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', marginRight: 8 }),
  // components/BlogContributorStrip.tsx
  components_BlogContributorStrip_3: (_theme: AppTheme, { AVATAR_SIZE, colorForUser, contributor, index, OVERLAP }: ThemeStyleValues): any => ({
              width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
              justifyContent: 'center', alignItems: 'center',
              backgroundColor: colorForUser(contributor.userId),
              marginLeft: index === 0 ? 0 : -OVERLAP,
              borderWidth: 1.5, borderColor: _theme.colors.border,
            }),
  // components/BlogContributorStrip.tsx
  components_BlogContributorStrip_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 9, fontWeight: '700' }),
  // components/BlogContributorStrip.tsx
  components_BlogContributorStrip_5: (_theme: AppTheme, { AVATAR_SIZE, OVERLAP }: ThemeStyleValues): any => ({ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, justifyContent: 'center', alignItems: 'center', backgroundColor: _theme.colors.surfaceMuted, marginLeft: -OVERLAP, borderWidth: 1.5, borderColor: _theme.colors.border }),
  // components/BlogContributorStrip.tsx
  components_BlogContributorStrip_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 9, fontWeight: '700' }),
  // components/BlogContributorStrip.tsx
  components_BlogContributorStrip_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexShrink: 1 }),
  // components/BlogContributorStrip.tsx
  components_BlogContributorStrip_8: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12 }),
  // components/BlogContributorStrip.tsx
  components_BlogContributorStrip_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.text, fontSize: 11, fontWeight: '700' }),
  // components/BlogContributorStrip.tsx
  components_BlogContributorStrip_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_1: (_theme: AppTheme, { borderColor, backgroundColor }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor, borderRadius: 12, backgroundColor, padding: 14, marginBottom: 12 }),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_3: (_theme: AppTheme, { displayFont, accentColor }: ThemeStyleValues): any => ({ fontFamily: displayFont, color: accentColor, fontSize: 14, fontWeight: '600' }),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 32, minWidth: 32, alignItems: 'center', justifyContent: 'center' }),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_5: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 16 }),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_6: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 15, lineHeight: 22, marginBottom: 12 }),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 8 }),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_9: (_theme: AppTheme, { borderColor }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.transparent, borderWidth: 1, borderColor }),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_10: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.border),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.linkText),
  // components/BlogDayStarterCard.tsx
  components_BlogDayStarterCard_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onCta),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_1: (_theme: AppTheme, { borderColor, backgroundColor }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor, borderRadius: 10, padding: 12, marginBottom: 16, backgroundColor }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_2: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '800', fontSize: 16 }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 10 }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8 }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_5: (_theme: AppTheme, { borderColor, textColor }: ThemeStyleValues): any => ({ flex: 1, minHeight: 44, borderWidth: 1, borderColor, borderRadius: 8, paddingHorizontal: 10, color: textColor }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_6: (_theme: AppTheme, { accentColor }: ThemeStyleValues): any => ({ minHeight: 44, minWidth: 70, borderRadius: 8, backgroundColor: accentColor, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontWeight: '700' }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_8: (_theme: AppTheme, { borderColor }: ThemeStyleValues): any => ({ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: borderColor }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_9: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700' }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_10: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_12: (_theme: AppTheme, { accentColor }: ThemeStyleValues): any => ({ color: accentColor, fontWeight: '700' }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_15: (_theme: AppTheme, { accentColor }: ThemeStyleValues): any => ({ color: accentColor, fontWeight: '700' }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_16: (_theme: AppTheme, { borderColor }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center', borderTopWidth: 1, borderTopColor: borderColor }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_17: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700' }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_18: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12 }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_19: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 8 }),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_21: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.border),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.accentAction),
  // components/BlogDiscoveryPanel.tsx
  components_BlogDiscoveryPanel_26: (_theme: AppTheme, { borderColor }: ThemeStyleValues): any => ({ minHeight: 44, minWidth: 64, borderRadius: 8, borderWidth: 1, borderColor, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }),
  components_BlogDiscoveryPanel_27: (_theme: AppTheme, { accentColor }: ThemeStyleValues): any => ({ minHeight: 44, minWidth: 64, borderRadius: 8, borderWidth: 1, borderColor: accentColor, backgroundColor: accentColor, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }),
  components_BlogDiscoveryPanel_28: (_theme: AppTheme, { borderColor, textColor }: ThemeStyleValues): any => ({ minHeight: 88, borderWidth: 1, borderColor, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: textColor, textAlignVertical: 'top' }),
  components_BlogDiscoveryPanel_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onAccent),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_2: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700' }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, backgroundColor: _theme.colors.overlay, justifyContent: 'center', padding: 20 }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.surface, borderRadius: 16, padding: 20, maxWidth: 440, width: '100%', alignSelf: 'center', maxHeight: '100%' }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 20, fontWeight: '700', color: _theme.colors.text, marginBottom: 4 }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 14, color: _theme.colors.text, marginBottom: 14 }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_7: (_theme: AppTheme, { selected, theme }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, borderWidth: 2, borderColor: selected ? theme.accent : _theme.colors.border, marginBottom: 8 }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ width: 48, height: 40, borderRadius: 8, backgroundColor: theme.page, borderWidth: 1, borderColor: _theme.colors.border, padding: 6, justifyContent: 'center' }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_9: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ height: 22, borderRadius: 4, backgroundColor: theme.card, borderTopWidth: 3, borderTopColor: theme.accent }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700', color: _theme.colors.text }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12, color: _theme.colors.text }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_13: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.accent === _theme.colors.dangerText ? _theme.colors.dangerText : theme.accent, fontWeight: '800' }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 10, paddingHorizontal: 14 }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.text, fontWeight: '600' }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: _theme.colors.cta }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onCta, fontWeight: '700' }),
  // components/BlogKeepsakeButton.tsx
  components_BlogKeepsakeButton_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/BottomTabBar.tsx
  components_BottomTabBar_1: (_theme: AppTheme, { StyleSheet, BOTTOM_TAB_BAR_HEIGHT }: ThemeStyleValues): any => (StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      width: '100%',
      minHeight: BOTTOM_TAB_BAR_HEIGHT,
      paddingTop: 6,
      paddingHorizontal: 8,
      borderTopWidth: 1,
      backgroundColor: _theme.mode === 'dark' ? '#0A0A0A' : _theme.colors.surface,
      borderTopColor: _theme.colors.border,
    },
    tab: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 3,
    },
    iconPill: {
      width: 52,
      height: 30,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      fontSize: 11,
    },
    addLabel: {
      fontSize: 11,
      color: _theme.colors.text,
      fontWeight: '600',
    },
    addButton: {
      width: 56,
      height: 56,
      marginTop: -26,
      borderRadius: 28,
      borderWidth: 3,
      alignItems: 'center',
      justifyContent: 'center',
      borderColor: _theme.mode === 'dark' ? '#0A0A0A' : _theme.colors.surface,
      ...ctaGradientStyle(_theme),
    },
    scrim: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: _theme.colors.scrim,
    },
    sheet: {
      position: 'absolute',
      left: 8,
      right: 8,
      borderRadius: 26,
      borderWidth: 1,
      paddingTop: 10,
      paddingHorizontal: 18,
      paddingBottom: 20,
      gap: 4,
      backgroundColor: _theme.colors.surface,
      borderColor: _theme.colors.border,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 999,
      marginBottom: 8,
      backgroundColor: _theme.colors.border,
    },
    sheetTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: _theme.colors.text,
    },
    sheetSubtitle: {
      fontSize: 14,
      marginBottom: 10,
      color: _theme.colors.textMuted,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    option: {
      flexBasis: '30%',
      flexGrow: 1,
      alignItems: 'center',
      gap: 8,
      paddingVertical: 16,
      paddingHorizontal: 6,
      borderRadius: 16,
      borderWidth: 1,
      backgroundColor: _theme.colors.surfaceMuted,
      borderColor: _theme.colors.border,
    },
    optionLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: _theme.colors.text,
    },
    cancel: {
      marginTop: 12,
      minHeight: 44,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderColor: _theme.colors.border,
    },
    cancelText: {
      fontSize: 15,
      fontWeight: '600',
      color: _theme.colors.text,
    },
  })),
  components_BottomTabBar_2: (_theme: AppTheme, { bottomInset }: ThemeStyleValues): any => ({ paddingBottom: 6 + bottomInset }),
  components_BottomTabBar_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.mode === 'dark' ? '#262626' : '#EFEFEF' }),
  components_BottomTabBar_4: (_theme: AppTheme, { active }: ThemeStyleValues): any => ({ color: active ? _theme.colors.text : _theme.colors.textMuted, fontWeight: active ? '700' : '500' }),
  components_BottomTabBar_5: (_theme: AppTheme, { active }: ThemeStyleValues): any => (active ? _theme.colors.text : _theme.colors.textMuted),
  components_BottomTabBar_6: (_theme: AppTheme, { bottomInset }: ThemeStyleValues): any => ({ bottom: bottomInset + 12 }),
  components_BottomTabBar_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onCta),
  components_BottomTabBar_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_1: (_theme: AppTheme, { borderColor, backgroundColor }: ThemeStyleValues): any => ({ marginTop: 10, borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_2: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700' }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_3: (_theme: AppTheme, { textColor, borderColor }: ThemeStyleValues): any => ({ color: textColor, borderWidth: 1, borderColor, borderRadius: 6, padding: 8, marginTop: 8, lineHeight: 20 }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_4: (_theme: AppTheme, { textColor, borderColor }: ThemeStyleValues): any => ({ color: textColor, borderWidth: 1, borderColor, borderRadius: 6, padding: 8, marginTop: 8 }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_5: (_theme: AppTheme, { textColor, isDecorative, borderColor }: ThemeStyleValues): any => ({ color: textColor, opacity: isDecorative ? 0.55 : 1, borderWidth: 1, borderColor, borderRadius: 6, padding: 8, marginTop: 8, lineHeight: 20 }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', marginTop: 8 }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_7: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, marginRight: 6 }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_8: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.5 }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_11: (_theme: AppTheme, { accentColor }: ThemeStyleValues): any => ({ backgroundColor: accentColor }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_12: (_theme: AppTheme, { recordingState, accentColor }: ThemeStyleValues): any => ({ backgroundColor: recordingState === 'recording' ? _theme.colors.dangerAction : accentColor }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_13: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12, marginTop: 6 }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_14: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12, marginTop: 6 }),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.border),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/BlogMediaMetadataEditor.tsx
  components_BlogMediaMetadataEditor_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.premiumAction),
  // components/BlogMediaPreview.tsx
  components_BlogMediaPreview_1: (_theme: AppTheme, { isTile, tileHeight, backgroundColor }: ThemeStyleValues): any => ({
          display: 'block',
          width: '100%',
          height: isTile ? tileHeight : 'auto',
          maxWidth: '100%',
          borderRadius: 8,
          backgroundColor,
          objectFit: isTile ? 'cover' : undefined,
        }),
  // components/BlogMediaPreview.tsx
  components_BlogMediaPreview_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%' }),
  // components/BlogMediaPreview.tsx
  components_BlogMediaPreview_3: (_theme: AppTheme, { backgroundColor }: ThemeStyleValues): any => ({ padding: 12, borderRadius: 8, backgroundColor }),
  // components/BlogMediaPreview.tsx
  components_BlogMediaPreview_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/BlogMediaPreview.tsx
  components_BlogMediaPreview_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // components/BlogMediaPreview.tsx
  components_BlogMediaPreview_6: (_theme: AppTheme, { tileHeight, backgroundColor }: ThemeStyleValues): any => ({
        width: '100%',
        height: tileHeight,
        borderRadius: 8,
        backgroundColor,
      }),
  // components/BlogMediaPreview.tsx
  components_BlogMediaPreview_7: (_theme: AppTheme, { aspectRatio, backgroundColor }: ThemeStyleValues): any => ({
        width: '100%',
        ...(aspectRatio ? { aspectRatio } : { height: 200 }),
        borderRadius: 8,
        backgroundColor,
      }),
  // components/BlogPublicDefaultToggle.tsx
  components_BlogPublicDefaultToggle_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // components/BlogPublicDefaultToggle.tsx
  components_BlogPublicDefaultToggle_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center', justifyContent: 'space-between', gap: 12 }),
  // components/BlogPublicDefaultToggle.tsx
  components_BlogPublicDefaultToggle_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/BlogPublicDefaultToggle.tsx
  components_BlogPublicDefaultToggle_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // components/BlogPublicDefaultToggle.tsx
  components_BlogPublicDefaultToggle_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.primary),
  // components/BlogPublicDefaultToggle.tsx
  components_BlogPublicDefaultToggle_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/BlogPublicDefaultToggle.tsx
  components_BlogPublicDefaultToggle_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_1: (_theme: AppTheme, { compact, active, activeChipBg, theme }: ThemeStyleValues): any => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    paddingHorizontal: compact ? 5 : 7,
    paddingVertical: compact ? 3 : 4,
    borderRadius: 999,
    minHeight: compact ? 28 : 32,
    backgroundColor: active ? activeChipBg : _theme.colors.transparent,
    borderWidth: 1,
    borderColor: active ? (theme?.colors?.border ?? _theme.colors.border) : _theme.colors.transparent,
  }),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_3: (_theme: AppTheme, { compact }: ThemeStyleValues): any => ({ fontSize: compact ? 13 : 15 }),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_4: (_theme: AppTheme, { summary, emoji, textColor, mutedColor }: ThemeStyleValues): any => ({ fontSize: 12, fontWeight: '600', color: summary.userReaction === emoji ? textColor : mutedColor }),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_5: (_theme: AppTheme, { compact }: ThemeStyleValues): any => ({ minWidth: compact ? 28 : 32, justifyContent: 'center' }),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_6: (_theme: AppTheme, { compact, mutedColor }: ThemeStyleValues): any => ({ fontSize: compact ? 13 : 15, color: mutedColor }),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 4, width: '100%', marginTop: 2 }),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 16 }),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/BlogReactionBar.tsx
  components_BlogReactionBar_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/BlogRichTextEditor.tsx
  components_BlogRichTextEditor_1: (_theme: AppTheme, { backgroundColor }: ThemeStyleValues): any => ({ backgroundColor }),
  // components/BlogRichTextEditor.tsx
  components_BlogRichTextEditor_2: (_theme: AppTheme, { backgroundColor, borderColor }: ThemeStyleValues): any => ({ backgroundColor, borderTopColor: borderColor, borderBottomColor: borderColor }),
  // components/BlogRichTextEditor.tsx
  components_BlogRichTextEditor_3: (_theme: AppTheme, { editable, borderColor, backgroundColor, minHeight }: ThemeStyleValues): any => ({
        borderWidth: editable ? 1 : 0,
        borderColor,
        borderRadius: 8,
        backgroundColor,
        minHeight: editable ? minHeight : undefined,
        overflow: 'hidden',
      }),
  // components/BlogRichTextEditor.tsx
  components_BlogRichTextEditor_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.border),
  // components/BlogRichTextEditor.tsx
  components_BlogRichTextEditor_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/BlogRichTextEditor.tsx
  components_BlogRichTextEditor_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' as const }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontStyle: 'italic' as const }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ textDecorationLine: 'underline line-through' as const }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ textDecorationLine: 'underline' as const }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ textDecorationLine: 'line-through' as const }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontFamily: 'monospace' }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_7: (_theme: AppTheme, { linkColor }: ThemeStyleValues): any => ({ color: linkColor }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_8: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 16, lineHeight: 24 }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_9: (_theme: AppTheme, { last }: ThemeStyleValues): any => ({ flexDirection: 'row', marginBottom: last ? 0 : 4, paddingLeft: 4 }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_10: (_theme: AppTheme, { base }: ThemeStyleValues): any => ({ ...base, width: 22 }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_11: (_theme: AppTheme, { base }: ThemeStyleValues): any => ({ ...base, flex: 1 }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_12: (_theme: AppTheme, { base, size, spacing }: ThemeStyleValues): any => ({ ...base, fontSize: size, lineHeight: Math.round(size * 1.3), fontWeight: '700', marginBottom: spacing }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_13: (_theme: AppTheme, { linkColor, spacing }: ThemeStyleValues): any => ({ borderLeftWidth: 3, borderLeftColor: linkColor, paddingLeft: 10, marginBottom: spacing }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_14: (_theme: AppTheme, { base }: ThemeStyleValues): any => ({ ...base, fontStyle: 'italic' }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_15: (_theme: AppTheme, { base, spacing }: ThemeStyleValues): any => ({ ...base, marginBottom: spacing }),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/BlogRichTextView.tsx
  components_BlogRichTextView_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.linkText),
  // components/CarRentalEditForm.tsx
  components_CarRentalEditForm_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? _theme.colors.border,
    backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
  }),
  // components/CarRentalEditForm.tsx
  components_CarRentalEditForm_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    backgroundColor: theme ? (theme.mode === 'dark' ? _theme.colors.accentAction : _theme.colors.surfaceMuted) : _theme.colors.surfaceMuted,
    borderColor: theme?.colors.link ?? _theme.colors.border,
  }),
  // components/CarRentalEditForm.tsx
  components_CarRentalEditForm_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text ?? _theme.colors.text, fontWeight: '600' }),
  // components/CarRentalEditForm.tsx
  components_CarRentalEditForm_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text ?? _theme.colors.text }),
  // components/CarRentalEditForm.tsx
  components_CarRentalEditForm_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 0, maxHeight: '100%', flexShrink: 1 }),
  // components/CarRentalEditForm.tsx
  components_CarRentalEditForm_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 420, flexShrink: 1 }),
  // components/CarRentalEditForm.tsx
  components_CarRentalEditForm_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingRight: 12, paddingBottom: 16 }),
  // components/CarRentalEditForm.tsx
  components_CarRentalEditForm_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }),
  // components/CarRentalEditForm.tsx
  components_CarRentalEditForm_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 96, textAlignVertical: 'top' }),
  // components/CarRentalEditForm.tsx
  components_CarRentalEditForm_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between' }),
  // components/CarRentalsPanel.tsx
  components_CarRentalsPanel_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, alignItems: 'center' }),
  // components/CarRentalsPanel.tsx
  components_CarRentalsPanel_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }),
  // components/CarRentalsPanel.tsx
  components_CarRentalsPanel_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }),
  // components/CarRentalsPanel.tsx
  components_CarRentalsPanel_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', left: 0, zIndex: 4, backgroundColor: theme?.colors.surface }),
  // components/CarRentalsPanel.tsx
  components_CarRentalsPanel_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', right: 0, zIndex: 4, backgroundColor: theme?.colors.surface }),
  // components/CarRentalsPanel.tsx
  components_CarRentalsPanel_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', left: 0, zIndex: 3, backgroundColor: theme?.colors.surface }),
  // components/CarRentalsPanel.tsx
  components_CarRentalsPanel_7: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', right: 0, zIndex: 3, backgroundColor: theme?.colors.surface }),
  // components/ChatButton.tsx
  components_ChatButton_1: (_theme: AppTheme, { StyleSheet, shadowStyle }: ThemeStyleValues): any => (StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    ...ctaGradientStyle(_theme), // Previously accentSurface
    borderWidth: 1,
    borderColor: _theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    ...shadowStyle(_theme.colors.surfaceMuted, 0.2, 0, 3, 6),
    zIndex: 1000,
  },
  icon: {
    fontSize: 24,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: _theme.colors.dangerAction,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: _theme.colors.border,
  },
  badgeText: {
    color: _theme.colors.onAccent,
    fontSize: 10,
    fontWeight: '700',
  },
})),
  components_ChatButton_2: (_theme: AppTheme, { floatingInset }: ThemeStyleValues): any => ({ bottom: 24 + floatingInset }),
  components_ChatButton_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onCta),
  // components/ChatPanel.tsx
  components_ChatPanel_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors.textMuted ?? _theme.colors.surfaceMuted }),
  // components/ChatPanel.tsx
  components_ChatPanel_2: (_theme: AppTheme, { isWeb, safeAreaInsets }: ThemeStyleValues): any => ({
        // Absolute positioning ignores the parent SafeAreaView's padding.
        top: (isWeb ? 'env(safe-area-inset-top, 0px)' : safeAreaInsets.top) as any,
        bottom: (isWeb ? 'env(safe-area-inset-bottom, 0px)' : safeAreaInsets.bottom) as any,
      }),
  // components/ChatPanel.tsx
  components_ChatPanel_3: (_theme: AppTheme, { theme, shadowStyle, getResponsivePanelWidth, PANEL_HEIGHT }: ThemeStyleValues): any => ({
  container: {
    backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 8,
    ...shadowStyle(_theme.colors.surfaceMuted, 0.15, 0, 4, 12),
  },
  panelDesktop: {
    position: 'absolute' as any,
    bottom: 80,
    right: 16,
    width: getResponsivePanelWidth(),
    height: PANEL_HEIGHT,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? _theme.colors.border,
  },
  panelMobile: {
    position: 'absolute' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: _theme.colors.accentAction, // Previously accentSurface
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerTitle: {
    flex: 1,
    color: _theme.colors.onAccent,
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  headerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBtnText: {
    color: _theme.colors.onAccent,
    fontSize: 15,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  stateTitle: {
    color: theme?.colors.text ?? _theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    color: theme?.colors.textMuted ?? _theme.colors.text,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  messageList: {
    padding: 10,
    paddingBottom: 4,
    flexGrow: 1,
  },
  loadOlderBtn: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: theme?.colors.surfaceMuted ?? _theme.colors.surfaceMuted,
  },
  loadOlderText: {
    color: theme?.colors.textMuted ?? _theme.colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  unreadSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
    gap: 8,
  },
  unreadSeparatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme?.colors.error ?? _theme.colors.dangerAction,
    opacity: 0.4,
  },
  unreadSeparatorLabel: {
    color: theme?.colors.error ?? _theme.colors.dangerText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  ownRow: {
    justifyContent: 'flex-end',
  },
  otherRow: {
    justifyContent: 'flex-start',
  },
  avatarSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    marginBottom: 4,
  },
  avatarText: {
    color: _theme.colors.onAccent,
    fontSize: 9,
    fontWeight: '700',
  },
  bubble: {
    maxWidth: '75%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ownBubble: {
    backgroundColor: _theme.colors.accentAction, // Previously accentSurface
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: theme?.colors.surfaceMuted ?? _theme.colors.surfaceMuted,
    borderBottomLeftRadius: 4,
  },
  senderName: {
    fontSize: 11,
    fontWeight: '700',
    color: theme?.colors.textMuted ?? _theme.colors.text,
    marginBottom: 2,
  },
  ownText: {
    color: _theme.colors.onAccent,
    fontSize: 14,
  },
  otherText: {
    color: theme?.colors.text ?? _theme.colors.text,
    fontSize: 14,
  },
  timestamp: {
    fontSize: 10,
    color: _theme.colors.onAccent,
    marginTop: 3,
    textAlign: 'right',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: theme?.colors.border ?? _theme.colors.border,
    padding: 8,
    backgroundColor: theme?.colors.backgroundAlt ?? _theme.colors.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? _theme.colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 14,
    backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
    color: theme?.colors.text ?? _theme.colors.text,
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: _theme.colors.accentAction, // Previously accentSurface
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnDisabled: {
    opacity: 0.6,
  },
  sendBtnText: {
    color: _theme.colors.onAccent,
    fontWeight: '700',
    fontSize: 14,
  },
}),
  // components/ChatPanel.tsx
  components_ChatPanel_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_1: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.surface }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_2: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_3: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_4: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_6: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_8: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ top: 8, bottom: 8, left: 8, right: 8 }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_11: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_12: (_theme: AppTheme, { theme, colors }: ThemeStyleValues): any => ({ color: theme?.mode === 'dark' ? colors.link : colors.primary }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_14: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/ChecklistInputDialog.tsx
  components_ChecklistInputDialog_15: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  overlay: { flex: 1, backgroundColor: _theme.colors.scrim, justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 460, backgroundColor: _theme.colors.surface, borderRadius: 12, padding: 16, gap: 8, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: '700', color: _theme.colors.text, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: _theme.colors.text, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: _theme.colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: _theme.colors.text, backgroundColor: _theme.colors.surface,
  },
  itemsScroll: { maxHeight: 220 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  removeBtn: {
    width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center',
    backgroundColor: _theme.colors.overlay, borderWidth: 1, borderColor: _theme.colors.overlay,
  },
  removeBtnText: { fontSize: 18, fontWeight: '700', color: _theme.colors.dangerText, lineHeight: 18 },
  addBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 6, alignSelf: 'flex-start' },
  addBtnPressed: { backgroundColor: _theme.colors.scrim },
  addBtnText: { color: _theme.colors.linkText, fontWeight: '600' },
  error: { color: _theme.colors.dangerText, fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  btnGhost: { paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 6 },
  btnGhostText: { color: _theme.colors.text, fontWeight: '600' },
  btnPrimary: { backgroundColor: _theme.colors.accentAction, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 6 },
  btnPrimaryText: { color: _theme.colors.onAccent, fontWeight: '700' },
})),
  // components/ConfirmDialog.tsx
  components_ConfirmDialog_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText, marginBottom: 8 }),
  // components/ConfirmDialog.tsx
  components_ConfirmDialog_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/ConfirmDialog.tsx
  components_ConfirmDialog_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // components/ConfirmDialog.tsx
  components_ConfirmDialog_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/ConfirmDialog.tsx
  components_ConfirmDialog_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // components/CostReportExpenses.tsx
  components_CostReportExpenses_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 18 }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, alignItems: 'center' }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_2: (_theme: AppTheme, { Platform, colors }: ThemeStyleValues): any => ({ flex: 1, padding: 16, paddingTop: Platform.OS === 'web' ? 16 : 48, backgroundColor: colors.surface }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_3: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ fontSize: 22, fontWeight: '700', marginBottom: 8, color: colors.text }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_4: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ marginBottom: 12, color: colors.textMuted }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_6: (_theme: AppTheme, { colors, excluded, row }: ThemeStyleValues): any => ({ padding: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: excluded.has(row.sourceRow) ? colors.surfaceMuted : colors.surface }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_7: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ fontWeight: '600', color: colors.text }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_8: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_9: (_theme: AppTheme, { theme, colors }: ThemeStyleValues): any => ({ color: theme?.mode === 'dark' ? colors.link : colors.primary, marginTop: 6 }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 10, paddingTop: 12 }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_12: (_theme: AppTheme, { styles, colors }: ThemeStyleValues): any => ({ color: styles.outlineButton ? colors.text : _theme.colors.onCta }),
  // components/CsvTransferControls.tsx
  components_CsvTransferControls_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/DateField.tsx
  components_DateField_1: (_theme: AppTheme, { flattenStyle, styles, style }: ThemeStyleValues): any => ({
      ...flattenStyle(styles.input),
      width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box',
      ...flattenStyle(style),
    }),
  // components/DateField.tsx
  components_DateField_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'center' }),
  // components/DateField.tsx
  components_DateField_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.textMuted }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, minWidth: 44, alignItems: 'center' as const, justifyContent: 'center' as const }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8, marginBottom: 8 }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.5 }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 6, marginBottom: 10 }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8 }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 8, gap: 4 }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_9: (_theme: AppTheme, { y, height }: ThemeStyleValues): any => ({ y, height }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 4 }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.3 }),
  // components/DayActivitiesOrdering.tsx
  components_DayActivitiesOrdering_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.3 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4, pointerEvents: 'box-none' }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.surface, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 3 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.text, fontSize: 11, fontWeight: '700' }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.overlay, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 7 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 13 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.overlay, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 7 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 13 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.overlay, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 7 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 13 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'relative', overflow: 'hidden', borderRadius: 8 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', inset: 0, backgroundColor: _theme.colors.overlay, alignItems: 'center', justifyContent: 'center' }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 20, fontWeight: '700' }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', bottom: 6, left: 6, backgroundColor: _theme.colors.overlay, borderRadius: 12, paddingVertical: 2, paddingHorizontal: 8 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 11, fontWeight: '700' }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_16: (_theme: AppTheme, { GAP }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: GAP }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_19: (_theme: AppTheme, { GAP, MOSAIC_HEIGHT }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: GAP, height: MOSAIC_HEIGHT }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1.6 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_21: (_theme: AppTheme, { GAP }: ThemeStyleValues): any => ({ flex: 1, gap: GAP }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4, gap: 2 }),
  // components/DayMediaGallery.tsx
  components_DayMediaGallery_25: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxWidth: 720, width: '92%', maxHeight: '85%' }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_2: (_theme: AppTheme, { wideLayout }: ThemeStyleValues): any => ({ flexDirection: wideLayout ? 'row' : 'column', gap: 12 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_3: (_theme: AppTheme, { wideLayout }: ThemeStyleValues): any => ({ flex: wideLayout ? 3 : undefined }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_5: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700' }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.overlay, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontWeight: '600', fontSize: 12 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_8: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 6 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 6 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_10: (_theme: AppTheme, { wideLayout, borderColor }: ThemeStyleValues): any => ({ flex: wideLayout ? 2 : undefined, borderColor, paddingTop: wideLayout ? 0 : 10 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderLeftWidth: 1, paddingLeft: 12 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderTopWidth: 1 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_13: (_theme: AppTheme, { wideLayout }: ThemeStyleValues): any => ({ maxHeight: wideLayout ? 420 : 260 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 480 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_15: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12, marginBottom: 8 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '31%', aspectRatio: 1, position: 'relative' }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_18: (_theme: AppTheme, { backgroundColor, borderColor }: ThemeStyleValues): any => ({ width: '100%', height: '100%', borderRadius: 6, overflow: 'hidden', backgroundColor, borderWidth: 1, borderColor }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 28 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_21: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 11 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', height: '100%' }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 24 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', bottom: 4, right: 4, backgroundColor: _theme.colors.scrim, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 2 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_26: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 10 }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 10, color: _theme.colors.onAccent, fontWeight: '700' }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', top: 4, right: 4, backgroundColor: _theme.colors.overlay, borderRadius: 14, minWidth: 26, minHeight: 26, alignItems: 'center', justifyContent: 'center' }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_29: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 13, fontWeight: '700' }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_30: (_theme: AppTheme, { styles, backgroundColor }: ThemeStyleValues): any => ({ marginTop: 12, backgroundColor: styles?.buttonSecondary?.backgroundColor ?? styles?.card?.backgroundColor ?? backgroundColor }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_31: (_theme: AppTheme, { textColor, styles }: ThemeStyleValues): any => ({ color: textColor ?? styles?.buttonText?.color }),
  // components/DayMediaLightbox.tsx
  components_DayMediaLightbox_32: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.border),
  // components/DayOrderRow.tsx
  components_DayOrderRow_1: (_theme: AppTheme, { offset }: ThemeStyleValues): any => ({ transform: [{ translateY: offset }], zIndex: 1, opacity: 0.85 }),
  // components/DayOrderRow.tsx
  components_DayOrderRow_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }),
  // components/DayOrderRow.web.tsx
  components_DayOrderRow_web_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'grab', paddingInline: 12, color: 'inherit' }),
  // components/DestinationPlaceholderCard.tsx
  components_DestinationPlaceholderCard_1: (_theme: AppTheme, { start }: ThemeStyleValues): any => ({ overflow: 'hidden', backgroundColor: start }),
  // components/DestinationPlaceholderCard.tsx
  components_DestinationPlaceholderCard_2: (_theme: AppTheme, { end }: ThemeStyleValues): any => ({ position: 'absolute', left: '-15%', top: '-35%', width: '75%', height: '130%', borderRadius: 999, backgroundColor: end, opacity: 0.75, transform: [{ rotate: '-18deg' }] }),
  // components/DestinationPlaceholderCard.tsx
  components_DestinationPlaceholderCard_3: (_theme: AppTheme, { start }: ThemeStyleValues): any => ({ position: 'absolute', right: '-20%', bottom: '-45%', width: '80%', height: '120%', borderRadius: 999, backgroundColor: start, opacity: 0.7, transform: [{ rotate: '22deg' }] }),
  // components/DestinationPlaceholderCard.tsx
  components_DestinationPlaceholderCard_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, justifyContent: 'flex-end', padding: 18 }),
  // components/DestinationPlaceholderCard.tsx
  components_DestinationPlaceholderCard_5: (_theme: AppTheme, { labelShadow }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 22, fontWeight: '800', ...labelShadow }),
  // components/DestinationPlaceholderCard.tsx
  // Previous placeholder pairs: accentSurface/accentSurface, premiumAction/premiumAction,
  // dangerAction/dangerAction, accentSurface/accentSurface, surfaceMuted/surfaceMuted, successAction/successAction.
  components_DestinationPlaceholderCard_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ([
    ['#0A0A0A', '#3A3A3A'], ['#141414', '#4A4A4A'], ['#1C1C1C', '#525252'],
    ['#0F0F0F', '#2E2E2E'], ['#181818', '#5C5C5C'], ['#111111', '#424242'],
  ]),
  // components/DestinationPlaceholderCard.tsx
  components_DestinationPlaceholderCard_7: (_theme: AppTheme, { Platform }: ThemeStyleValues): any => (Platform.OS === 'web'
  ? { textShadow: '0px 1px 3px rgba(0,0,0,0.3)' }
  : { textShadowColor: _theme.colors.scrim, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }),
  // components/DialogShell.tsx
  components_DialogShell_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-start', alignItems: 'center', padding: 16, paddingTop: 24 }),
  // components/DialogShell.tsx
  components_DialogShell_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 0, maxHeight: '100%', minHeight: 0, flexShrink: 1 }),
  ctaLabel: (_theme: AppTheme, {}: ThemeStyleValues): any => ({ color: _theme.colors.onCta }),
  selectionLabel: (_theme: AppTheme, {}: ThemeStyleValues): any => ({ color: _theme.colors.onSelected }),
  dialogScroll: (_theme: AppTheme, {}: ThemeStyleValues): any => ({ minHeight: 0, flexShrink: 1 }),
  dialogScrollContent: (_theme: AppTheme, {}: ThemeStyleValues): any => ({ flexGrow: 1 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.surface ?? _theme.colors.surfaceMuted }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme?.colors.error ?? _theme.colors.dangerBorder, borderWidth: 1 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.5 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.error ?? _theme.colors.dangerText, fontSize: 11 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.45 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'center' }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginHorizontal: 4, marginBottom: 4 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors?.link ?? _theme.colors.linkText, fontSize: 12 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: _theme.colors.overlay }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_10: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.surface ?? _theme.colors.surface, borderRadius: 12, padding: 16, minWidth: 260, maxHeight: '80%' }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 8 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_12: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', left: 0, zIndex: 3, backgroundColor: theme?.colors?.surface ?? _theme.colors.surface }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_13: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', right: 0, zIndex: 3, backgroundColor: theme?.colors?.surface ?? _theme.colors.surface }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_14: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    backgroundColor: theme?.colors?.surface ?? _theme.colors.surface,
    color: theme?.colors?.text ?? _theme.colors.text,
    borderColor: theme?.colors?.border ?? _theme.colors.border,
  }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_15: (_theme: AppTheme, { gridInputThemeStyle }: ThemeStyleValues): any => ({
    ...gridInputThemeStyle,
    boxSizing: 'border-box' as const,
  }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_16: (_theme: AppTheme, { anchor, active }: ThemeStyleValues): any => ({
      top: Math.min(anchor.rowIndex, active.rowIndex),
      bottom: Math.max(anchor.rowIndex, active.rowIndex),
      left: Math.min(anchor.columnIndex, active.columnIndex),
      right: Math.max(anchor.columnIndex, active.columnIndex),
    }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_17: (_theme: AppTheme, { column }: ThemeStyleValues): any => ({ minWidth: column.width - 16, width: column.width - 16, margin: 4 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_18: (_theme: AppTheme, { webInputStyle, column }: ThemeStyleValues): any => ({ ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, margin: 4 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_19: (_theme: AppTheme, { column }: ThemeStyleValues): any => ({ minWidth: column.width - 16, width: column.width - 16, margin: 4 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_20: (_theme: AppTheme, { webInputStyle, column }: ThemeStyleValues): any => ({ ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, margin: 4 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_21: (_theme: AppTheme, { webInputStyle, column }: ThemeStyleValues): any => ({ ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, minHeight: 36, margin: 4 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 42 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_23: (_theme: AppTheme, { webInputStyle, column }: ThemeStyleValues): any => ({ ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, margin: 4 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_24: (_theme: AppTheme, { column }: ThemeStyleValues): any => ({ minWidth: column.width, width: column.width }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_25: (_theme: AppTheme, { webInputStyle, column }: ThemeStyleValues): any => ({ ...webInputStyle, minWidth: column.width - 16, width: column.width - 16, margin: 4 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_26: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ outline: 'none' }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, marginTop: 12 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_29: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/EditableDataGrid.tsx
  components_EditableDataGrid_30: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/FeatureCohortEditor.tsx
  components_FeatureCohortEditor_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/FeatureCohortEditor.tsx
  components_FeatureCohortEditor_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.textMuted, minHeight: 44, padding: 8 }),
  // components/FeatureCohortEditor.tsx
  components_FeatureCohortEditor_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, padding: 8 }),
  // components/FeatureCohortEditor.tsx
  components_FeatureCohortEditor_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText }),
  // components/FeatureCohortEditor.tsx
  components_FeatureCohortEditor_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // components/FormField.tsx
  components_FormField_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 10 }),
  // components/GetYourGuideCta.tsx
  components_GetYourGuideCta_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4 }),
  // components/GetYourGuideCta.tsx
  components_GetYourGuideCta_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.link ?? _theme.colors.linkText, textDecorationLine: 'underline' }),
  // components/GetYourGuideCta.tsx
  components_GetYourGuideCta_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ fontSize: 11, opacity: 0.75, color: theme?.colors.textMuted }),
  // components/GmailForwardingConfirmation.tsx
  components_GmailForwardingConfirmation_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // components/GmailForwardingConfirmation.tsx
  components_GmailForwardingConfirmation_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/GmailForwardingConfirmation.tsx
  components_GmailForwardingConfirmation_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/GoogleLogo.tsx
  components_GoogleLogo_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ("#EA4335"),
  // components/GoogleLogo.tsx
  components_GoogleLogo_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ("#4285F4"),
  // components/GoogleLogo.tsx
  components_GoogleLogo_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ("#FBBC05"),
  // components/GoogleLogo.tsx
  components_GoogleLogo_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ("#34A853"),
  // components/GoogleSignInButton.tsx
  components_GoogleSignInButton_1: (_theme: AppTheme, { isDark }: ThemeStyleValues): any => ({
        height: 40,
        borderRadius: 4,
        backgroundColor: isDark ? _theme.colors.primary : _theme.colors.surface,
        borderWidth: isDark ? 0 : 1,
        borderColor: _theme.colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        width: '100%',
      }),
  // components/GoogleSignInButton.tsx
  components_GoogleSignInButton_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 18, height: 18, marginRight: 10 }),
  // components/GoogleSignInButton.tsx
  components_GoogleSignInButton_3: (_theme: AppTheme, { isDark }: ThemeStyleValues): any => ({
          color: isDark ? _theme.colors.textMuted : _theme.colors.text,
          fontSize: 14,
          fontWeight: '500',
        }),
  // components/HotelAddressPicker.tsx
  components_HotelAddressPicker_1: (_theme: AppTheme, { disabled }: ThemeStyleValues): any => ({ width: 180, opacity: disabled ? 0.45 : 1 }),
  // components/HotelAddressPicker.tsx
  components_HotelAddressPicker_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 180 }),
  // components/HotelAddressPicker.tsx
  components_HotelAddressPicker_3: (_theme: AppTheme, { disabled }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center', opacity: disabled ? 0.45 : 1 }),
  // components/HotelAddressPicker.tsx
  components_HotelAddressPicker_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/ImportForwardingSetup.tsx
  components_ImportForwardingSetup_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/ImportForwardingSetup.tsx
  components_ImportForwardingSetup_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 180, height: 180 }),
  // components/ImportSenderAddresses.tsx
  components_ImportSenderAddresses_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, borderWidth: 1, borderColor: _theme.colors.accentBorder, borderRadius: 8, paddingHorizontal: 10 }),
  // components/ImportSenderAddresses.tsx
  components_ImportSenderAddresses_2: (_theme: AppTheme, { disabled, busy }: ThemeStyleValues): any => ({ minHeight: 44, opacity: disabled || busy ? 0.6 : 1 }),
  // components/ImportSenderAddresses.tsx
  components_ImportSenderAddresses_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8, marginTop: 12 }),
  // components/ImportSenderAddresses.tsx
  components_ImportSenderAddresses_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, alignSelf: 'flex-start' }),
  // components/ImportSuggestionReview.tsx
  components_ImportSuggestionReview_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8, marginVertical: 12 }),
  // components/ImportSuggestionReview.tsx
  components_ImportSuggestionReview_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/ImportSuggestionReview.tsx
  components_ImportSuggestionReview_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/ImportSuggestionReview.tsx
  components_ImportSuggestionReview_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 4, paddingVertical: 8 }),
  // components/ImportSuggestionReview.tsx
  components_ImportSuggestionReview_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/ImportSuggestionReview.tsx
  components_ImportSuggestionReview_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/ImportSuggestionReview.tsx
  components_ImportSuggestionReview_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/ImportSuggestionReview.tsx
  components_ImportSuggestionReview_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/ImportSuggestionReview.tsx
  components_ImportSuggestionReview_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_1: (_theme: AppTheme, { styles, textColor }: ThemeStyleValues): any => ({ ...(styles?.cellText ?? {}), color: textColor }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_2: (_theme: AppTheme, { borderColor, textColor }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor, borderRadius: 8, padding: 8, color: textColor, marginBottom: 12 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxWidth: 480, width: '92%', maxHeight: '85%' }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 420 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_5: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginBottom: 10 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_7: (_theme: AppTheme, { borderColor, surfaceColor }: ThemeStyleValues): any => ({ width: 64, height: 64, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor, backgroundColor: surfaceColor, alignItems: 'center', justifyContent: 'center' }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 20 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', height: '100%' }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_10: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700', marginBottom: 6 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_12: (_theme: AppTheme, { trip, selectedTripId, theme }: ThemeStyleValues): any => ({ paddingVertical: 5, paddingHorizontal: 10, backgroundColor: trip.id === selectedTripId ? undefined : (theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted) }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_13: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_14: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700', marginBottom: 6 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_15: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700', marginBottom: 6 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_16: (_theme: AppTheme, { borderColor, textColor }: ThemeStyleValues): any => ({ minHeight: 70, borderWidth: 1, borderColor, borderRadius: 8, padding: 8, textAlignVertical: 'top', color: textColor, marginBottom: 4 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_17: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12, marginBottom: 12 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_20: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_21: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/IncomingShareModal.tsx
  components_IncomingShareModal_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 10 }),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignSelf: 'flex-start' }),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 10, padding: 12 }),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 140, textAlignVertical: 'top' }),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_5: (_theme: AppTheme, { fileInputColor, theme }: ThemeStyleValues): any => ({ color: fileInputColor, colorScheme: theme?.mode ?? 'light' }),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center', gap: 6 }),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 8 }),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 6 }),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // components/ItineraryDocumentImport.tsx
  components_ItineraryDocumentImport_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/KeepsakeMapCaptureHost.tsx
  components_KeepsakeMapCaptureHost_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({alignItems:'center',paddingVertical:8}),
  // components/KeepsakeMapCaptureHost.tsx
  components_KeepsakeMapCaptureHost_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({width:320,height:200}),
  // components/KeepsakeMapCaptureHost.tsx
  components_KeepsakeMapCaptureHost_3: (_theme: AppTheme, { bounds }: ThemeStyleValues): any => ({...bounds,paddingTop:30,paddingBottom:30,paddingLeft:30,paddingRight:30}),
  // components/KeepsakeMapCaptureHost.tsx
  components_KeepsakeMapCaptureHost_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.accentSurface),
  // components/KeepsakeMapCaptureHost.tsx
  components_KeepsakeMapCaptureHost_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/KeepsakeMapCaptureHost.tsx
  components_KeepsakeMapCaptureHost_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/KeyboardViewport.tsx
  components_KeyboardViewport_1: (_theme: AppTheme, { height, top }: ThemeStyleValues): any => ({ height, top }),
  // components/KeyboardViewport.tsx
  components_KeyboardViewport_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 0 }),
  // components/KeyboardViewport.tsx
  components_KeyboardViewport_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/KeyboardViewport.tsx
  components_KeyboardViewport_4: (_theme: AppTheme, { viewport }: ThemeStyleValues): any => ({
      position: 'fixed', left: 0, right: 0, top: viewport.top,
      height: viewport.height, maxHeight: viewport.height,
    }),
  // components/KeyboardViewport.tsx
  components_KeyboardViewport_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 0 }),
  // components/KeyboardViewport.tsx
  components_KeyboardViewport_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/LandingPage.tsx
  components_LandingPage_1: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ flex: 1, width: '100%', backgroundColor: colors.background }),
  // components/LandingPage.tsx
  components_LandingPage_2: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }),
  // components/LandingPage.tsx
  components_LandingPage_3: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ width: '100%', maxWidth: 800, alignItems: 'center', marginTop: spacing.xl }),
  // components/LandingPage.tsx
  components_LandingPage_4: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ width: 80, height: 80, marginBottom: spacing.sm }),
  // components/LandingPage.tsx
  components_LandingPage_5: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({
            fontSize: typography.display,
            fontWeight: typography.weightBold,
            color: colors.text,
            textAlign: 'center',
            marginBottom: 4,
          }),
  // components/LandingPage.tsx
  components_LandingPage_6: (_theme: AppTheme, { typography, colors, spacing }: ThemeStyleValues): any => ({
            fontSize: typography.h2,
            fontWeight: typography.weightMedium,
            color: colors.textMuted,
            textAlign: 'center',
            marginBottom: spacing.lg,
          }),
  // components/LandingPage.tsx
  components_LandingPage_7: (_theme: AppTheme, { colors, spacing }: ThemeStyleValues): any => ({ backgroundColor: colors.surface, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xl }),
  // components/LandingPage.tsx
  components_LandingPage_8: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({
              fontSize: typography.body,
              color: colors.text,
              textAlign: 'center',
              lineHeight: 24,
            }),
  // components/LandingPage.tsx
  components_LandingPage_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: 'bold' }),
  // components/LandingPage.tsx
  components_LandingPage_10: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({
            width: '100%',
            maxWidth: 420,
            gap: spacing.md,
          }),
  // components/LandingPage.tsx
  components_LandingPage_11: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: spacing.md }),
  // components/LandingPage.tsx
  components_LandingPage_12: (_theme: AppTheme, { colors, spacing }: ThemeStyleValues): any => ({
                flex: 1,
                ...ctaGradientStyle(_theme),
                paddingVertical: spacing.md,
                borderRadius: 8,
                alignItems: 'center',
              }),
  // components/LandingPage.tsx
  components_LandingPage_13: (_theme: AppTheme, { typography }: ThemeStyleValues): any => ({ color: _theme.colors.onCta, fontWeight: typography.weightBold, fontSize: typography.body }),
  // components/LandingPage.tsx
  components_LandingPage_14: (_theme: AppTheme, { colors, spacing }: ThemeStyleValues): any => ({
                flex: 1,
                backgroundColor: colors.surfaceMuted,
                borderWidth: 1,
                borderColor: colors.border,
                paddingVertical: spacing.md,
                borderRadius: 8,
                alignItems: 'center',
              }),
  // components/LandingPage.tsx
  components_LandingPage_15: (_theme: AppTheme, { colors, typography }: ThemeStyleValues): any => ({ color: colors.text, fontWeight: typography.weightBold, fontSize: typography.body }),
  // components/LandingPage.tsx
  components_LandingPage_16: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ alignSelf: 'stretch', marginTop: spacing.xxl, gap: 16 }),
  // components/LandingPage.tsx
  components_LandingPage_17: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.h3, fontWeight: typography.weightBold, color: colors.text }),
  // components/LandingPage.tsx
  components_LandingPage_18: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 12, backgroundColor: colors.surface, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border }),
  // components/LandingPage.tsx
  components_LandingPage_19: (_theme: AppTheme, { colors, typography }: ThemeStyleValues): any => ({ color: colors.link, fontSize: typography.h3, fontWeight: 'bold' }),
  // components/LandingPage.tsx
  components_LandingPage_20: (_theme: AppTheme, { colors, typography }: ThemeStyleValues): any => ({ color: colors.text, fontSize: typography.small, flex: 1, lineHeight: 20 }),
  // components/LandingPage.tsx
  components_LandingPage_21: (_theme: AppTheme, { spacing, colors }: ThemeStyleValues): any => ({
          width: '100%',
          maxWidth: 800,
          marginTop: spacing.xxl,
          padding: spacing.xl,
          borderRadius: 12,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }),
  // components/LandingPage.tsx
  components_LandingPage_22: (_theme: AppTheme, { typography, colors, spacing }: ThemeStyleValues): any => ({
            fontSize: typography.h3,
            fontWeight: typography.weightBold,
            color: colors.text,
            marginBottom: spacing.md,
            textAlign: 'center',
          }),
  // components/LandingPage.tsx
  components_LandingPage_23: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.textMuted, marginBottom: 16, lineHeight: 22 }),
  // components/LandingPage.tsx
  components_LandingPage_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: 'bold', textDecorationLine: 'underline' }),
  // components/LandingPage.tsx
  components_LandingPage_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 12 }),
  // components/LandingPage.tsx
  components_LandingPage_26: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.surfaceMuted, padding: 12, borderRadius: 8 }),
  // components/LandingPage.tsx
  components_LandingPage_27: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.textMuted, lineHeight: 20 }),
  // components/LandingPage.tsx
  components_LandingPage_28: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ fontWeight: 'bold', color: colors.text }),
  // components/LandingPage.tsx
  components_LandingPage_29: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.surfaceMuted, padding: 12, borderRadius: 8 }),
  // components/LandingPage.tsx
  components_LandingPage_30: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.textMuted, lineHeight: 20 }),
  // components/LandingPage.tsx
  components_LandingPage_31: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ fontWeight: 'bold', color: colors.text }),
  // components/LandingPage.tsx
  components_LandingPage_32: (_theme: AppTheme, { spacing, colors }: ThemeStyleValues): any => ({ marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }),
  // components/LandingPage.tsx
  components_LandingPage_33: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.textMuted, textAlign: 'center' }),
  // components/LandingPage.tsx
  components_LandingPage_34: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: 'bold', textDecorationLine: 'underline' }),
  // components/LandingPage.tsx
  components_LandingPage_35: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ width: '100%', maxWidth: 800, marginTop: spacing.xxl }),
  // components/LandingPage.tsx
  components_LandingPage_36: (_theme: AppTheme, { typography, colors, spacing }: ThemeStyleValues): any => ({
            fontSize: typography.h3,
            fontWeight: typography.weightBold,
            color: colors.text,
            marginBottom: spacing.sm,
          }),
  // components/LandingPage.tsx
  components_LandingPage_37: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ gap: spacing.md }),
  // components/LandingPage.tsx
  components_LandingPage_38: (_theme: AppTheme, { day, spacing }: ThemeStyleValues): any => ({
                height: 140,
                borderRadius: 12,
                backgroundColor: day.color,
                padding: spacing.md,
                justifyContent: 'space-between',
                overflow: 'hidden',
              }),
  // components/LandingPage.tsx
  components_LandingPage_39: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
                  alignSelf: 'flex-start',
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999,
                  backgroundColor: _theme.colors.overlay,
                }),
  // components/LandingPage.tsx
  components_LandingPage_40: (_theme: AppTheme, { typography }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: typography.caption, fontWeight: typography.weightSemibold }),
  // components/LandingPage.tsx
  components_LandingPage_41: (_theme: AppTheme, { typography }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: typography.h3, fontWeight: typography.weightBold }),
  // components/LandingPage.tsx
  components_LandingPage_42: (_theme: AppTheme, { typography }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: typography.small, marginTop: 2 }),
  // components/LandingPage.tsx
  components_LandingPage_43: (_theme: AppTheme, { typography, colors, spacing }: ThemeStyleValues): any => ({
            fontSize: typography.caption,
            color: colors.textMuted,
            textAlign: 'center',
            marginTop: spacing.sm,
          }),
  // components/LandingPage.tsx
  components_LandingPage_44: (_theme: AppTheme, { spacing, colors }: ThemeStyleValues): any => ({ marginTop: spacing.xxl, alignItems: 'center', width: '100%', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xl }),
  // components/LandingPage.tsx
  components_LandingPage_45: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }),
  // components/LandingPage.tsx
  components_LandingPage_46: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }),
  // components/LandingPage.tsx
  components_LandingPage_47: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.textMuted }),
  // components/LandingPage.tsx
  components_LandingPage_48: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }),
  // components/LandingPage.tsx
  components_LandingPage_49: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.textMuted }),
  // components/LandingPage.tsx
  components_LandingPage_50: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }),
  // components/LandingPage.tsx
  components_LandingPage_51: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.textMuted }),
  // components/LandingPage.tsx
  components_LandingPage_52: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.link, fontWeight: typography.weightSemibold, textDecorationLine: 'underline' }),
  // components/LandingPage.tsx
  components_LandingPage_53: (_theme: AppTheme, { typography, colors, spacing }: ThemeStyleValues): any => ({ fontSize: typography.caption, color: colors.textMuted, marginTop: spacing.lg, textAlign: 'center' }),
  // components/LandingPage.tsx
  components_LandingPage_54: (_theme: AppTheme, {  }: ThemeStyleValues): any => ([
  { label: 'Day 1', title: 'Arrive in Seattle', subtitle: 'Pike Place Market · check in to hotel', color: _theme.colors.accentAction },
  { label: 'Day 2', title: 'Olympic National Park', subtitle: 'Hurricane Ridge · Sol Duc Falls Trail', color: _theme.colors.successAction },
  { label: 'Day 3', title: 'Hoh Rainforest', subtitle: 'Ruby Beach · sunset drive back', color: _theme.colors.warningAction },
]),
  // components/LazyTabFallback.tsx
  components_LazyTabFallback_1: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  label: {
    marginTop: 12,
    fontSize: 14,
    color: _theme.colors.text,
  },
})),
  // components/LazyTabFallback.tsx
  components_LazyTabFallback_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/LocationSelector.tsx
  components_LocationSelector_1: (_theme: AppTheme, { activeDropdownZIndex }: ThemeStyleValues): any => ({ position: 'relative', zIndex: activeDropdownZIndex }),
  // components/LocationSelector.tsx
  components_LocationSelector_2: (_theme: AppTheme, { showCountryStateDropdown, activeDropdownZIndex }: ThemeStyleValues): any => ({ alignItems: 'flex-start', zIndex: showCountryStateDropdown ? activeDropdownZIndex : 1 }),
  // components/LocationSelector.tsx
  components_LocationSelector_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/LocationSelector.tsx
  components_LocationSelector_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/LocationSelector.tsx
  components_LocationSelector_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center' }),
  // components/LocationSelector.tsx
  components_LocationSelector_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center' }),
  // components/LocationSelector.tsx
  components_LocationSelector_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 8, marginTop: 10 }),
  // components/LocationSelector.tsx
  components_LocationSelector_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 8 }),
  // components/LocationSelector.tsx
  components_LocationSelector_9: (_theme: AppTheme, { showCityDropdown, activeDropdownZIndex }: ThemeStyleValues): any => ({ alignItems: 'flex-start', marginTop: 12, zIndex: showCityDropdown ? activeDropdownZIndex : 1 }),
  // components/LocationSelector.tsx
  components_LocationSelector_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/LocationSelector.tsx
  components_LocationSelector_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/LocationSelector.tsx
  components_LocationSelector_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center' }),
  // components/LocationSelector.tsx
  components_LocationSelector_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center' }),
  // components/LocationSelector.tsx
  components_LocationSelector_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 8, marginTop: 10 }),
  // components/LocationSelector.tsx
  components_LocationSelector_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 8 }),
  // components/LocationSelector.tsx
  components_LocationSelector_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4 }),
  // components/LocationSelector.tsx
  components_LocationSelector_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', gap: 8, marginTop: 8 }),
  // components/LocationSelector.tsx
  components_LocationSelector_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/LocationSelector.tsx
  components_LocationSelector_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/LodgingDetailsDialog.tsx
  components_LodgingDetailsDialog_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxHeight: '95%' }),
  // components/LodgingDetailsDialog.tsx
  components_LodgingDetailsDialog_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexShrink: 1, minHeight: 0 }),
  // components/LodgingDetailsDialog.tsx
  components_LodgingDetailsDialog_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingBottom: 8 }),
  // components/LodgingDetailsDialog.tsx
  components_LodgingDetailsDialog_4: (_theme: AppTheme, { imageHeight }: ThemeStyleValues): any => ({ height: imageHeight }),
  // components/LodgingDetailsDialog.tsx
  components_LodgingDetailsDialog_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 2 }),
  // components/LodgingDetailsDialog.tsx
  components_LodgingDetailsDialog_6: (_theme: AppTheme, { mapHeight }: ThemeStyleValues): any => ({ height: mapHeight }),
  // components/LodgingDetailsDialog.tsx
  components_LodgingDetailsDialog_7: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
  detailCard: {
    borderRadius: 16,
    overflow: 'hidden',
    padding: 0,
    maxWidth: 420,
    width: '100%',
  },
  imageWrap: {
    position: 'relative',
    height: 200,
    backgroundColor: theme?.colors.surfaceMuted ?? _theme.colors.surfaceMuted,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: _theme.colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    color: _theme.colors.onAccent,
    fontSize: 16,
    fontWeight: '700',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  headerMeta: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: theme?.colors.text ?? _theme.colors.text,
  },
  mutedText: {
    color: theme?.colors.textMuted ?? _theme.colors.text,
    fontSize: 13,
  },
  statusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: _theme.colors.accentBorder,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: theme?.mode === 'dark' ? _theme.colors.overlay : _theme.colors.surfaceMuted,
  },
  statusText: {
    color: theme?.mode === 'dark' ? _theme.colors.successText : _theme.colors.successText,
    fontWeight: '600',
  },
  summaryCard: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 12,
    backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
  },
  detailList: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  detailLabel: {
    width: 110,
    color: theme?.colors.text ?? _theme.colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  detailValue: {
    flex: 1,
    textAlign: 'left',
    color: theme?.colors.text ?? _theme.colors.text,
    fontSize: 13,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  summaryLabel: {
    fontSize: 12,
    color: theme?.colors.textMuted ?? _theme.colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 16,
    color: theme?.colors.text ?? _theme.colors.text,
    fontWeight: '600',
    textAlign: 'right',
    maxWidth: '70%',
  },
  mapCard: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? _theme.colors.border,
    overflow: 'hidden',
    backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
  },
  mapImage: {
    width: '100%',
    height: 180,
    backgroundColor: theme?.colors.surfaceMuted ?? _theme.colors.surfaceMuted,
  },
  mapMeta: {
    padding: 12,
    gap: 4,
  },
  mapLink: {
    fontWeight: '600',
  },
  actionGroup: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
}),
  // components/LodgingDialog.tsx
  components_LodgingDialog_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'center' }),
  // components/LodgingDialog.tsx
  components_LodgingDialog_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 0 }),
  // components/LodgingDialog.tsx
  components_LodgingDialog_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxHeight: '90%' }),
  // components/LodgingDialog.tsx
  components_LodgingDialog_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexShrink: 1 }),
  // components/LodgingDialog.tsx
  components_LodgingDialog_5: (_theme: AppTheme, { isCompact }: ThemeStyleValues): any => ({ maxHeight: isCompact ? 520 : 440 }),
  // components/LodgingDialog.tsx
  components_LodgingDialog_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingRight: 12, paddingBottom: 16 }),
  // components/LodgingForm.tsx
  components_LodgingForm_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? _theme.colors.border,
    backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
  }),
  // components/LodgingForm.tsx
  components_LodgingForm_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    backgroundColor: theme ? (theme.mode === 'dark' ? _theme.colors.accentAction : _theme.colors.surfaceMuted) : _theme.colors.surfaceMuted,
    borderColor: theme?.colors.link ?? _theme.colors.border,
  }),
  // components/LodgingForm.tsx
  components_LodgingForm_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text ?? _theme.colors.text, fontWeight: '600' }),
  // components/LodgingForm.tsx
  components_LodgingForm_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text ?? _theme.colors.text }),
  // components/LodgingForm.tsx
  components_LodgingForm_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'column' }),
  // components/LodgingForm.tsx
  components_LodgingForm_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: '100%' }),
  // components/LodgingForm.tsx
  components_LodgingForm_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }),
  // components/LodgingForm.tsx
  components_LodgingForm_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'column' }),
  // components/LodgingForm.tsx
  components_LodgingForm_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: '100%' }),
  // components/LodgingForm.tsx
  components_LodgingForm_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: '100%' }),
  // components/LodgingForm.tsx
  components_LodgingForm_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'column' }),
  // components/LodgingForm.tsx
  components_LodgingForm_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: '100%' }),
  // components/LodgingForm.tsx
  components_LodgingForm_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: '100%' }),
  // components/LodgingForm.tsx
  components_LodgingForm_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'column' }),
  // components/LodgingForm.tsx
  components_LodgingForm_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: '100%' }),
  // components/LodgingForm.tsx
  components_LodgingForm_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: '100%' }),
  // components/LodgingForm.tsx
  components_LodgingForm_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 70 }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_1: (_theme: AppTheme, { activeDropdownZIndex }: ThemeStyleValues): any => ({ marginTop: 12, position: 'relative', zIndex: activeDropdownZIndex }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_2: (_theme: AppTheme, { activeDropdownZIndex }: ThemeStyleValues): any => ({ alignItems: 'flex-start', zIndex: activeDropdownZIndex }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center' }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center' }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 8 }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 8 }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4 }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', gap: 8, marginTop: 8 }),
  // components/MustSeeAttractionSelector.tsx
  components_MustSeeAttractionSelector_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/NativeDatePickerSheet.tsx
  components_NativeDatePickerSheet_1: (_theme: AppTheme, { theme, isDark }: ThemeStyleValues): any => ({
    surface: theme?.colors.surface ?? (isDark ? _theme.colors.surfaceMuted : _theme.colors.surface),
    border: theme?.colors.border ?? (isDark ? _theme.colors.accentBorder : _theme.colors.border),
    text: theme?.colors.text ?? (isDark ? _theme.colors.surfaceMuted : _theme.colors.surfaceMuted),
    mutedText: theme?.colors.textMuted ?? (isDark ? _theme.colors.surfaceMuted : _theme.colors.surfaceMuted),
    // Tint handed to the native picker (matches the app's link/accent color).
    accent: theme?.colors.link ?? (isDark ? _theme.colors.accentAction : _theme.colors.accentAction),
    // The light theme's link cyan is too low-contrast for text on a white sheet, so the Done
    // label uses the navy brand color in light mode and the (bright) link color in dark mode.
    action: isDark ? (theme?.colors.link ?? _theme.colors.accentSurface) : (theme?.colors.primary ?? _theme.colors.accentSurface),
  }),
  // components/NativeDatePickerSheet.tsx
  components_NativeDatePickerSheet_2: (_theme: AppTheme, { theme, colors }: ThemeStyleValues): any => ({
        display: 'spinner',
        themeVariant: theme?.mode,
        textColor: colors.text,
        accentColor: colors.accent,
      }),
  // components/NativeDatePickerSheet.tsx
  components_NativeDatePickerSheet_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, justifyContent: 'flex-end', backgroundColor: _theme.colors.scrim }),
  // components/NativeDatePickerSheet.tsx
  components_NativeDatePickerSheet_4: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 24 }),
  // components/NativeDatePickerSheet.tsx
  components_NativeDatePickerSheet_5: (_theme: AppTheme, { onCancel, colors }: ThemeStyleValues): any => ({ flexDirection: 'row', justifyContent: onCancel ? 'space-between' : 'flex-end', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }),
  // components/NativeDatePickerSheet.tsx
  components_NativeDatePickerSheet_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }),
  // components/NativeDatePickerSheet.tsx
  components_NativeDatePickerSheet_7: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.mutedText, fontSize: 16 }),
  // components/NativeDatePickerSheet.tsx
  components_NativeDatePickerSheet_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }),
  // components/NativeDatePickerSheet.tsx
  components_NativeDatePickerSheet_9: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.action, fontSize: 16, fontWeight: '700' }),
  // components/NativeDatePickerSheet.tsx
  components_NativeDatePickerSheet_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center' }),
  // components/NativeVideoPlayer.tsx
  components_NativeVideoPlayer_1: (_theme: AppTheme, { height, backgroundColor }: ThemeStyleValues): any => ({ width: '100%', height, borderRadius: 8, backgroundColor }),
  // components/NearbyPlacesPanel.tsx
  components_NearbyPlacesPanel_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 12, gap: 10 }),
  // components/NearbyPlacesPanel.tsx
  components_NearbyPlacesPanel_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 18, fontWeight: '700' }),
  // components/NearbyPlacesPanel.tsx
  components_NearbyPlacesPanel_3: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, minHeight: 44 }),
  // components/NearbyPlacesPanel.tsx
  components_NearbyPlacesPanel_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/NearbyPlacesPanel.tsx
  components_NearbyPlacesPanel_5: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ gap: 6, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12 }),
  // components/NearbyPlacesPanel.tsx
  components_NearbyPlacesPanel_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // components/NearbyPlacesPanel.tsx
  components_NearbyPlacesPanel_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/NearbyPlacesPanel.tsx
  components_NearbyPlacesPanel_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/NearbyPlacesPanel.tsx
  components_NearbyPlacesPanel_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/NoteInputDialog.tsx
  components_NoteInputDialog_1: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.surface }),
  // components/NoteInputDialog.tsx
  components_NoteInputDialog_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // components/NoteInputDialog.tsx
  components_NoteInputDialog_3: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/NoteInputDialog.tsx
  components_NoteInputDialog_4: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/NoteInputDialog.tsx
  components_NoteInputDialog_5: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border }),
  // components/NoteInputDialog.tsx
  components_NoteInputDialog_6: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/NoteInputDialog.tsx
  components_NoteInputDialog_7: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border }),
  // components/NoteInputDialog.tsx
  components_NoteInputDialog_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText }),
  // components/NoteInputDialog.tsx
  components_NoteInputDialog_9: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/NoteInputDialog.tsx
  components_NoteInputDialog_10: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  overlay: { flex: 1, backgroundColor: _theme.colors.scrim, justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 460, maxHeight: '100%', backgroundColor: _theme.colors.surface, borderRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: _theme.colors.text, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: _theme.colors.text, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: _theme.colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: _theme.colors.text, backgroundColor: _theme.colors.surface,
  },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  error: { color: _theme.colors.dangerText, fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  btnGhost: { paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 6 },
  btnGhostText: { color: _theme.colors.text, fontWeight: '600' },
  btnPrimary: { backgroundColor: _theme.colors.accentAction, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 6 },
  btnPrimaryText: { color: _theme.colors.onAccent, fontWeight: '700' },
})),
  // components/NotificationInbox.tsx
  components_NotificationInbox_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, padding: 10, justifyContent: 'center' as const }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, backgroundColor: _theme.colors.overlay, justifyContent: 'center', padding: 16 }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.surface, borderRadius: 12, padding: 16, maxHeight: '90%', width: '100%', maxWidth: 600, alignSelf: 'center' }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 22 }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap' }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 8 }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_13: (_theme: AppTheme, { buttonStyle }: ThemeStyleValues): any => ({ ...buttonStyle, borderBottomWidth: 1, borderBottomColor: _theme.colors.border }),
  // components/NotificationInbox.tsx
  components_NotificationInbox_14: (_theme: AppTheme, { row }: ThemeStyleValues): any => ({ fontWeight: row.readAt ? '400' : '700' }),
  // components/OfflineBanner.tsx
  components_OfflineBanner_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
  paddingVertical: 6,
  paddingHorizontal: 12,
  backgroundColor: _theme.colors.dangerAction,
  alignItems: 'center',
}),
  // components/OfflineBanner.tsx
  components_OfflineBanner_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
  color: _theme.colors.onAccent,
  fontSize: 13,
  fontWeight: '600',
}),
  // components/OfflineDownloadSettings.tsx
  components_OfflineDownloadSettings_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap' }),
  // components/OfflineDownloadSettings.tsx
  components_OfflineDownloadSettings_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginRight: 8, marginTop: 4 }),
  // components/OfflineUnlockScreen.tsx
  components_OfflineUnlockScreen_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'center', padding: 24 }),
  // components/OfflineUnlockScreen.tsx
  components_OfflineUnlockScreen_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxWidth: 460, width: '100%', alignSelf: 'center', gap: 12 }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_1: (_theme: AppTheme, { colors, StyleSheet }: ThemeStyleValues): any => ({
        overflow: 'auto',
        position: 'relative',
        maxHeight: '70vh',
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_2: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({
        position: 'sticky',
        top: 0,
        zIndex: 10,
        backgroundColor: colors.backgroundAlt,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_3: (_theme: AppTheme, { styles, colors }: ThemeStyleValues): any => ({ ...styles.itemHeader, backgroundColor: colors.backgroundAlt, borderColor: colors.border }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
            position: 'sticky',
            top: 0,
            left: 0,
            zIndex: 4,
          }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_5: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_6: (_theme: AppTheme, { styles, colors }: ThemeStyleValues): any => ({ ...styles.travelerHeader, backgroundColor: colors.backgroundAlt, borderColor: colors.border }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
              position: 'sticky',
              top: 0,
              zIndex: 3,
            }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_8: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_9: (_theme: AppTheme, { styles, item, colors }: ThemeStyleValues): any => ({ ...styles.itemCell, ...(item.isCategory ? styles.sectionCell : {}), borderColor: colors.border, backgroundColor: item.isCategory ? colors.backgroundAlt : colors.surface }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
              position: 'sticky',
              left: 0,
              zIndex: 2,
            }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_11: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_12: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ borderColor: colors.border, backgroundColor: colors.backgroundAlt }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_13: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ borderColor: colors.border, backgroundColor: colors.surface }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_14: (_theme: AppTheme, { checked, colors }: ThemeStyleValues): any => ({ color: checked ? colors.success : colors.textMuted }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_15: (_theme: AppTheme, { StyleSheet, colors }: ThemeStyleValues): any => ({ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_16: (_theme: AppTheme, { tableWidth }: ThemeStyleValues): any => ({ width: tableWidth }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_17: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.backgroundAlt, borderBottomWidth: 1, borderBottomColor: colors.border }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_18: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.backgroundAlt, borderColor: colors.border }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_19: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_20: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.backgroundAlt, borderColor: colors.border }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_21: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_22: (_theme: AppTheme, { colors, item }: ThemeStyleValues): any => ({ borderColor: colors.border, backgroundColor: item.isCategory ? colors.backgroundAlt : colors.surface }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_23: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_24: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ borderColor: colors.border, backgroundColor: colors.backgroundAlt }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_25: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ borderColor: colors.border, backgroundColor: colors.surface }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_26: (_theme: AppTheme, { checked, colors }: ThemeStyleValues): any => ({ color: checked ? colors.success : colors.textMuted }),
  // components/PackingListMatrix.tsx
  components_PackingListMatrix_27: (_theme: AppTheme, { StyleSheet, MATRIX_MAX_HEIGHT, ITEM_WIDTH, TRAVELER_WIDTH }: ThemeStyleValues): any => (StyleSheet.create({
  root: { minHeight: 100 },
  webScroll: { width: '100%', maxWidth: '100%' },
  nativeHorizontalScroll: { width: '100%' },
  nativeVerticalScroll: { maxHeight: MATRIX_MAX_HEIGHT },
  // Deliberately no `minWidth: '100%'` here. A row's width should be exactly
  // its real columns (item column + one per traveler) so header and body
  // rows always measure identically -- forcing every row to additionally
  // fill the scroll viewport's full width (which can be much wider than the
  // real columns when a trip has only one or two travelers) left a stretch
  // of background-colored blank space trailing after the last real column,
  // which read as a spurious extra "blank column".
  horizontalRow: { flexDirection: 'row' },
  itemHeader: { width: ITEM_WIDTH, justifyContent: 'center', paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth },
  travelerHeader: { width: TRAVELER_WIDTH, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, borderWidth: StyleSheet.hairlineWidth },
  headerText: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  itemCell: { width: ITEM_WIDTH, minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth },
  itemText: { fontSize: 14 },
  checkCell: { width: TRAVELER_WIDTH, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  sectionCell: { minHeight: 40, paddingVertical: 8, borderTopWidth: 2 },
  sectionText: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  checkText: { fontSize: 20, fontWeight: '700' },
})),
  // components/StarRating.tsx
  components_StarRating_1: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  star: { position: 'relative' },
  fill: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
})),
  // components/StarRating.tsx
  components_StarRating_2: (_theme: AppTheme, { size }: ThemeStyleValues): any => ({ width: size, height: size }),
  // components/StarRating.tsx
  components_StarRating_3: (_theme: AppTheme, { size, fraction }: ThemeStyleValues): any => ({ width: size * fraction, height: size }),
  // components/PackingListTable.tsx
  components_PackingListTable_1: (_theme: AppTheme, { item, index }: ThemeStyleValues): any => ({ ...item, position: index }),
  // components/PackingListTable.tsx
  components_PackingListTable_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderWidth: 1, borderRadius: 6, minHeight: 36, backgroundColor: theme.colors.surface, borderColor: theme.colors.border }),
  // components/PackingListTable.tsx
  components_PackingListTable_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingHorizontal: 8, paddingVertical: 6, minHeight: 34 }),
  // components/PackingListTable.tsx
  components_PackingListTable_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const }),
  // components/PackingListTable.tsx
  components_PackingListTable_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PackingListTable.tsx
  components_PackingListTable_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_7: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1 }),
  // components/PackingListTable.tsx
  components_PackingListTable_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingHorizontal: 8, paddingVertical: 8 }),
  // components/PackingListTable.tsx
  components_PackingListTable_10: (_theme: AppTheme, { entry, pos }: ThemeStyleValues): any => ({ ...entry, position: pos }),
  // components/PackingListTable.tsx
  components_PackingListTable_11: (_theme: AppTheme, { entry, pos }: ThemeStyleValues): any => ({ ...entry, position: pos }),
  // components/PackingListTable.tsx
  components_PackingListTable_12: (_theme: AppTheme, { item, index }: ThemeStyleValues): any => ({ ...item, position: index }),
  // components/PackingListTable.tsx
  components_PackingListTable_13: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surface }),
  // components/PackingListTable.tsx
  components_PackingListTable_14: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PackingListTable.tsx
  components_PackingListTable_15: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surfaceMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_16: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PackingListTable.tsx
  components_PackingListTable_17: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // components/PackingListTable.tsx
  components_PackingListTable_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onCta }),
  // components/PackingListTable.tsx
  components_PackingListTable_19: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surfaceMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_20: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PackingListTable.tsx
  components_PackingListTable_21: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surfaceMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_22: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PackingListTable.tsx
  components_PackingListTable_23: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_24: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // components/PackingListTable.tsx
  components_PackingListTable_25: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border }),
  // components/PackingListTable.tsx
  components_PackingListTable_26: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText }),
  // components/PackingListTable.tsx
  components_PackingListTable_27: (_theme: AppTheme, { theme, source }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: source.active ? theme.colors.cta : theme.colors.surfaceMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_28: (_theme: AppTheme, { theme, source }: ThemeStyleValues): any => ({ color: source.active ? theme.colors.onCta : theme.colors.text }),
  // components/PackingListTable.tsx
  components_PackingListTable_29: (_theme: AppTheme, { theme, selectedPresetKeys, preset }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: selectedPresetKeys.includes(preset.key) ? theme.colors.cta : theme.colors.surfaceMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_30: (_theme: AppTheme, { theme, selectedPresetKeys, preset }: ThemeStyleValues): any => ({ color: selectedPresetKeys.includes(preset.key) ? theme.colors.onCta : theme.colors.text }),
  // components/PackingListTable.tsx
  components_PackingListTable_31: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border }),
  // components/PackingListTable.tsx
  components_PackingListTable_32: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_33: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_34: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_35: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.backgroundAlt }),
  // components/PackingListTable.tsx
  components_PackingListTable_36: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PackingListTable.tsx
  components_PackingListTable_37: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border }),
  // components/PackingListTable.tsx
  components_PackingListTable_38: (_theme: AppTheme, { localStyles, theme }: ThemeStyleValues): any => ({ ...localStyles.categorySelectWeb, color: theme.colors.text, backgroundColor: theme.colors.surface, borderColor: theme.colors.border }),
  // components/PackingListTable.tsx
  components_PackingListTable_39: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, color: theme.colors.text, backgroundColor: theme.colors.surface }),
  // components/PackingListTable.tsx
  components_PackingListTable_40: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PackingListTable.tsx
  components_PackingListTable_41: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border }),
  // components/PackingListTable.tsx
  components_PackingListTable_42: (_theme: AppTheme, { checked, theme }: ThemeStyleValues): any => ({ color: checked ? theme.colors.success : theme.colors.textMuted }),
  // components/PackingListTable.tsx
  components_PackingListTable_43: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // components/PackingListTable.tsx
  components_PackingListTable_44: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  container: { width: '100%', borderWidth: 1, borderRadius: 8, padding: 12, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8 },
  button: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  buttonText: { fontWeight: '700' },
  addButton: { borderWidth: 1, borderRadius: 6, padding: 10, alignSelf: 'flex-start' },
  addButtonText: { fontWeight: '700' },
  meta: { fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 44, flexShrink: 0 },
  headerRow: { minHeight: 36 },
  itemHeader: { width: 240, flexShrink: 0, padding: 8, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  travelerHeader: { width: 110, flexShrink: 0, padding: 8, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  editHeader: { width: 116, flexShrink: 0, padding: 8, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  categoryRow: { paddingHorizontal: 8, paddingVertical: 7, minHeight: 32 },
  categoryText: { fontWeight: '700' },
  itemCell: { width: 240, flexShrink: 0, padding: 8, gap: 6, justifyContent: 'center' },
  itemText: { fontSize: 15 },
  checkCell: { width: 110, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth },
  checkText: { fontSize: 20, fontWeight: '700' },
  editCell: { width: 116, flexShrink: 0, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  orderButton: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  orderText: { fontSize: 18, fontWeight: '700' },
  categorySelectWeb: { width: '100%', minHeight: 36, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, minHeight: 36 },
  // Constrain the horizontal viewport. Without an explicit width/flex
  // constraint React Native Web can size this ScrollView to its children,
  // leaving no overflow area to scroll.
  presetScroll: { width: '100%', maxWidth: '100%', minWidth: 0, flexGrow: 0, flexShrink: 1, alignSelf: 'stretch' },
  presetActions: { gap: 8, paddingVertical: 2, flexGrow: 0, flexShrink: 0, alignItems: 'center' },
  presetButton: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
})),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surface }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surface }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_7: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_9: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_10: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_11: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted ?? theme.colors.surface }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_12: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText ?? theme.colors.text, fontWeight: '700' }),
  // components/PackingPresetSelector.tsx
  components_PackingPresetSelector_13: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 14, marginVertical: 12, gap: 10 },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 13 },
  error: { color: _theme.colors.dangerText, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2, paddingRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12 },
  addButton: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7 },
})),
  // components/PasswordField.tsx
  components_PasswordField_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'relative' }),
  // components/PasswordField.tsx
  components_PasswordField_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingRight: 52 }),
  // components/PasswordField.tsx
  components_PasswordField_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 8 }),
  // components/PaymentDialog.tsx
  components_PaymentDialog_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 4 }),
  // components/PaymentDialog.tsx
  components_PaymentDialog_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'center' }),
  // components/PaymentDialog.tsx
  components_PaymentDialog_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // components/PaymentDialog.tsx
  components_PaymentDialog_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 480 }),
  // components/PaymentDialog.tsx
  components_PaymentDialog_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 12, paddingBottom: 8 }),
  // components/PaymentDialog.tsx
  components_PaymentDialog_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 4 }),
  // components/PaymentDialog.tsx
  components_PaymentDialog_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 4 }),
  // components/PaymentDialog.tsx
  components_PaymentDialog_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText }),
  // components/PaymentDialog.tsx
  components_PaymentDialog_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // components/PendingExpenseLogoutDialog.tsx
  components_PendingExpenseLogoutDialog_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, padding: 12 }),
  // components/PendingExpenseLogoutDialog.tsx
  components_PendingExpenseLogoutDialog_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, backgroundColor: _theme.colors.overlay, justifyContent: 'center', padding: 20 }),
  // components/PendingExpenseLogoutDialog.tsx
  components_PendingExpenseLogoutDialog_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 20, backgroundColor: _theme.colors.surface, borderRadius: 12, maxHeight: '100%' }),
  // components/PendingExpenseRecovery.tsx
  components_PendingExpenseRecovery_1: (_theme: AppTheme, { disabled, busy }: ThemeStyleValues): any => ({ minHeight: 44, padding: 8, justifyContent: 'center', opacity: disabled || busy ? 0.5 : 1 }),
  // components/PendingExpenseRecovery.tsx
  components_PendingExpenseRecovery_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 12 }),
  // components/PendingExpenseRecovery.tsx
  components_PendingExpenseRecovery_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // components/PendingExpenseRecovery.tsx
  components_PendingExpenseRecovery_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // components/PendingExpenseRecovery.tsx
  components_PendingExpenseRecovery_5: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ minHeight: 64, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8 }),
  // components/PermissionDeniedModal.tsx
  components_PermissionDeniedModal_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_2: (_theme: AppTheme, { active, theme, borderColor }: ThemeStyleValues): any => ({
              borderWidth: 1, borderColor: active ? (theme?.colors?.link ?? _theme.colors.accentBorder) : borderColor,
              backgroundColor: active ? (theme?.colors?.link ?? _theme.colors.accentSurface) : _theme.colors.transparent,
              borderRadius: 14, paddingVertical: 4, paddingHorizontal: 9, marginRight: 6,
            }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_3: (_theme: AppTheme, { active, textColor }: ThemeStyleValues): any => ({ color: active ? _theme.colors.onCta : textColor, fontSize: 12 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_4: (_theme: AppTheme, { borderColor }: ThemeStyleValues): any => ({ borderTopWidth: 1, borderTopColor: borderColor, paddingVertical: 8, flexDirection: 'row' }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 48, height: 48, borderRadius: 6, marginRight: 10, backgroundColor: _theme.colors.surfaceMuted, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 48, height: 48 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 18 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_10: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 13, flex: 1 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingHorizontal: 8, minHeight: 28, justifyContent: 'center' }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_12: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 15 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_13: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.mode === 'dark' ? _theme.colors.dangerText : _theme.colors.dangerText, fontSize: 11, marginTop: 2 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_14: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 11, marginTop: 2 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_15: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 11, marginTop: 2 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, backgroundColor: _theme.colors.scrim, justifyContent: 'flex-end' }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_17: (_theme: AppTheme, { backgroundColor }: ThemeStyleValues): any => ({ backgroundColor, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '88%', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_19: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 17, fontWeight: '700' }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_20: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 18 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_21: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 40, alignItems: 'center' }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 24 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_23: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 14 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_25: (_theme: AppTheme, { overQuota, theme, mutedColor }: ThemeStyleValues): any => ({ color: overQuota ? (theme?.mode === 'dark' ? _theme.colors.dangerText : _theme.colors.dangerText) : mutedColor, fontSize: 12, marginBottom: 8 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_26: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12, marginBottom: 8 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexGrow: 0 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_28: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.mode === 'dark' ? _theme.colors.dangerText : _theme.colors.dangerText, fontSize: 12, fontWeight: '600', marginBottom: 4 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_29: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_30: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 13, fontWeight: '700' }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_31: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.mode === 'dark' ? _theme.colors.dangerText : _theme.colors.dangerText, fontSize: 12, marginTop: 10 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_32: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, marginTop: 14 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_33: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.5 }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_34: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_35: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_36: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_37: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_38: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.border),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_39: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/PhotoFirstComposer.tsx
  components_PhotoFirstComposer_40: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.linkText),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_1: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.surface }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_2: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_3: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_4: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_5: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors.surface, borderColor: colors.border }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_6: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ borderColor: colors.border }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_7: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_8: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_9: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_10: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_11: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_12: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_13: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors?.text }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_14: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_15: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_17: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors.textMuted }),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_18: (_theme: AppTheme, { StyleSheet, shadowStyle }: ThemeStyleValues): any => (StyleSheet.create({
  overlay: { flex: 1, backgroundColor: _theme.colors.scrim, justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 420, maxHeight: '100%', minHeight: 0, flexShrink: 1, backgroundColor: _theme.colors.surface, borderRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: _theme.colors.text, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: _theme.colors.text, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: _theme.colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: _theme.colors.text, backgroundColor: _theme.colors.surface,
  },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  error: { color: _theme.colors.dangerText, fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  btnGhost: { paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 6 },
  btnGhostText: { color: _theme.colors.text, fontWeight: '600' },
  btnPrimary: { backgroundColor: _theme.colors.accentAction, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 6 },
  btnPrimaryText: { color: _theme.colors.onAccent, fontWeight: '700' },
  autocompleteWrap: { position: 'relative', zIndex: 20 },
  autocompleteInputRow: { flexDirection: 'row', alignItems: 'center' },
  autocompleteInput: { flex: 1 },
  loadingIndicator: { marginLeft: 8 },
  searchHint: { fontSize: 11, color: _theme.colors.text, marginTop: -2 },
  dropdownList: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: _theme.colors.surface,
    borderWidth: 1,
    borderColor: _theme.colors.border,
    borderRadius: 8,
    maxHeight: 220,
    overflow: 'hidden',
    zIndex: 30,
    elevation: 12,
    ...shadowStyle(_theme.colors.surfaceMuted, 0.18, 0, 4, 10),
  },
  dropdownOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: _theme.colors.border,
  },
  dropdownOptionPressed: { backgroundColor: _theme.colors.surfaceMuted },
  dropdownOptionText: { fontSize: 14, color: _theme.colors.text, fontWeight: '500' },
  dropdownOptionHelper: { fontSize: 11, color: _theme.colors.text, marginTop: 2 },
})),
  // components/PlacePickerDialog.tsx
  components_PlacePickerDialog_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_1: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ padding: spacing.xl }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_2: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ padding: spacing.xl, alignItems: 'center' }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_3: (_theme: AppTheme, { colors, typography }: ThemeStyleValues): any => ({ color: colors.textMuted, fontSize: typography.body }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 500 }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_5: (_theme: AppTheme, { spacing, colors }: ThemeStyleValues): any => ({
                padding: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_7: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ fontWeight: 'bold', color: colors.text }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_8: (_theme: AppTheme, { typography, colors }: ThemeStyleValues): any => ({ fontSize: typography.small, color: colors.textMuted }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_9: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ alignItems: 'flex-end', marginLeft: spacing.md }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_10: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ fontWeight: 'bold', color: colors.text }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_11: (_theme: AppTheme, { colors, spacing }: ThemeStyleValues): any => ({
                    backgroundColor: colors.cta,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    borderRadius: 4,
                    marginTop: spacing.xs,
                  }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_12: (_theme: AppTheme, { typography }: ThemeStyleValues): any => ({ color: _theme.colors.onCta, fontWeight: 'bold', fontSize: typography.small }),
  // components/PlaidImportQueue.tsx
  components_PlaidImportQueue_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onCta),
  // components/PlaidLinkButton.tsx
  components_PlaidLinkButton_1: (_theme: AppTheme, { colors, spacing }: ThemeStyleValues): any => ({
          backgroundColor: colors.cta,
          paddingVertical: spacing.md,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
        }),
  // components/PlaidLinkButton.tsx
  components_PlaidLinkButton_2: (_theme: AppTheme, { typography }: ThemeStyleValues): any => ({ color: _theme.colors.onCta, fontWeight: 'bold', fontSize: typography.body }),
  // components/PlaidLinkButton.tsx
  components_PlaidLinkButton_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onCta),
  // components/PremiumPlanComparisonDialog.tsx
  components_PremiumPlanComparisonDialog_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxHeight: '92%' }),
  // components/PremiumPlanComparisonDialog.tsx
  components_PremiumPlanComparisonDialog_2: (_theme: AppTheme, { isCompact }: ThemeStyleValues): any => ({ maxHeight: isCompact ? 380 : 480 }),
  // components/PremiumPlanComparisonDialog.tsx
  components_PremiumPlanComparisonDialog_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingBottom: 8 }),
  // components/PremiumPlanComparisonDialog.tsx
  components_PremiumPlanComparisonDialog_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onCta),
  // components/PremiumSubscriptionPanel.tsx
  components_PremiumSubscriptionPanel_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    container: {
      marginVertical: 12,
      padding: 16,
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    sectionTitle: {
      fontSize: theme.typography.h3,
      fontWeight: theme.typography.weightSemibold,
      color: theme.colors.text,
      marginBottom: 10,
    },
    statusRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    badge: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 12,
    },
    badgeActive: {
      backgroundColor: theme.colors.premiumAction, // Previously premium
    },
    badgeText: {
      color: _theme.colors.onAccent,
      fontSize: theme.typography.small,
      fontWeight: theme.typography.weightSemibold,
    },
    statusNote: {
      fontSize: theme.typography.small,
      color: theme.colors.textMuted,
    },
    notificationList: {
      gap: 8,
      marginBottom: 12,
    },
    notificationItem: {
      borderWidth: 1,
      borderColor: theme.colors.warning,
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: 8,
      padding: 10,
      gap: 4,
    },
    notificationTitle: {
      fontSize: theme.typography.small,
      color: theme.colors.text,
      fontWeight: theme.typography.weightSemibold,
    },
    notificationMessage: {
      fontSize: theme.typography.small,
      color: theme.colors.textMuted,
    },
    successBanner: {
      borderWidth: 1,
      borderColor: theme.colors.success,
      backgroundColor: theme.colors.surfaceMuted,
      borderRadius: 8,
      padding: 10,
      marginBottom: 12,
      gap: 8,
    },
    successText: {
      fontSize: theme.typography.small,
      color: theme.colors.text,
    },
    dismissText: {
      fontSize: theme.typography.small,
      color: theme.colors.linkText,
      fontWeight: theme.typography.weightSemibold,
    },
    warning: {
      color: theme.colors.warningText,
    },
    error: {
      color: theme.colors.dangerText,
    },
    pitch: {
      fontSize: theme.typography.body,
      color: theme.colors.text,
      marginBottom: 12,
      lineHeight: 22,
    },
    planRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 14,
    },
    planCard: {
      flex: 1,
      minWidth: 180,
      maxWidth: '100%',
      borderWidth: 2,
      borderColor: theme.colors.border,
      borderRadius: 10,
      padding: 12,
      alignItems: 'center',
    },
    planCardSelected: {
      borderColor: theme.colors.premium,
    },
    planInterval: {
      fontSize: theme.typography.small,
      fontWeight: theme.typography.weightSemibold,
      color: theme.colors.text,
      marginBottom: 2,
    },
    planPrice: {
      fontSize: theme.typography.h3,
      fontWeight: theme.typography.weightBold,
      color: theme.colors.text,
    },
    planTrial: {
      fontSize: theme.typography.caption,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    ctaButton: {
      backgroundColor: theme.colors.premiumAction, // Previously premium
      borderRadius: 8,
      paddingVertical: 13,
      alignItems: 'center',
      marginBottom: 10,
    },
    ctaButtonDisabled: {
      opacity: 0.6,
    },
    ctaText: {
      color: _theme.colors.onAccent,
      fontSize: theme.typography.body,
      fontWeight: theme.typography.weightSemibold,
    },
    manageButton: {
      marginTop: 4,
      alignItems: 'center',
      paddingVertical: 8,
    },
    manageText: {
      color: theme.colors.linkText,
      fontSize: theme.typography.small,
    },
    errorText: {
      marginTop: 8,
      color: theme.colors.dangerText,
      fontSize: theme.typography.small,
    },
  }),
  // components/PremiumSubscriptionPanel.tsx
  components_PremiumSubscriptionPanel_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onAccent),
  // components/PresenceAvatars.tsx
  components_PresenceAvatars_1: (_theme: AppTheme, { user, idx, OVERLAP, theme }: ThemeStyleValues): any => ({ backgroundColor: avatarColor(user.userId), marginLeft: idx === 0 ? 0 : -OVERLAP, borderColor: theme?.colors.background ?? _theme.colors.border }),
  // components/PresenceAvatars.tsx
  components_PresenceAvatars_2: (_theme: AppTheme, { OVERLAP, theme }: ThemeStyleValues): any => ({ marginLeft: -OVERLAP, borderColor: theme?.colors.background ?? _theme.colors.border }),
  // components/PresenceAvatars.tsx
  components_PresenceAvatars_3: (_theme: AppTheme, { StyleSheet, AVATAR_SIZE }: ThemeStyleValues): any => (StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: _theme.colors.border,
  },
  overflow: {
    backgroundColor: _theme.colors.surfaceMuted,
  },
  initials: {
    color: _theme.colors.onAccent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
})),
  // components/PrivacySettings.tsx
  components_PrivacySettings_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surface, borderColor: theme.colors.border }),
  // components/PrivacySettings.tsx
  components_PrivacySettings_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surface }),
  // components/PrivacySettings.tsx
  components_PrivacySettings_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PrivacySettings.tsx
  components_PrivacySettings_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PrivacySettings.tsx
  components_PrivacySettings_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/PrivacySettings.tsx
  components_PrivacySettings_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }),
  // components/PrivacySettings.tsx
  components_PrivacySettings_7: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/PrivacySettings.tsx
  components_PrivacySettings_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.mode === 'dark' ? _theme.colors.dangerText : _theme.colors.dangerText }),
  // components/PrivacySettings.tsx
  components_PrivacySettings_9: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  card: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 10, marginVertical: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  text: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowText: { flex: 1 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { borderWidth: 1, padding: 10, borderRadius: 8, minWidth: 92, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontWeight: '600' },
  disabled: { opacity: 0.5 },
  overlay: { flex: 1, backgroundColor: _theme.colors.overlay, justifyContent: 'center', padding: 16 },
  dialog: { borderRadius: 12, maxWidth: 520, width: '100%', alignSelf: 'center', maxHeight: '100%' },
  dialogContent: { padding: 20, gap: 12 },
})),
  // components/PrivacySettings.tsx
  components_PrivacySettings_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/PrivacySettings.tsx
  components_PrivacySettings_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/PrivacySettings.tsx
  components_PrivacySettings_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_2: (_theme: AppTheme, { selectedReaction, emoji }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', marginRight: 8, marginBottom: 6, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 16, borderWidth: 1, borderColor: selectedReaction === emoji ? _theme.colors.accentBorder : _theme.colors.border, backgroundColor: selectedReaction === emoji ? _theme.colors.surfaceMuted : _theme.colors.surface }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 16 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_4: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 13, color: _theme.colors.text, marginLeft: 4 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_5: (_theme: AppTheme, { cursor }: ThemeStyleValues): any => ({ cursor }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: _theme.colors.border }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 4 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_9: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 13, color: _theme.colors.linkText }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_10: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 13, color: _theme.colors.dangerText }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 14 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_12: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 13, color: _theme.colors.text }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 14 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_14: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 12, color: _theme.colors.textMuted, marginBottom: 3 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_15: (_theme: AppTheme, { bodyFont, comment }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 15, lineHeight: 22, color: comment.deletedAt || comment.body == null ? _theme.colors.textMuted : _theme.colors.text, fontStyle: comment.deletedAt || comment.body == null ? 'italic' : 'normal' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_16: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 12, color: _theme.colors.textMuted, marginTop: 3 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_17: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 13, color: _theme.colors.linkText, marginTop: 2 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_18: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 13, color: _theme.colors.text, marginTop: 4 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_19: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 13, color: _theme.colors.text }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: '100vh' as any, backgroundColor: _theme.colors.surface, alignItems: 'center', justifyContent: 'center' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_21: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: '100vh' as any, backgroundColor: _theme.colors.surface, alignItems: 'center', justifyContent: 'center', padding: 24 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_22: (_theme: AppTheme, { displayFont }: ThemeStyleValues): any => ({ fontFamily: displayFont, fontSize: 26, color: _theme.colors.linkText, marginBottom: 8, textAlign: 'center' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.text, fontSize: 15, textAlign: 'center', maxWidth: 420 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: '100vh' as any, backgroundColor: _theme.colors.surface, alignItems: 'center', justifyContent: 'center', padding: 24 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_25: (_theme: AppTheme, { displayFont }: ThemeStyleValues): any => ({ fontFamily: displayFont, fontSize: 22, color: _theme.colors.linkText, marginBottom: 8, textAlign: 'center' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_26: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.text, fontSize: 15, textAlign: 'center', maxWidth: 420 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8, marginBottom: 12 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText, fontSize: 13 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_29: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 40, paddingTop: 40, borderTopWidth: 1, borderTopColor: _theme.colors.border }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_30: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', color: _theme.colors.linkText, marginBottom: 6 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_31: (_theme: AppTheme, { displayFont, day }: ThemeStyleValues): any => ({ fontFamily: displayFont, fontSize: 26, color: _theme.colors.linkText, marginBottom: day.summary ? 6 : 16 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_32: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.text, fontSize: 15, marginBottom: 16 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_33: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 16 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_34: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 17, lineHeight: 28, color: _theme.colors.text }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_35: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 20 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_36: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', aspectRatio: 3 / 2, borderRadius: 10, backgroundColor: _theme.colors.surfaceMuted }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_37: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.text, fontSize: 13, marginTop: 6, fontStyle: 'italic' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_38: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 20 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_39: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', borderRadius: 10, display: 'block', backgroundColor: _theme.colors.surfaceMuted }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_40: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.text, fontSize: 13, marginTop: 6, fontStyle: 'italic' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_41: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, backgroundColor: _theme.colors.surface }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_42: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', aspectRatio: 16 / 7, backgroundColor: _theme.colors.accentSurface }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_43: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', height: '100%' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_44: (_theme: AppTheme, { coverPhoto }: ThemeStyleValues): any => ({ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 24, paddingTop: coverPhoto ? 36 : 64, paddingBottom: 72 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_45: (_theme: AppTheme, { displayFont, blog }: ThemeStyleValues): any => ({ fontFamily: displayFont, fontSize: 40, lineHeight: 46, color: _theme.colors.linkText, marginBottom: blog.subtitle ? 8 : 20 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_46: (_theme: AppTheme, { displayFontItalic }: ThemeStyleValues): any => ({ fontFamily: displayFontItalic, fontSize: 18, color: _theme.colors.text, marginBottom: 20 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_47: (_theme: AppTheme, { bodyDisplayFont }: ThemeStyleValues): any => ({ fontFamily: bodyDisplayFont, fontSize: 18, lineHeight: 30, color: _theme.colors.text, marginBottom: 40 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_48: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 40, flexDirection: 'row', alignItems: 'center', gap: 12 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_49: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, height: 1, backgroundColor: _theme.colors.surfaceMuted }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_50: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12, fontWeight: '600', letterSpacing: 0.5, color: _theme.colors.textMuted }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_51: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, height: 1, backgroundColor: _theme.colors.surfaceMuted }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_52: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.text, fontSize: 15, marginTop: 20 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_53: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 64, paddingTop: 24, borderTopWidth: 1, borderTopColor: _theme.colors.border, alignItems: 'center' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_54: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.textMuted, fontSize: 12 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_55: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.linkText),
  // tabs/LodgingTab.tsx — nudge on a template placeholder hotel
  tabs_LodgingTab_nudge: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12, fontWeight: '700', color: _theme.colors.warningText, marginTop: 2 }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 10 }),
  // components/TripTemplatePicker.tsx
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 240, height: 160, borderRadius: 10, backgroundColor: _theme.colors.surfaceMuted }),
  components_TripTemplatePicker_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 128, height: 96, borderRadius: 8, backgroundColor: _theme.colors.surfaceMuted }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor: _theme.colors.border, borderRadius: 12, overflow: 'hidden', backgroundColor: _theme.colors.surface, marginTop: 10 }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', height: 140, backgroundColor: _theme.colors.surfaceMuted }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 12, gap: 6 }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderRadius: 999, borderWidth: 1, borderColor: _theme.colors.border, paddingHorizontal: 10, paddingVertical: 4 }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, backgroundColor: _theme.colors.background, padding: 16 }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 14, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: _theme.colors.border }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, paddingVertical: 4 }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 48 }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12, fontWeight: '700', color: _theme.colors.warningText }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingTop: 12, gap: 8, borderTopWidth: 1, borderTopColor: _theme.colors.border }),
  // components/TripTemplatePicker.tsx
  components_TripTemplatePicker_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.5 }),
  // components/ExpenseReceiptPanel.tsx
  components_ExpenseReceiptPanel_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ display: 'none' }),
  // components/ExpenseReceiptPanel.tsx
  components_ExpenseReceiptPanel_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', height: 320, backgroundColor: _theme.colors.surfaceMuted }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_57: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ minHeight: 72, borderWidth: 1, borderColor: _theme.colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, fontFamily: bodyFont, fontSize: 15, color: _theme.colors.text, textAlignVertical: 'top' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_58: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, minWidth: 80, borderRadius: 8, backgroundColor: _theme.colors.link, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, alignSelf: 'flex-start' }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_59: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 14, fontWeight: '700', color: _theme.colors.onAccent }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_60: (_theme: AppTheme, { bodyFont }: ThemeStyleValues): any => ({ fontFamily: bodyFont, fontSize: 12, color: _theme.colors.linkText, marginTop: 2 }),
  // components/PublicTripBlogPage.tsx
  components_PublicTripBlogPage_56: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.linkText),
  // components/ReactionBar.tsx
  components_ReactionBar_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/ReactionBar.tsx
  components_ReactionBar_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // components/ReactionBar.tsx
  components_ReactionBar_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // components/ReactionBar.tsx
  components_ReactionBar_4: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    // Neutral grey rather than a black tint: a pure-black overlay all but
    // disappears against a dark-mode surface, leaving the chip outline (and
    // the near-black `count`/`countActive` text below, when no `theme` is
    // supplied) unreadable. Grey keeps some contrast on either background.
    borderColor: _theme.colors.overlay,
    backgroundColor: _theme.colors.overlay,
  },
  buttonActiveUp: {
    backgroundColor: _theme.colors.overlay,
    borderColor: _theme.colors.overlay,
  },
  buttonActiveDown: {
    backgroundColor: _theme.colors.overlay,
    borderColor: _theme.colors.overlay,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  glyph: {
    fontSize: 14,
  },
  glyphActive: {
    fontSize: 14,
  },
  // These are only a fallback for a caller that omits `theme` — the current
  // (only) production caller always passes it, and `themedStyles` above
  // takes over with theme-aware colors whenever it's present. A mid-grey
  // fallback, rather than near-black, keeps some legibility in dark mode
  // too instead of assuming a light background.
  count: {
    fontSize: 12,
    fontWeight: '600',
    color: _theme.colors.text,
  },
  countActive: {
    color: _theme.colors.text,
  },
  score: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: _theme.colors.text,
  },
})),
  // components/RetryableErrorBanner.tsx
  components_RetryableErrorBanner_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
  paddingVertical: 10,
  paddingHorizontal: 12,
  backgroundColor: _theme.colors.dangerAction,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
}),
  // components/RetryableErrorBanner.tsx
  components_RetryableErrorBanner_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
  color: _theme.colors.onAccent,
  fontSize: 13,
  fontWeight: '500',
  flex: 1,
}),
  // components/RetryableErrorBanner.tsx
  components_RetryableErrorBanner_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 6,
  backgroundColor: _theme.colors.surface,
}),
  // components/RetryableErrorBanner.tsx
  components_RetryableErrorBanner_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
  color: _theme.colors.text,
  fontSize: 13,
  fontWeight: '700',
}),
  // components/RetryableErrorBanner.tsx
  components_RetryableErrorBanner_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // components/RetryableErrorBanner.tsx
  components_RetryableErrorBanner_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_1: (_theme: AppTheme, { controller }: ThemeStyleValues): any => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, opacity: controller.disabled ? 0.5 : 1 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_2: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors?.cta ?? _theme.colors.cta, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const, minHeight: 44 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_3: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ backgroundColor: colors?.surfaceMuted ?? _theme.colors.surfaceMuted, borderWidth: 1, borderColor: colors?.border ?? _theme.colors.border, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const, minHeight: 44 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onCta, fontWeight: '700' as const }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_5: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ color: colors?.text ?? _theme.colors.text, fontWeight: '700' as const }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'fixed' }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute' }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ left: 0, right: 0, bottom: 0, zIndex: 60, paddingHorizontal: 12, paddingBottom: 12, alignItems: 'center' }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_9: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ width: '100%', maxWidth: 720, gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, backgroundColor: colors?.surface ?? _theme.colors.surface, borderColor: colors?.border ?? _theme.colors.border, shadowColor: _theme.colors.scrim, shadowOpacity: 0.25, shadowRadius: 12, elevation: 8 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 10 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }),
  // components/SaveTripOffline.tsx
  components_SaveTripOffline_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/SelectField.tsx
  components_SelectField_1: (_theme: AppTheme, { styles, webStyle }: ThemeStyleValues): any => ({
      ...(styles.input ?? {}),
      ...(webStyle ?? {}),
      color: webStyle?.color ?? styles.cellText?.color ?? styles.input?.color,
      backgroundColor: webStyle?.backgroundColor ?? styles.input?.backgroundColor,
      borderColor: webStyle?.borderColor ?? styles.input?.borderColor,
      colorScheme: _theme.mode,
    }),
  // components/SelectField.tsx
  components_SelectField_2: (_theme: AppTheme, { themedWebStyle }: ThemeStyleValues): any => ({ color: themedWebStyle.color, backgroundColor: themedWebStyle.backgroundColor }),
  // components/SelectField.tsx
  components_SelectField_3: (_theme: AppTheme, { themedWebStyle }: ThemeStyleValues): any => ({ color: themedWebStyle.color, backgroundColor: themedWebStyle.backgroundColor }),
  // components/SelectField.tsx
  components_SelectField_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: _theme.colors.scrim }),
  // components/SelectField.tsx
  components_SelectField_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }),
  // components/SelectField.tsx
  components_SelectField_6: (_theme: AppTheme, { styles }: ThemeStyleValues): any => ({ backgroundColor: styles.input?.backgroundColor ?? _theme.colors.surface, borderRadius: 12, padding: 12, width: '100%', maxWidth: 520, maxHeight: '100%', alignSelf: 'center' }),
  // components/SelectField.tsx
  components_SelectField_7: (_theme: AppTheme, { styles }: ThemeStyleValues): any => ({ borderColor: styles.input?.borderColor, borderWidth: 1 }),
  // components/SelectField.tsx
  components_SelectField_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700', marginBottom: 8 }),
  // components/SelectField.tsx
  components_SelectField_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'relative', top: 0, left: 0, right: 0, bottom: 0, flexShrink: 1 }),
  // components/SelectField.tsx
  components_SelectField_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexGrow: 1 }),
  // components/SelectField.tsx
  components_SelectField_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 12 }),
  // components/ShareTripModal.tsx
  components_ShareTripModal_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center' }),
  // components/ShareTripModal.tsx
  components_ShareTripModal_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 72, textAlignVertical: 'top' }),
  // components/ShareTripModal.tsx
  components_ShareTripModal_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 180 }),
  // components/ShareTripModal.tsx
  components_ShareTripModal_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center' }),
  // components/ShareTripModal.tsx
  components_ShareTripModal_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 180 }),
  // components/ShareTripModal.tsx
  components_ShareTripModal_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between', alignItems: 'center' }),
  // components/Skeleton.tsx
  components_Skeleton_1: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  base: {
    backgroundColor: _theme.colors.surfaceMuted,
    borderRadius: 8,
    overflow: 'hidden',
    opacity: 0.8,
  },
})),
  // components/ThemedText.tsx
  components_ThemedText_1: (_theme: AppTheme, { color }: ThemeStyleValues): any => ({ color }),
  // components/TransferDirections.tsx
  components_TransferDirections_1: (_theme: AppTheme, { compact }: ThemeStyleValues): any => ({ gap: 4, marginVertical: compact ? 0 : 12 }),
  // components/TransferDirections.tsx
  components_TransferDirections_2: (_theme: AppTheme, { route }: ThemeStyleValues): any => ({ minHeight: 44, opacity: route ? 1 : 0.45 }),
  // components/TransferDirections.tsx
  components_TransferDirections_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? _theme.colors.border,
    backgroundColor: theme?.colors.surface ?? _theme.colors.surface,
  }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    backgroundColor: theme ? (theme.mode === 'dark' ? _theme.colors.accentAction : _theme.colors.surfaceMuted) : _theme.colors.surfaceMuted,
    borderColor: theme?.colors.link ?? _theme.colors.border,
  }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text ?? _theme.colors.text, fontWeight: '600' }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text ?? _theme.colors.text }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 200, flex: 1 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexGrow: 0, flexShrink: 0, flexBasis: 190, minWidth: 190, maxWidth: 240 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexGrow: 0, flexShrink: 0, flexBasis: 180, minWidth: 180, maxWidth: 220 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 240, flexGrow: 1, flexBasis: 0 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
    backgroundColor: _theme.colors.overlay,
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 16,
    paddingTop: 24,
  }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 0, maxHeight: '100%' as const }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexShrink: 1 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 420 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingRight: 12, paddingBottom: 8 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_21: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 120 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 120 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_26: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 90, maxWidth: 140 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 90, maxWidth: 140 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_29: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_30: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_31: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_32: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_33: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.transparent, zIndex: 56000, elevation: 90 }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_34: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.transparent }),
  // components/TransferEditingForm.tsx
  components_TransferEditingForm_35: (_theme: AppTheme, { airportAnchor }: ThemeStyleValues): any => ({
                zIndex: 57000,
                elevation: 94,
                left: airportAnchor.x,
                top: airportAnchor.y + airportAnchor.height,
                width: airportAnchor.width || 280,
              }),
  // components/TripDayMap.tsx
  components_TripDayMap_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
  flight: { label: 'Flight', color: _theme.colors.linkText },
  lodging: { label: 'Lodging', color: _theme.colors.dangerText },
  activity: { label: 'Activity', color: _theme.colors.successText },
  car_rental: { label: 'Car rental', color: _theme.colors.premiumText },
}),
  // components/TripDayMap.tsx
  components_TripDayMap_2: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  wrap: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 8,
  },
  image: {
    width: '100%',
    aspectRatio: 640 / 400,
  },
  legend: {
    backgroundColor: _theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: _theme.colors.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  legendTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: _theme.colors.text,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: 8,
    columnGap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: _theme.colors.text,
  },
  legendNote: {
    fontSize: 11,
    color: _theme.colors.text,
    fontStyle: 'italic',
  },
})),
  // components/TripDayMap.tsx
  components_TripDayMap_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onAccent),
  // components/TripDayMap.tsx
  components_TripDayMap_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.onAccent),
  // components/TripItemDetailsDialog.tsx
  components_TripItemDetailsDialog_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
    card: {
      width: '100%',
      maxWidth: 520,
      maxHeight: '92%',
      borderRadius: 16,
      padding: 0,
      overflow: 'hidden',
    },
    header: {
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme?.colors.border ?? _theme.colors.border,
    },
    headerLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    title: { flex: 1, fontSize: 20, fontWeight: '700', color: theme?.colors.text ?? _theme.colors.text },
    subtitle: { marginTop: 4, color: theme?.colors.textMuted ?? _theme.colors.text },
    status: {
      borderWidth: 1,
      borderColor: theme?.colors.border ?? _theme.colors.border,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    statusText: { color: theme?.colors.text ?? _theme.colors.text, fontSize: 12, fontWeight: '600' },
    close: { padding: 4 },
    closeText: { fontSize: 18, color: theme?.colors.textMuted ?? _theme.colors.text },
    body: { paddingHorizontal: 18, paddingVertical: 12 },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 7 },
    label: { width: 125, color: theme?.colors.text ?? _theme.colors.text, fontWeight: '700', fontSize: 13 },
    value: { flex: 1, color: theme?.colors.text ?? _theme.colors.text, fontSize: 13 },
    footer: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: theme?.colors.border ?? _theme.colors.border },
    actionGroup: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  }),
  // components/TripItemDetailsDialog.tsx
  components_TripItemDetailsDialog_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexShrink: 1 }),
  // components/TripItemDetailsDialog.tsx
  components_TripItemDetailsDialog_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/TripMap.tsx
  components_TripMap_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // components/TripMap.tsx
  components_TripMap_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/TripMap.tsx
  components_TripMap_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ height: 360 }),
  // components/TripMap.tsx
  components_TripMap_4: (_theme: AppTheme, { bounds }: ThemeStyleValues): any => ({ ...bounds!, paddingTop: 45, paddingBottom: 45, paddingLeft: 45, paddingRight: 45 }),
  // components/TripMap.tsx
  components_TripMap_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/TripMap.tsx
  components_TripMap_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/TripMap.tsx
  components_TripMap_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.accentSurface),
  // components/TripMap.tsx
  components_TripMap_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/TripMap.tsx
  components_TripMap_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/TripMap.tsx
  components_TripMap_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/TripMap.web.tsx
  components_TripMap_web_1: (_theme: AppTheme, { COLORS, point }: ThemeStyleValues): any => ({ background: COLORS[point.kind], color: _theme.colors.onAccent, border: '2px solid white', borderRadius: '50%', width: '44px', height: '44px', cursor: 'pointer', fontWeight: 'bold' }),
  // components/TripMap.web.tsx
  components_TripMap_web_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 60, maxZoom: 15, duration: 0 }),
  // components/TripMap.web.tsx
  components_TripMap_web_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // components/TripMap.web.tsx
  components_TripMap_web_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/TripMap.web.tsx
  components_TripMap_web_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center' }),
  // components/TripMap.web.tsx
  components_TripMap_web_6: (_theme: AppTheme, { width }: ThemeStyleValues): any => ({ display: 'flex', flexDirection: width >= 1024 ? 'row' : 'column-reverse', gap: 16 }),
  // components/TripMap.web.tsx
  components_TripMap_web_7: (_theme: AppTheme, { colors, FONT_STACK, width }: ThemeStyleValues): any => ({ flex: 1, margin: 0, padding: '0 0 0 24px', color: colors.text, fontFamily: FONT_STACK, fontSize: 14, lineHeight: 1.4, maxHeight: width >= 1024 ? 400 : undefined, overflowY: 'auto' }),
  // components/TripMap.web.tsx
  components_TripMap_web_8: (_theme: AppTheme, { colors, selected, point }: ThemeStyleValues): any => ({ minHeight: 44, width: '100%', textAlign: 'left', color: colors.text, font: 'inherit', background: selected === point.id ? colors.surfaceMuted : _theme.colors.transparent, border: selected === point.id ? `1px solid ${colors.border}` : '1px solid transparent', borderRadius: 6, cursor: 'pointer', padding: 8 }),
  // components/TripMap.web.tsx
  components_TripMap_web_9: (_theme: AppTheme, { colors }: ThemeStyleValues): any => ({ display: 'block', color: colors.textMuted }),
  // components/TripMap.web.tsx
  components_TripMap_web_10: (_theme: AppTheme, { failed, resolved }: ThemeStyleValues): any => ({ flex: failed ? 0 : 2, minHeight: failed ? 0 : 360, height: failed ? 0 : 400, display: !resolved.length ? 'none' : 'block', borderRadius: 12, overflow: 'hidden' }),
  // components/TripMap.web.tsx
  components_TripMap_web_11: (_theme: AppTheme, { linkTextColor, theme }: ThemeStyleValues): any => ({ minHeight: 24, color: linkTextColor(theme) }),
  // components/TripMap.web.tsx
  components_TripMap_web_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flight: _theme.colors.accentSurface, lodging: _theme.colors.dangerAction, activity: _theme.colors.successAction, car_rental: _theme.colors.premiumAction }),
  // components/TripMap.web.tsx
  components_TripMap_web_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // components/TripRecapCards.tsx
  components_TripRecapCards_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'flex-end' }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 6, paddingHorizontal: 10 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_3: (_theme: AppTheme, { onDark, accentColor }: ThemeStyleValues): any => ({ color: onDark ? _theme.colors.onAccent : accentColor, fontWeight: '700' }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_4: (_theme: AppTheme, { onDark, mutedColor }: ThemeStyleValues): any => ({ color: onDark ? _theme.colors.onAccent : mutedColor, fontSize: 11, paddingRight: 4 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_5: (_theme: AppTheme, { backgroundColor, borderColor }: ThemeStyleValues): any => ({ borderRadius: 16, overflow: 'hidden', backgroundColor, marginBottom: 16, borderWidth: 1, borderColor }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 240, justifyContent: 'flex-end' }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 16 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_11: (_theme: AppTheme, { displayFont }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 26, fontFamily: displayFont, marginTop: 2 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_12: (_theme: AppTheme, { displayFontItalic }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, marginTop: 3, fontFamily: displayFontItalic }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, marginTop: 6 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.overlay, borderRadius: 8 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_15: (_theme: AppTheme, { displayFontItalic }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, marginTop: 8, fontSize: 12, fontFamily: displayFontItalic }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_18: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_19: (_theme: AppTheme, { textColor, displayFont }: ThemeStyleValues): any => ({ color: textColor, fontSize: 24, fontFamily: displayFont, marginTop: 2 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_20: (_theme: AppTheme, { mutedColor, displayFontItalic }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 3, fontFamily: displayFontItalic }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_21: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 6 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_22: (_theme: AppTheme, { heroUrl }: ThemeStyleValues): any => ({ padding: 16, paddingTop: heroUrl ? 14 : 4 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_23: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, marginTop: 4 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_24: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, marginTop: 6 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_25: (_theme: AppTheme, { borderColor }: ThemeStyleValues): any => ({ marginTop: 12, borderTopWidth: 1, borderTopColor: borderColor, paddingTop: 10 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_26: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '800', marginBottom: 5 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_27: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_28: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, marginTop: 4 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_29: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, marginTop: 4 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_30: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, marginTop: 10, fontWeight: '700' }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_31: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_32: (_theme: AppTheme, { accentColor }: ThemeStyleValues): any => ({ color: accentColor, fontWeight: '700' }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_33: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 11, marginTop: 10 }),
  // components/TripRecapCards.tsx
  components_TripRecapCards_34: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // components/TripRecapCards.tsx
  components_TripRecapCards_35: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted),
  // components/TripRecapCards.tsx
  components_TripRecapCards_36: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.border),
  // components/TripRecapCards.tsx
  components_TripRecapCards_37: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // components/TripRecapCards.tsx
  components_TripRecapCards_38: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.accentAction),
  // components/TripRecapCards.tsx
  components_TripRecapCards_39: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.overlay),
  // components/TripRecapCards.tsx
  components_TripRecapCards_40: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.overlay),
  // components/TripRecapCards.tsx
  components_TripRecapCards_41: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.overlay),
  // components/TripsLikeThis.tsx
  components_TripsLikeThis_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 12, gap: 10 }),
  // components/TripsLikeThis.tsx
  components_TripsLikeThis_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 18, fontWeight: '700' }),
  // components/TripsLikeThis.tsx
  components_TripsLikeThis_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // components/TripsLikeThis.tsx
  components_TripsLikeThis_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/TripsLikeThis.tsx
  components_TripsLikeThis_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // components/TripsLikeThis.tsx
  components_TripsLikeThis_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 4 }),
  // components/TripsLikeThis.tsx
  components_TripsLikeThis_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/TripsLikeThis.tsx
  components_TripsLikeThis_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // components/TripsLikeThis.tsx
  components_TripsLikeThis_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // tabs/account.tsx
  tabs_account_1: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/account.tsx
  tabs_account_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surface }),
  // tabs/account.tsx
  tabs_account_3: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/account.tsx
  tabs_account_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/account.tsx
  tabs_account_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surface }),
  // tabs/account.tsx
  tabs_account_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/account.tsx
  tabs_account_7: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/account.tsx
  tabs_account_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surface }),
  // tabs/account.tsx
  tabs_account_9: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/account.tsx
  tabs_account_10: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/account.tsx
  tabs_account_11: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surface }),
  // tabs/account.tsx
  tabs_account_12: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/account.tsx
  tabs_account_13: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/account.tsx
  tabs_account_14: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surface }),
  // tabs/account.tsx
  tabs_account_15: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/account.tsx
  tabs_account_16: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/account.tsx
  tabs_account_17: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderTopColor: theme.colors.border }),
  // tabs/account.tsx
  tabs_account_18: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/account.tsx
  tabs_account_19: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText }),
  // tabs/account.tsx
  tabs_account_20: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/account.tsx
  tabs_account_21: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText }),
  // tabs/account.tsx
  tabs_account_22: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/account.tsx
  tabs_account_23: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
  pageHeader: { gap: 8, marginBottom: 16 },
  pageTitle: { fontSize: 26, fontWeight: '700' },
  linksSection: { marginVertical: 16, gap: 10 },
  linkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  linkCard: { borderWidth: 1, borderRadius: 8, padding: 14, minWidth: 220, flex: 1, gap: 5 },
  linkTitle: { fontSize: 17, fontWeight: '700' },
  linkDescription: { fontSize: 13, lineHeight: 18 },
  legalSection: { marginTop: 24, paddingVertical: 20, borderTopWidth: 1, alignItems: 'center', gap: 8 },
  legalTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  legalLinks: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legalLink: { fontSize: 14, fontWeight: '600' },
  copyright: { fontSize: 12, marginTop: 4 },
})),
  tabs_account_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16, minHeight: 44, justifyContent: 'center' }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
    airportFieldWrap: {
      position: 'relative',
      zIndex: 6,
    },
    airportSuggestionList: {
      marginTop: 4,
      maxHeight: 220,
      overflow: 'hidden',
    },
    airportSuggestionOption: {
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
  }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap' }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginRight: 8, marginTop: 4 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap' }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginRight: 8, marginTop: 4 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap' }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginRight: 8, marginTop: 4 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap' }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginRight: 8, marginTop: 4 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'center' }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderBottomWidth: 0 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingHorizontal: 12, paddingVertical: 10 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center', justifyContent: 'space-between' }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, marginRight: 8 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_20: (_theme: AppTheme, { spacing }: ThemeStyleValues): any => ({ marginTop: spacing.sm }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_21: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxHeight: '92%' }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_22: (_theme: AppTheme, { isCompactDialog }: ThemeStyleValues): any => ({ maxHeight: isCompactDialog ? 380 : 440 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 10 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_26: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/AccountProfileManagement.tsx
  tabs_AccountProfileManagement_29: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/activities.tsx
  tabs_activities_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'flex-start' }),
  // tabs/activities.tsx
  tabs_activities_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 140, flexShrink: 0, fontWeight: '600' }),
  // tabs/activities.tsx
  tabs_activities_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/activities.tsx
  tabs_activities_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, alignItems: 'center' }),
  // tabs/activities.tsx
  tabs_activities_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.45 }),
  // tabs/activities.tsx
  tabs_activities_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.45 }),
  // tabs/activities.tsx
  tabs_activities_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }),
  // tabs/activities.tsx
  tabs_activities_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.45 }),
  // tabs/activities.tsx
  tabs_activities_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }),
  // tabs/activities.tsx
  tabs_activities_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.45 }),
  // tabs/activities.tsx
  tabs_activities_11: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', left: 0, zIndex: 4, backgroundColor: theme?.colors.surface }),
  // tabs/activities.tsx
  tabs_activities_12: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', left: 0, zIndex: 3, backgroundColor: theme?.colors.surface }),
  // tabs/activities.tsx
  tabs_activities_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', marginTop: 3 }),
  // tabs/activities.tsx
  tabs_activities_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12 }),
  // tabs/activities.tsx
  tabs_activities_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/activities.tsx
  tabs_activities_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4 }),
  // tabs/activities.tsx
  tabs_activities_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 0 }),
  // tabs/activities.tsx
  tabs_activities_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 420 }),
  // tabs/activities.tsx
  tabs_activities_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingRight: 12 }),
  tabs_activities_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 16, gap: 10 }),
  tabs_activities_21: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 12, padding: 10, borderWidth: 1, borderColor: _theme.colors.border, borderRadius: 10, backgroundColor: _theme.colors.surface }),
  tabs_activities_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, gap: 4 }),
  tabs_activities_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_1: (_theme: AppTheme, { theme, shadowStyle, opacity, y, radius }: ThemeStyleValues): any => ({
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  ...shadowStyle(theme.mode === 'dark' ? _theme.colors.surfaceMuted : theme.colors.primary, opacity, 0, y, radius),
}),
  // tabs/AdminTab.tsx
  tabs_AdminTab_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
  backgroundColor: theme.mode === 'dark' ? theme.colors.backgroundAlt : theme.colors.surfaceMuted,
  borderColor: theme.colors.border,
  color: theme.colors.text,
}),
  // tabs/AdminTab.tsx
  tabs_AdminTab_3: (_theme: AppTheme, { active, theme }: ThemeStyleValues): any => ({
  backgroundColor: active ? theme.colors.primary : theme.colors.backgroundAlt,
  borderColor: active ? theme.colors.primary : theme.colors.border,
}),
  // tabs/AdminTab.tsx
  tabs_AdminTab_4: (_theme: AppTheme, { active, theme }: ThemeStyleValues): any => ({
  color: active ? theme.colors.onPrimary : theme.colors.text,
}),
  // tabs/AdminTab.tsx
  tabs_AdminTab_5: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_6: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_7: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.onPrimary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_8: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.onPrimary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_9: (_theme: AppTheme, { item, theme }: ThemeStyleValues): any => ({ backgroundColor: item.section === 'features' ? theme.colors.link : item.section === 'tiers' ? theme.colors.premium : theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_10: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_11: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_12: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_13: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_14: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_15: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_16: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_17: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_18: (_theme: AppTheme, { flag, theme }: ThemeStyleValues): any => ({ backgroundColor: flag.enabled ? theme.colors.success : theme.colors.alert }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_19: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_20: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_21: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_22: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_23: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_24: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', gap: 8, marginTop: 8 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_26: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surfaceMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_27: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 8 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_29: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_30: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surfaceMuted, marginBottom: 4 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_31: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_32: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 200 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_33: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_34: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.onPrimary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_35: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surfaceMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_36: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_37: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', gap: 8, marginTop: 8 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_38: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_39: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surfaceMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_40: (_theme: AppTheme, { bulkRole, theme }: ThemeStyleValues): any => ({ color: bulkRole === 'admin' ? theme.colors.onPrimary : theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_41: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_42: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surfaceMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_43: (_theme: AppTheme, { bulkRole, theme }: ThemeStyleValues): any => ({ color: bulkRole === 'user' ? theme.colors.onPrimary : theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_44: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_45: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.onPrimary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_46: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingRight: 10, paddingVertical: 4 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_47: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ fontSize: 18, color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_48: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_49: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_50: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_51: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.premium }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_52: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_53: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_54: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_55: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_56: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_57: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_58: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_59: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_60: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_61: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_62: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_63: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_64: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.mode === 'dark' ? _theme.colors.surfaceMuted : _theme.colors.surface }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_65: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.mode === 'dark' ? _theme.colors.accentSurface : _theme.colors.surfaceMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_66: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.backgroundAlt }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_67: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_68: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_69: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_70: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_71: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_72: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_73: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_74: (_theme: AppTheme, { saveMsg, theme }: ThemeStyleValues): any => ({ color: saveMsg.startsWith('Error:') ? theme.colors.error : theme.colors.success }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_75: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_76: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_77: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_78: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_79: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_80: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_81: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.successText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_82: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_83: (_theme: AppTheme, { theme, shadowStyle }: ThemeStyleValues): any => ({
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              ...shadowStyle(theme.mode === 'dark' ? _theme.colors.surfaceMuted : theme.colors.primary, 0.08, 0, 3, 8),
            }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_84: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary, borderBottomColor: theme.colors.border }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_85: (_theme: AppTheme, { nameColumnWidth, theme }: ThemeStyleValues): any => ({ width: nameColumnWidth, borderRightColor: theme.colors.border }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_86: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.onPrimary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_87: (_theme: AppTheme, { tierColumnWidth, theme }: ThemeStyleValues): any => ({ width: tierColumnWidth, borderRightColor: theme.colors.border }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_88: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.onPrimary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_89: (_theme: AppTheme, { index, theme }: ThemeStyleValues): any => ({
                        backgroundColor: index % 2 === 0 ? theme.colors.surface : theme.colors.surfaceMuted,
                        borderBottomColor: theme.colors.border,
                      }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_90: (_theme: AppTheme, { nameColumnWidth, theme }: ThemeStyleValues): any => ({ width: nameColumnWidth, borderRightColor: theme.colors.border }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_91: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_92: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_93: (_theme: AppTheme, { tierColumnWidth, theme }: ThemeStyleValues): any => ({ width: tierColumnWidth, borderRightColor: theme.colors.border }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_94: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_95: (_theme: AppTheme, { tierColumnWidth, theme }: ThemeStyleValues): any => ({ width: tierColumnWidth, borderRightColor: theme.colors.border }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_96: (_theme: AppTheme, { buttonBackgroundColor, buttonBorderColor, isInherited }: ThemeStyleValues): any => ({
                                backgroundColor: buttonBackgroundColor,
                                borderColor: buttonBorderColor,
                                borderWidth: isInherited ? 1 : 0,
                              }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_97: (_theme: AppTheme, { primaryTextColor }: ThemeStyleValues): any => ({ color: primaryTextColor }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_98: (_theme: AppTheme, { secondaryTextColor }: ThemeStyleValues): any => ({ color: secondaryTextColor }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_99: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.scrim }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_100: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surface, borderColor: theme.colors.border }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_101: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_102: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_103: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_104: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
                    backgroundColor: theme.colors.backgroundAlt,
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_105: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
                    backgroundColor: theme.colors.backgroundAlt,
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_106: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_107: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_108: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_109: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onCta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_110: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.scrim }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_111: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.surface, borderColor: theme.colors.border }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_112: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_113: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_114: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
                    backgroundColor: theme.colors.backgroundAlt,
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_115: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_116: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_117: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_118: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onCta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_119: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_120: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted, marginBottom: 8 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_121: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary, alignSelf: 'flex-start', marginBottom: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_122: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.onPrimary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_123: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_124: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_125: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_126: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginBottom: 4 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_127: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_128: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_129: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_130: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_131: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_132: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_133: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted, marginTop: 6 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_134: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginBottom: 4 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_135: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_136: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_137: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_138: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_139: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 16, marginBottom: 4 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_140: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_141: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_142: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_143: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted, marginTop: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_144: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_145: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_146: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_147: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_148: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_149: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_150: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.premium }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_151: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_152: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_153: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_154: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_155: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_156: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_157: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_158: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_159: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_160: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_161: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_162: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_163: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_164: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_165: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_166: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_167: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_168: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_169: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_170: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.primary }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_171: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_172: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_173: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_174: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_175: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_176: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.successText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_177: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_178: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_179: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_180: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_181: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_182: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_183: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_184: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_185: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_186: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_187: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_188: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_189: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_190: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_191: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 10 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_192: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_193: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_194: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_195: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_196: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_197: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 10 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_198: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_199: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_200: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 10 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_201: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_202: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted, marginTop: 10 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_203: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_204: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_205: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 10 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_206: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_207: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_208: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_209: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_210: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_211: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_212: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_213: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_214: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_215: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_216: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_217: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_218: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_219: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted, marginBottom: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_220: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.successText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_221: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_222: (_theme: AppTheme, { getYourGuideStatus, theme }: ThemeStyleValues): any => ({ color: getYourGuideStatus.featureEnabled ? theme.colors.success : theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_223: (_theme: AppTheme, { getYourGuideStatus, theme }: ThemeStyleValues): any => ({ color: getYourGuideStatus.circuit?.open ? theme.colors.error : theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_224: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_225: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_226: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_227: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_228: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_229: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_230: (_theme: AppTheme, { provider, theme }: ThemeStyleValues): any => ({
                color:
                  provider.isBudgetExceeded ||
                  ((provider.budgetUsagePercent ?? 0) >= (provider.budgetAlertThresholdPercent ?? Number.POSITIVE_INFINITY))
                    ? theme.colors.error
                    : theme.colors.textMuted,
              }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_231: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_232: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_233: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_234: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_235: (_theme: AppTheme, { isHigh, theme }: ThemeStyleValues): any => ({ color: isHigh ? theme.colors.error : theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_236: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_237: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 16 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_238: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted, marginBottom: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_239: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_240: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_241: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_242: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ ...ctaGradientStyle(theme), marginTop: 8 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_243: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_244: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_245: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_246: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted, marginBottom: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_247: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.successText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_248: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_249: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_250: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_251: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_252: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_253: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 8 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_254: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted, marginTop: 8 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_255: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_256: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 16 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_257: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_258: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_259: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_260: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_261: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 16 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_262: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_263: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.backgroundAlt, borderWidth: 1, borderColor: theme.colors.border }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_264: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_265: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_266: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 16 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_267: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_268: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_269: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, marginTop: 16 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_270: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted, marginBottom: 8 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_271: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_272: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_273: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_274: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ ...ctaGradientStyle(theme), marginTop: 8 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_275: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_276: (_theme: AppTheme, { billingEnabled, theme }: ThemeStyleValues): any => ({ color: billingEnabled ? theme.colors.success : theme.colors.error, marginBottom: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_277: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_278: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.successText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_279: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_280: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_281: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_282: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 10 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_283: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_284: (_theme: AppTheme, { active, theme }: ThemeStyleValues): any => ({ backgroundColor: active ? theme.colors.successAction : theme.colors.dangerAction }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_285: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.cta }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_286: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_287: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text, fontSize: 18, fontWeight: '700' }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_288: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_289: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_290: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_291: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_292: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_293: (_theme: AppTheme, { preset, theme }: ThemeStyleValues): any => ({ color: preset.isActive ? theme.colors.error : theme.colors.link }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_294: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8, paddingVertical: 8, paddingLeft: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_295: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, alignItems: 'center' }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_296: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, padding: 6, borderRadius: 6, flex: 1 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_297: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, padding: 6, borderRadius: 6, flex: 2 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_298: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_299: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 12 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_300: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_301: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.cta, fontWeight: '700' }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_302: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, padding: 8, borderRadius: 6 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_303: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, padding: 8, borderRadius: 6, minHeight: 140, textAlignVertical: 'top' }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_304: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ ...ctaGradientStyle(theme), padding: 10, borderRadius: 6, alignSelf: 'flex-start' }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_305: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onCta, fontWeight: '700' }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_306: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 24 }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_307: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme.colors.background }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_308: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.linkText }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_309: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.textMuted }),
  // tabs/AdminTab.tsx
  tabs_AdminTab_310: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.text }),
  // tabs/AdminTab.tsx
  // components/admin/TripTemplatesSection.tsx
  components_admin_TripTemplatesSection_1: (_theme: AppTheme, { StyleSheet }: ThemeStyleValues): any => (StyleSheet.create({
    root: { gap: 14 },
    title: { fontSize: 20, fontWeight: '700', color: _theme.colors.text },
    helper: { fontSize: 13, color: _theme.colors.textMuted, lineHeight: 18 },
    message: { fontSize: 14, fontWeight: '600', color: _theme.colors.text, padding: 10, borderRadius: 8, backgroundColor: _theme.colors.surfaceMuted },
    card: { gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: _theme.colors.border, backgroundColor: _theme.colors.surface },
    cardTitle: { fontSize: 16, fontWeight: '700', color: _theme.colors.text },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    button: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, justifyContent: 'center', backgroundColor: _theme.colors.cta },
    buttonText: { fontSize: 14, fontWeight: '700', color: _theme.colors.onCta },
    outlineButton: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: _theme.colors.border, backgroundColor: _theme.colors.surface },
    outlineButtonText: { fontSize: 14, fontWeight: '600', color: _theme.colors.text },
    dangerButton: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, justifyContent: 'center', backgroundColor: _theme.colors.dangerAction },
    dangerButtonText: { fontSize: 14, fontWeight: '700', color: _theme.colors.onAccent },
    disabledButton: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, justifyContent: 'center', backgroundColor: _theme.colors.surfaceMuted, opacity: 0.6 },
    disabledButtonText: { fontSize: 14, fontWeight: '700', color: _theme.colors.text },
    input: { minHeight: 140, maxHeight: 320, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: _theme.colors.border, backgroundColor: _theme.colors.surfaceMuted, color: _theme.colors.text, fontSize: 12, textAlignVertical: 'top' },
    report: { gap: 8, paddingTop: 4 },
    group: { gap: 8 },
    groupHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 6 },
    groupTitleButton: { minHeight: 44, justifyContent: 'center', flexShrink: 1 },
    groupTitle: { fontSize: 16, fontWeight: '700', color: _theme.colors.text },
    resultRow: { gap: 4, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: _theme.colors.border, backgroundColor: _theme.colors.surface },
    resultTitle: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: _theme.colors.text },
    mutedText: { fontSize: 12, color: _theme.colors.textMuted },
    errorText: { fontSize: 13, color: _theme.colors.dangerText },
    warningText: { fontSize: 13, color: _theme.colors.warningText },
    successText: { fontSize: 14, fontWeight: '600', color: _theme.colors.successText },
    pill: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
    pillNew: { color: _theme.colors.successText, backgroundColor: _theme.colors.successSurface },
    pillUpdated: { color: _theme.colors.warningText, backgroundColor: _theme.colors.warningSurface },
    pillInvalid: { color: _theme.colors.dangerText, backgroundColor: _theme.colors.dangerSurface },
    pillUnchanged: { color: _theme.colors.text, backgroundColor: _theme.colors.surfaceMuted },
  })),
  tabs_AdminTab_311: (_theme: AppTheme, { StyleSheet, shadowStyle }: ThemeStyleValues): any => (StyleSheet.create({
  content: { flex: 1, minHeight: 0, padding: 16, paddingBottom: 0, width: '100%' },
  section: { marginBottom: 24 },
  sectionHost: { flex: 1, minHeight: 0 },
  sectionScroll: { flex: 1, minHeight: 0 },
  sectionScrollContent: { paddingBottom: 40 },
  sectionTitle: { fontSize: 22, fontWeight: '700', marginBottom: 16, color: _theme.colors.text },
  loading: { color: _theme.colors.text, marginVertical: 8 },
  errorText: { color: _theme.colors.dangerText, marginVertical: 8 },
  emptyText: { color: _theme.colors.text, fontStyle: 'italic' },
  saveMsg: { color: _theme.colors.successText, marginTop: 8, fontWeight: '600' },
  // Cards
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    ...shadowStyle(_theme.colors.surfaceMuted, 0.06, 0, 2, 10),
    elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: _theme.colors.text, marginBottom: 2 },
  cardSub: { fontSize: 13, color: _theme.colors.text, marginTop: 2 },
  heroCard: {
    borderRadius: 24,
    borderWidth: 1,
    paddingVertical: 22,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  heroTitle: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  heroBody: { fontSize: 14, lineHeight: 20, maxWidth: 520 },
  // Nav cards
  navCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    ...shadowStyle(_theme.colors.surfaceMuted, 0.07, 0, 2, 6),
    elevation: 3,
  },
  navAccent: { width: 48, height: 6, borderRadius: 999, marginBottom: 14 },
  navCardTitle: { fontSize: 17, fontWeight: '700', color: _theme.colors.text, marginBottom: 4 },
  navCardDesc: { fontSize: 13, color: _theme.colors.text },
  // Layout
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  inlineField: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  inlineFieldLabel: { minWidth: 220, flex: 1 },
  compactRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: _theme.colors.border },
  tableCellPrimary: { fontSize: 13, fontWeight: '700' },
  // Badges
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, marginLeft: 8 },
  badgeOn: { backgroundColor: _theme.colors.successAction },
  badgeOff: { backgroundColor: _theme.colors.dangerAction },
  badgeText: { color: _theme.colors.onAccent, fontSize: 11, fontWeight: '700' },
  // Tags
  tagRow: { flexDirection: 'row', gap: 4 },
  tagAdmin: { backgroundColor: _theme.colors.premiumAction, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  tagTier: { backgroundColor: _theme.colors.accentAction, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  tagText: { color: _theme.colors.onAccent, fontSize: 11, fontWeight: '600' },
  // Forms
  input: {
    borderWidth: 1,
    borderColor: _theme.colors.border,
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    marginBottom: 10,
    backgroundColor: _theme.colors.surface,
  },
  smallInput: {
    borderWidth: 1,
    borderColor: _theme.colors.border,
    borderRadius: 6,
    padding: 8,
    fontSize: 13,
    marginTop: 6,
    backgroundColor: _theme.colors.surface,
  },
  inlineForm: { marginTop: 8 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: _theme.colors.text, marginTop: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  smallButton: {
    backgroundColor: _theme.colors.primary,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  smallButtonText: { color: _theme.colors.onAccent, fontSize: 13, fontWeight: '600' },
  buttonDisabled: { opacity: 0.4 },
  dropdownButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  dropdownLocked: {
    justifyContent: 'center',
  },
  dropdownButtonText: { fontSize: 14, fontWeight: '600' },
  dropdownMenu: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 8,
    ...shadowStyle(_theme.colors.surfaceMuted, 0.18, 0, 8, 18),
    elevation: 12,
  },
  dropdownOption: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: _theme.colors.border,
  },
  dropdownOptionText: { fontSize: 14, fontWeight: '500' },
  // Tier buttons
  tierButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  tierButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: _theme.colors.border,
    backgroundColor: _theme.colors.surfaceMuted,
  },
  tierButtonActive: { backgroundColor: _theme.colors.primary, borderColor: _theme.colors.accentBorder },
  tierButtonText: { fontSize: 13, color: _theme.colors.text },
  tierButtonTextActive: { color: _theme.colors.onAccent },
  // Limit rows
  limitRow: { marginBottom: 6 },
  editButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    backgroundColor: _theme.colors.surfaceMuted,
    marginLeft: 8,
  },
  editButtonText: { fontSize: 12, color: _theme.colors.text },
  tableShell: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    ...shadowStyle(_theme.colors.surfaceMuted, 0.08, 0, 3, 8),
    elevation: 3,
  },
  tableHeaderRow: { flexDirection: 'row', minHeight: 64, borderBottomWidth: 1 },
  tableHeaderCell: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRightWidth: 1,
  },
  tableBodyScroll: { maxHeight: 560 },
  tableDataRow: { flexDirection: 'row', minHeight: 76, borderBottomWidth: 1 },
  tableNameCell: {
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRightWidth: 1,
  },
  tableTierCell: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRightWidth: 1,
  },
  tableHeaderText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  tableNameText: { fontSize: 14, fontWeight: '600' },
  tableMetaText: { fontSize: 11, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  tableLinkButton: { paddingVertical: 8, paddingHorizontal: 12 },
  tableLinkText: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  toggleCellButton: {
    minWidth: 104,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleCellText: { fontSize: 13, fontWeight: '700' },
  toggleCellSubtext: { fontSize: 11, marginTop: 4, textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  modalBodyText: { fontSize: 14, marginBottom: 6 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 12,
  },
  modalTextArea: { minHeight: 96, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  modalSecondaryButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalSecondaryButtonText: { fontSize: 14, fontWeight: '600' },
  modalPrimaryButton: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  modalPrimaryButtonText: { fontSize: 14, fontWeight: '700' },
  // Pagination
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 12 },
  apiLimitsScroll: { flex: 1, minHeight: 0 },
  apiLimitsScrollContent: { paddingBottom: 32 },
  apiLimitCallerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  apiLimitInput: {
    minWidth: 110,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  pageButton: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    backgroundColor: _theme.colors.primary,
    borderRadius: 6,
  },
  pageButtonText: { color: _theme.colors.onAccent, fontSize: 13, fontWeight: '600' },
  pageInfo: { fontSize: 13, color: _theme.colors.text },
  // Breadcrumb
  breadcrumb: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  breadcrumbLink: { color: _theme.colors.linkText, fontSize: 14 },
  breadcrumbSep: { color: _theme.colors.textMuted, fontSize: 14 },
  breadcrumbCurrent: { color: _theme.colors.text, fontSize: 14 },
  // Back link
  backLink: { marginBottom: 12 },
  backLinkText: { color: _theme.colors.linkText, fontSize: 14 },
})),
  // tabs/AdminTab.tsx
  tabs_AdminTab_312: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.transparent),
  // tabs/AdminTab.tsx
  tabs_AdminTab_313: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_1: (_theme: AppTheme, { webInputStyle }: ThemeStyleValues): any => ({ ...webInputStyle, flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_2: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        colorScheme: theme?.mode === 'dark' ? 'dark' : 'light',
      }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_3: (_theme: AppTheme, { webDateInputStyle }: ThemeStyleValues): any => ({ ...webDateInputStyle, flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 0, minHeight: 42 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 0, minHeight: 42 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_6: (_theme: AppTheme, { webDateInputStyle }: ThemeStyleValues): any => ({ ...webDateInputStyle, height: 42, minHeight: 42, marginBottom: 0 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 0, width: '100%', flex: 0, minHeight: 42 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'flex-start' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_9: (_theme: AppTheme, { x, y, width, height }: ThemeStyleValues): any => ({ x, y, width, height }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_10: (_theme: AppTheme, { rect }: ThemeStyleValues): any => ({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_11: (_theme: AppTheme, { isNarrowLayout }: ThemeStyleValues): any => ({ flexWrap: isNarrowLayout ? 'wrap' : 'nowrap' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_12: (_theme: AppTheme, { isNarrowLayout }: ThemeStyleValues): any => ({ flex: 1, minWidth: isNarrowLayout ? '100%' : 0, maxWidth: '100%' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_13: (_theme: AppTheme, { isNarrowLayout }: ThemeStyleValues): any => ({ flex: 1, minWidth: isNarrowLayout ? '100%' : 0, maxWidth: '100%' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', marginTop: 8 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 120 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_16: (_theme: AppTheme, { dateModeSelected, theme }: ThemeStyleValues): any => ({
                    backgroundColor: dateModeSelected === 'range' ? _theme.colors.selectedSurface : (theme?.colors.surface ?? _theme.colors.surface),
                    borderColor: _theme.colors.text,
                    borderWidth: 1,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 6,
                    alignItems: 'center',
                  }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginRight: 8 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_18: (_theme: AppTheme, { dateModeSelected }: ThemeStyleValues): any => ({ color: dateModeSelected === 'range' ? _theme.colors.onSelected : _theme.colors.linkText, fontWeight: '600' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_19: (_theme: AppTheme, { dateModeSelected, theme }: ThemeStyleValues): any => ({
                    backgroundColor: dateModeSelected === 'month' ? _theme.colors.selectedSurface : (theme?.colors.surface ?? _theme.colors.surface),
                    borderColor: _theme.colors.text,
                    borderWidth: 1,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 6,
                    alignItems: 'center',
                  }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_20: (_theme: AppTheme, { dateModeSelected }: ThemeStyleValues): any => ({ color: dateModeSelected === 'month' ? _theme.colors.onSelected : _theme.colors.linkText, fontWeight: '600' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_21: (_theme: AppTheme, { isNarrowLayout }: ThemeStyleValues): any => ({ flexWrap: isNarrowLayout ? 'wrap' : 'nowrap' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_22: (_theme: AppTheme, { isNarrowLayout }: ThemeStyleValues): any => ({ flex: 1, minWidth: isNarrowLayout ? '100%' : 0, maxWidth: '100%' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_23: (_theme: AppTheme, { isNarrowLayout }: ThemeStyleValues): any => ({ flex: 1, minWidth: isNarrowLayout ? '100%' : 0, maxWidth: '100%' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_26: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_29: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginRight: 8 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_30: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 520 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_31: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingBottom: 12 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_32: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 10 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_33: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center', justifyContent: 'space-between' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_34: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_35: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'relative', marginTop: 16 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_36: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'absolute', right: 8, top: 10, padding: 6 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_37: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 520 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_38: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingBottom: 12 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_39: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_40: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_41: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_42: (_theme: AppTheme, { Platform }: ThemeStyleValues): any => ({
                ...(Platform.OS === 'web'
                  ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }
                  : { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }),
                zIndex: 45000,
                elevation: 80,
              }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_43: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ zIndex: 46000, elevation: 84 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_44: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'flex-start' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_45: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_46: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_47: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'stretch' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_48: (_theme: AppTheme, { wizardCarWebInputStyle }: ThemeStyleValues): any => ({ ...wizardCarWebInputStyle, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_49: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_50: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'relative', top: 0 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_51: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_52: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'relative', flex: 1, minHeight: 0 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_53: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_54: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_55: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingHorizontal: 12, paddingVertical: 6 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_56: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_57: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 12, flexGrow: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_58: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_59: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_60: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, marginBottom: 0, flexWrap: 'nowrap' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_61: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_62: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_63: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme?.colors.border ?? _theme.colors.accentBorder,
                  backgroundColor: theme?.mode === 'dark' ? _theme.colors.accentSurface : _theme.colors.surfaceMuted,
                }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_64: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text ?? _theme.colors.text, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_65: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_66: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_67: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_68: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.6 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_69: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, marginBottom: 0, flexWrap: 'nowrap' }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_70: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_71: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme?.colors.border ?? _theme.colors.accentBorder,
                  backgroundColor: theme?.mode === 'dark' ? _theme.colors.accentSurface : _theme.colors.surfaceMuted,
                }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_72: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text ?? _theme.colors.text, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_73: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.transparent, zIndex: 52000, elevation: 80 }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_74: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.transparent }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_75: (_theme: AppTheme, { itineraryAirportAnchor }: ThemeStyleValues): any => ({
                zIndex: 53000,
                elevation: 84,
                left: itineraryAirportAnchor.x,
                top: itineraryAirportAnchor.y + itineraryAirportAnchor.height,
                width: itineraryAirportAnchor.width || 280,
              }),
  // tabs/createTripWizard.tsx
  tabs_createTripWizard_76: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 420 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
    padding: 12,
    marginBottom: 8,
  }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 6,
  }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
    fontWeight: '600' as const,
  }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
    fontWeight: '600' as const,
  }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 4,
  }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
    fontStyle: 'italic' as const,
  }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexBasis: '100%', minWidth: '100%', maxWidth: '100%' }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexGrow: 1, flexShrink: 1, flexBasis: 150, minWidth: 132, maxWidth: '100%' }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexGrow: 1, flexShrink: 1, flexBasis: 120, minWidth: 120, maxWidth: '100%' }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_10: (_theme: AppTheme, { viewportHeight }: ThemeStyleValues): any => ({ maxHeight: Math.max(360, viewportHeight - 220), flexGrow: 0 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
  }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ display: 'none' }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 8 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8, overflow: 'visible', paddingBottom: 8 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingBottom: 24 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_20: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor: theme?.colors?.alert ?? _theme.colors.dangerBorder, borderRadius: 8, padding: 10, marginTop: 8 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_21: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8, gap: 8 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 620 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_24: (_theme: AppTheme, { viewportHeight }: ThemeStyleValues): any => ({ maxHeight: viewportHeight ? Math.min(360, viewportHeight * 0.4) : 360 }),
  // tabs/dailyExpenses.tsx
  tabs_dailyExpenses_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap' }),
  // tabs/ExpenseCovering.tsx
  tabs_ExpenseCovering_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'flex-start' }),
  // tabs/ExpenseCovering.tsx
  tabs_ExpenseCovering_2: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/ExpenseCovering.tsx
  tabs_ExpenseCovering_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 0, paddingTop: 10 }),
  // tabs/ExpenseCovering.tsx
  tabs_ExpenseCovering_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 150 }),
  // tabs/ExpenseCovering.tsx
  tabs_ExpenseCovering_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({marginTop: 12}),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/FamilyRelationships.tsx
  tabs_FamilyRelationships_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/follow.tsx
  tabs_follow_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700', marginTop: 6 }),
  // tabs/follow.tsx
  tabs_follow_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4 }),
  // tabs/follow.tsx
  tabs_follow_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 6, gap: 6 }),
  // tabs/follow.tsx
  tabs_follow_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // tabs/following.tsx
  tabs_following_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderColor: _theme.colors.textMuted, borderWidth: 1 }),
  // tabs/following.tsx
  tabs_following_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 6 }),
  // tabs/following.tsx
  tabs_following_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 6 }),
  // tabs/following.tsx
  tabs_following_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700', marginBottom: 4 }),
  // tabs/following.tsx
  tabs_following_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 6, borderTopWidth: 1, borderTopColor: _theme.colors.border }),
  // tabs/following.tsx
  tabs_following_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }),
  // tabs/following.tsx
  tabs_following_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flex: 1, gap: 8 }),
  // tabs/following.tsx
  tabs_following_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 20, fontSize: 14 }),
  // tabs/following.tsx
  tabs_following_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/following.tsx
  tabs_following_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // tabs/following.tsx
  tabs_following_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 56, textAlign: 'right' }),
  // tabs/following.tsx
  tabs_following_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: _theme.colors.border }),
  // tabs/following.tsx
  tabs_following_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // tabs/following.tsx
  tabs_following_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/following.tsx
  tabs_following_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 70, textAlignVertical: 'top' }),
  // tabs/following.tsx
  tabs_following_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 6 }),
  // tabs/following.tsx
  tabs_following_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 6 }),
  // tabs/following.tsx
  tabs_following_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexGrow: 1 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center', justifyContent: 'space-between', gap: 8 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexShrink: 1, minWidth: 0 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 8,
                flex: 1,
                minWidth: 0,
                marginBottom: 0,
              }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_7: (_theme: AppTheme, { heroHeight }: ThemeStyleValues): any => ({ height: heroHeight }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ left: 14, right: 14, bottom: 54, paddingRight: 0 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 14 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 25, lineHeight: 30 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ pointerEvents: 'none' }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ right: 14, bottom: 12 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'flex-end', marginTop: 16 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 8 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'flex-end', marginTop: 16 }),
  // tabs/HomeTab.tsx
  tabs_HomeTab_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 8 }),
  tabs_HomeTab_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.text),
  // tabs/ingestion.tsx
  tabs_ingestion_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 220 }),
  // tabs/ingestion.tsx
  tabs_ingestion_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 120 }),
  // tabs/ingestion.tsx
  tabs_ingestion_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 120 }),
  // tabs/ingestion.tsx
  tabs_ingestion_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 120 }),
  // tabs/ingestion.tsx
  tabs_ingestion_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 120 }),
  // tabs/ingestion.tsx
  tabs_ingestion_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 100 }),
  // tabs/ingestion.tsx
  tabs_ingestion_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 180 }),
  // tabs/ingestion.tsx
  tabs_ingestion_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'flex-start' }),
  // tabs/ingestion.tsx
  tabs_ingestion_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingHorizontal: 10 }),
  // tabs/ingestion.tsx
  tabs_ingestion_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/ingestion.tsx
  tabs_ingestion_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxWidth: 720 }),
  // tabs/ingestion.tsx
  tabs_ingestion_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxHeight: 520 }),
  // tabs/ingestion.tsx
  tabs_ingestion_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 100, textAlignVertical: 'top' }),
  // tabs/ingestion.tsx
  tabs_ingestion_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // tabs/ingestion.tsx
  tabs_ingestion_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44 }),
  // tabs/ledger.tsx
  tabs_ledger_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 8 }),
  // tabs/ledger.tsx
  tabs_ledger_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 8 }),
  // tabs/ledger.tsx
  tabs_ledger_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 6 }),
  // tabs/ledger.tsx
  tabs_ledger_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '600' }),
  // tabs/ledger.tsx
  tabs_ledger_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 }),
  // tabs/ledger.tsx
  tabs_ledger_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '600' }),
  // tabs/ledger.tsx
  tabs_ledger_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '600' }),
  // tabs/ledger.tsx
  tabs_ledger_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 8 }),
  // tabs/ledger.tsx
  tabs_ledger_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 6 }),
  // tabs/ledger.tsx
  tabs_ledger_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '600' }),
  // tabs/ledger.tsx
  tabs_ledger_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 }),
  // tabs/ledger.tsx
  tabs_ledger_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '600' }),
  // tabs/ledger.tsx
  tabs_ledger_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '600' }),
  // tabs/ledger.tsx
  tabs_ledger_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '600' }),
  // tabs/ledger.tsx
  tabs_ledger_15: (_theme: AppTheme, { greyCellBg }: ThemeStyleValues): any => ({ backgroundColor: greyCellBg }),
  // tabs/ledger.tsx
  tabs_ledger_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }),
  // tabs/ledger.tsx
  tabs_ledger_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 0 }),
  // tabs/ledger.tsx
  tabs_ledger_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '600' }),
  // tabs/ledger.tsx
  tabs_ledger_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '600' }),
  // tabs/ledger.tsx
  tabs_ledger_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // tabs/ledger.tsx
  tabs_ledger_21: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 6 }),
  // tabs/ledger.tsx
  tabs_ledger_22: (_theme: AppTheme, { isNarrowLayout }: ThemeStyleValues): any => ({
                  alignItems: isNarrowLayout ? 'stretch' : 'center',
                  flexDirection: isNarrowLayout ? 'column' : 'row',
                  flexWrap: isNarrowLayout ? 'wrap' : 'nowrap',
                  gap: 8,
                  width: '100%',
                  maxWidth: '100%',
                }),
  // tabs/ledger.tsx
  tabs_ledger_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }),
  // tabs/ledger.tsx
  tabs_ledger_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 0 }),
  // tabs/ledger.tsx
  tabs_ledger_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700' }),
  // tabs/ledger.tsx
  tabs_ledger_26: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 0, flexShrink: 1 }),
  // tabs/ledger.tsx
  tabs_ledger_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignSelf: 'flex-start' }),
  // tabs/ledger.tsx
  tabs_ledger_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 12 }),
  // tabs/ledger.tsx
  tabs_ledger_29: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 8 }),
  // tabs/ledger.tsx
  tabs_ledger_30: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // tabs/ledger.tsx
  transferSummary: (theme: AppTheme, {}: ThemeStyleValues): any => ({
    summary: { paddingVertical: 6, gap: 2 },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    route: { fontSize: theme.typography.body, fontWeight: theme.typography.weightSemibold,
      color: theme.colors.linkText, flexShrink: 1, flexWrap: 'wrap', textDecorationLine: 'underline' },
    detail: { color: theme.colors.textMuted, marginBottom: 8, fontSize: theme.typography.small },
  }),
  carRentalSummary: (theme: AppTheme, {}: ThemeStyleValues): any => ({
    summary: { paddingVertical: 6, gap: 8 },
    title: { fontSize: theme.typography.body, fontWeight: theme.typography.weightSemibold, color: theme.colors.linkText },
    route: { fontSize: theme.typography.small, color: theme.colors.textMuted, marginBottom: 8 },
  }),
  compactItemList: (_theme: AppTheme, {}: ThemeStyleValues): any => ({ gap: 8 }),
  bottomAddSheetHeight: (_theme: AppTheme, {}: ThemeStyleValues): any => ({ maxHeight: '85%' }),
  bottomAddSheetScroll: (_theme: AppTheme, {}: ThemeStyleValues): any => ({ flexShrink: 1 }),
  dayHeroSubtitleRow: (_theme: AppTheme, {}: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6 }),
  dayHeroSubtitleText: (_theme: AppTheme, {}: ThemeStyleValues): any => ({ marginTop: 0, flexShrink: 1 }),
  settlementPanel: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
          backgroundColor: _theme.colors.accentSurface,
          borderColor: _theme.colors.accentBorder,
          borderWidth: 1,
          borderLeftWidth: 4,
          borderLeftColor: _theme.colors.primary,
        }),
  settlementHeading: (_theme: AppTheme, {}: ThemeStyleValues): ViewStyle => ({
    flexDirection: 'row',
    alignItems: 'center',
    gap: _theme.spacing.md,
    marginBottom: _theme.spacing.sm,
  }),
  settlementHeadingIcon: (_theme: AppTheme, {}: ThemeStyleValues): ViewStyle => ({
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: _theme.colors.selectedSurface,
  }),
  settlementHeadingTitle: (_theme: AppTheme, {}: ThemeStyleValues): any => ({
    marginBottom: 0,
    color: _theme.colors.text,
  }),
  // tabs/ledger.tsx
  tabs_ledger_32: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText }),
  // tabs/ledger.tsx
  tabs_ledger_33: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // tabs/ledger.tsx
  tabs_ledger_34: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 10 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 0, gap: 8 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minWidth: 0 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontWeight: '700', fontSize: 16 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_6: (_theme: AppTheme, { statusColors }: ThemeStyleValues): any => ({ backgroundColor: statusColors.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_7: (_theme: AppTheme, { statusColors }: ThemeStyleValues): any => ({ color: statusColors.fg, fontSize: 12, fontWeight: '700' }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 6 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 6 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, alignItems: 'center' }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_16: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexGrow: 1 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 878 }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_19: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', left: 0, zIndex: 4, backgroundColor: theme?.colors.surface }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_20: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', right: 0, zIndex: 4, backgroundColor: theme?.colors.surface }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_21: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', left: 0, zIndex: 3, backgroundColor: theme?.colors.surface }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_22: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', right: 0, zIndex: 3, backgroundColor: theme?.colors.surface }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'flex-start' }),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.successAction),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_26: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.accentSurface),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.dangerAction),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // tabs/LodgingTab.tsx
  tabs_LodgingTab_29: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // tabs/overview.tsx
  tabs_overview_1: (_theme: AppTheme, { isPhoneLayout }: ThemeStyleValues): any => ({
      padding: isPhoneLayout ? 12 : 16,
      borderRadius: isPhoneLayout ? 10 : 12,
    }),
  // tabs/overview.tsx
  tabs_overview_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 6 }),
  // tabs/overview.tsx
  tabs_overview_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center' }),
  // tabs/overview.tsx
  tabs_overview_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 6, flex: 1 }),
  // tabs/overview.tsx
  tabs_overview_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 6 }),
  // tabs/overview.tsx
  tabs_overview_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center' }),
  // tabs/overview.tsx
  tabs_overview_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 6, flex: 1 }),
  // tabs/overview.tsx
  tabs_overview_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 90, width: 90 }),
  // tabs/overview.tsx
  tabs_overview_9: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 200, width: 200 }),
  // tabs/overview.tsx
  tabs_overview_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between' }),
  // tabs/overview.tsx
  tabs_overview_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 6 }),
  // tabs/overview.tsx
  tabs_overview_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 120, textAlignVertical: 'top' }),
  // tabs/overview.tsx
  tabs_overview_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'space-between' }),
  // tabs/overview.tsx
  tabs_overview_14: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: '100%', minWidth: 0, flexGrow: 0, flexShrink: 1, alignSelf: 'stretch', marginVertical: 8 }),
  // tabs/overview.tsx
  tabs_overview_15: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingRight: 8, flexGrow: 0, flexShrink: 0 }),
  // tabs/overview.tsx
  tabs_overview_16: (_theme: AppTheme, { dayHeroHeight }: ThemeStyleValues): any => ({ height: dayHeroHeight }),
  // tabs/overview.tsx
  tabs_overview_17: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: _theme.colors.overlay,
                }),
  // tabs/overview.tsx
  tabs_overview_18: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 12, fontWeight: '700' }),
  // tabs/overview.tsx
  tabs_overview_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 18, lineHeight: 23 }),
  // tabs/overview.tsx
  tabs_overview_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 20 }),
  // tabs/overview.tsx
  tabs_overview_21: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 11 }),
  // tabs/overview.tsx
  tabs_overview_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'relative', flex: 1, minHeight: 0 }),
  // tabs/overview.tsx
  tabs_overview_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/overview.tsx
  tabs_overview_24: (_theme: AppTheme, { isPhoneLayout }: ThemeStyleValues): any => ({
                gap: isPhoneLayout ? 12 : 16,
                paddingTop: isPhoneLayout ? 48 : 56,
                paddingBottom: 24,
              }),
  // tabs/overview.tsx
  tabs_overview_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ textDecorationLine: 'underline' }),
  // tabs/overview.tsx
  tabs_overview_26: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/overview.tsx
  tabs_overview_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/overview.tsx
  tabs_overview_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/overview.tsx
  tabs_overview_29: (_theme: AppTheme, { lodgingThumbnailSize }: ThemeStyleValues): any => ({ width: lodgingThumbnailSize, height: lodgingThumbnailSize }),
  // tabs/overview.tsx
  tabs_overview_30: (_theme: AppTheme, { lodgingThumbnailSize }: ThemeStyleValues): any => ({ width: lodgingThumbnailSize, height: lodgingThumbnailSize }),
  // tabs/overview.tsx
  tabs_overview_31: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/overview.tsx
  tabs_overview_32: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 0 }),
  // tabs/overview.tsx
  tabs_overview_33: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 0 }),
  // tabs/overview.tsx
  tabs_overview_34: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto', paddingVertical: 6 }),
  // tabs/overview.tsx
  tabs_overview_35: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'flex-start', gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_36: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, gap: 4 }),
  // tabs/overview.tsx
  tabs_overview_37: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontStyle: 'italic' }),
  // tabs/overview.tsx
  tabs_overview_38: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontStyle: 'italic' }),
  // tabs/overview.tsx
  tabs_overview_39: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%' }),
  // tabs/overview.tsx
  tabs_overview_40: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 4 }),
  // tabs/overview.tsx
  tabs_overview_41: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 }),
  // tabs/overview.tsx
  tabs_overview_42: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.5 }),
  // tabs/overview.tsx
  tabs_overview_43: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ textDecorationLine: 'line-through', color: theme.colors.textMuted }),
  // tabs/overview.tsx
  tabs_overview_44: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexShrink: 0 }),
  // tabs/overview.tsx
  tabs_overview_45: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ top: 8, bottom: 8, left: 8, right: 8 }),
  // tabs/overview.tsx
  tabs_overview_46: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/overview.tsx
  tabs_overview_47: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_48: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/overview.tsx
  tabs_overview_49: (_theme: AppTheme, { isPhoneLayout }: ThemeStyleValues): any => ({ gap: isPhoneLayout ? 10 : 12, paddingBottom: 24 }),
  // tabs/overview.tsx
  tabs_overview_50: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ rowGap: 8 }),
  // tabs/overview.tsx
  tabs_overview_51: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto', gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_52: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 0, width: '100%' }),
  // tabs/overview.tsx
  tabs_overview_53: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }),
  // tabs/overview.tsx — header actions dropdown panel
  tabs_overview_actions_menu: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 8 }),
  // tabs/overview.tsx
  tabs_overview_54: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 12 }),
  // tabs/overview.tsx
  tabs_overview_55: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/overview.tsx
  tabs_overview_56: (_theme: AppTheme, { isPhoneLayout }: ThemeStyleValues): any => ({ gap: isPhoneLayout ? 10 : 12, paddingBottom: 24 }),
  // tabs/overview.tsx
  tabs_overview_57: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ rowGap: 8 }),
  // tabs/overview.tsx
  tabs_overview_58: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto', gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_59: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 0 }),
  // tabs/overview.tsx
  tabs_overview_60: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto', gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_61: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 0 }),
  // tabs/overview.tsx
  tabs_overview_62: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 6 }),
  // tabs/overview.tsx
  tabs_overview_63: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'flex-start' }),
  // tabs/overview.tsx
  tabs_overview_64: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_65: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxWidth: 200 }),
  // tabs/overview.tsx
  tabs_overview_66: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_67: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxWidth: 200 }),
  // tabs/overview.tsx
  tabs_overview_68: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_69: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, maxWidth: 160 }),
  // tabs/overview.tsx
  tabs_overview_70: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, maxWidth: 160 }),
  // tabs/overview.tsx
  tabs_overview_71: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ maxWidth: 200 }),
  // tabs/overview.tsx
  tabs_overview_72: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'flex-start' }),
  // tabs/overview.tsx
  tabs_overview_73: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 120 }),
  // tabs/overview.tsx
  tabs_overview_74: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // tabs/overview.tsx
  tabs_overview_75: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_76: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/overview.tsx
  tabs_overview_77: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/overview.tsx
  tabs_overview_78: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'flex-end', gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_79: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ top: 8, bottom: 8, left: 8, right: 8 }),
  // tabs/overview.tsx
  tabs_overview_80: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 10 }),
  // tabs/overview.tsx
  tabs_overview_81: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexWrap: 'wrap' }),
  // tabs/overview.tsx
  tabs_overview_82: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // tabs/overview.tsx
  tabs_overview_83: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_84: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // tabs/overview.tsx
  tabs_overview_85: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_86: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // tabs/overview.tsx
  tabs_overview_87: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_88: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginLeft: 'auto' }),
  // tabs/overview.tsx
  tabs_overview_89: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_90: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/overview.tsx
  tabs_overview_91: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderColor: _theme.colors.accentBorder, borderWidth: 1, marginBottom: 10 }),
  // tabs/overview.tsx
  tabs_overview_92: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 8 }),
  // tabs/overview.tsx
  tabs_overview_93: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderColor: _theme.colors.accentBorder, borderWidth: 1, marginBottom: 10, paddingVertical: 8 }),
  // tabs/overview.tsx
  tabs_overview_94: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme.colors.dangerText }),
  // tabs/overview.tsx
  tabs_overview_95: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, marginTop: 8 }),
  // tabs/overview.tsx
  tabs_overview_96: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.textMuted), // Previously linkText
  tabs_overview_97: (_theme: AppTheme, { isPhoneLayout }: ThemeStyleValues): any => ({ flexDirection: isPhoneLayout ? 'column' : 'row', gap: 12, marginTop: 4 }),
  tabs_overview_98: (_theme: AppTheme, { isPhoneLayout }: ThemeStyleValues): any => (isPhoneLayout ? { gap: 4 } : { gap: 4, flex: 1, maxWidth: 220 }),
  tabs_overview_99: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'column', alignItems: 'stretch', gap: 8 }),
  tabs_overview_100: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 4 }),
  tabs_overview_101: (_theme: AppTheme, { isPhoneLayout }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, ...(isPhoneLayout ? {} : { flexShrink: 0 }) }),
  tabs_overview_102: (_theme: AppTheme, { isPhoneLayout }: ThemeStyleValues): any => ([{ marginTop: 4, fontWeight: '600' }, isPhoneLayout ? { fontSize: 12 } : null]),
  tabs_overview_103: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor: _theme.colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }),
  tabs_overview_104: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 6, gap: 2 }),
  tabs_overview_105: (_theme: AppTheme, { lodgingThumbnailSize }: ThemeStyleValues): any => ({ fontSize: Math.round(lodgingThumbnailSize * 0.42) }),
  tabs_overview_106: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ fontWeight: '700', color: theme ? linkTextColor(theme) : undefined }),
  // tabs/traits.tsx
  tabs_traits_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 10 }),
  // tabs/traits.tsx
  tabs_traits_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center', justifyContent: 'space-between' }),
  // tabs/traits.tsx
  tabs_traits_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%' }),
  // tabs/traits.tsx
  tabs_traits_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/transfers.tsx
  tabs_transfers_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ height: 24, minWidth: 56, paddingHorizontal: 8, paddingVertical: 2 }),
  // tabs/transfers.tsx
  tabs_transfers_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minWidth: 0, paddingHorizontal: 6, paddingVertical: 2 }),
  // tabs/transfers.tsx
  tabs_transfers_3: (_theme: AppTheme, { x, y, width, height }: ThemeStyleValues): any => ({ x, y, width, height }),
  // tabs/transfers.tsx
  tabs_transfers_4: (_theme: AppTheme, { x, y, width, height }: ThemeStyleValues): any => ({ x, y, width, height }),
  // tabs/transfers.tsx
  tabs_transfers_5: (_theme: AppTheme, { x, containerOffset, y, width, height }: ThemeStyleValues): any => ({ x: x - containerOffset.x, y: y - containerOffset.y, width, height }),
  // tabs/transfers.tsx
  tabs_transfers_6: (_theme: AppTheme, { rect, inWindow, containerLeft, containerTop }: ThemeStyleValues): any => ({
        x: rect.left + (typeof window !== 'undefined' ? window.scrollX : 0) - (inWindow ? 0 : containerLeft),
        y: rect.top + (typeof window !== 'undefined' ? window.scrollY : 0) - (inWindow ? 0 : containerTop),
        width: rect.width,
        height: rect.height,
      }),
  // tabs/transfers.tsx
  tabs_transfers_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ x: 16, y: 120, width: 260, height: 40 }),
  // tabs/transfers.tsx
  tabs_transfers_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          padding: 0,
          margin: 0,
          zIndex: 50000,
          elevation: 50,
        }),
  // tabs/transfers.tsx
  tabs_transfers_9: (_theme: AppTheme, { showList }: ThemeStyleValues): any => ({ pointerEvents: showList ? 'auto' : 'box-none' }),
  // tabs/transfers.tsx
  tabs_transfers_10: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8 }),
  // tabs/transfers.tsx
  tabs_transfers_11: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }),
  // tabs/transfers.tsx
  tabs_transfers_12: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }),
  // tabs/transfers.tsx
  tabs_transfers_13: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginRight: 8 }),
  // tabs/transfers.tsx
  tabs_transfers_14: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', left: 0, zIndex: 4, backgroundColor: theme?.colors.surface }),
  // tabs/transfers.tsx
  tabs_transfers_15: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', right: 0, zIndex: 4, backgroundColor: theme?.colors.surface }),
  // tabs/transfers.tsx
  tabs_transfers_16: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', right: 0, zIndex: 3, backgroundColor: theme?.colors.surface }),
  // tabs/transfers.tsx
  tabs_transfers_17: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors.text }),
  // tabs/transfers.tsx
  tabs_transfers_18: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ position: 'sticky', left: 0, zIndex: 3, backgroundColor: theme?.colors.surface }),
  // tabs/transfers.tsx
  tabs_transfers_19: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }),
  // tabs/transfers.tsx
  tabs_transfers_20: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }),
  // tabs/transfers.tsx
  tabs_transfers_21: (_theme: AppTheme, { fixedTableColumn, colWidth, col }: ThemeStyleValues): any => ({ ...fixedTableColumn(colWidth(col)), position: 'relative' }),
  // tabs/transfers.tsx
  tabs_transfers_22: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8 }),
  // tabs/transfers.tsx
  tabs_transfers_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/transfers.tsx
  tabs_transfers_24: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ justifyContent: 'center' }),
  // tabs/transfers.tsx
  tabs_transfers_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.textMuted }),
  // tabs/transfers.tsx
  tabs_transfers_26: (_theme: AppTheme, { passengerAnchor }: ThemeStyleValues): any => ({
                left: passengerAnchor.x,
                top: passengerAnchor.y + passengerAnchor.height,
                width: passengerAnchor.width,
              }),
  // tabs/transfers.tsx
  tabs_transfers_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.transparent, zIndex: 52000, elevation: 80 }),
  // tabs/transfers.tsx
  tabs_transfers_28: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.transparent }),
  // tabs/transfers.tsx
  tabs_transfers_29: (_theme: AppTheme, { airportAnchor }: ThemeStyleValues): any => ({
                zIndex: 53000,
                elevation: 84,
                left: airportAnchor.x,
                top: airportAnchor.y + airportAnchor.height,
                width: airportAnchor.width || 280,
              }),
  // tabs/transfers.tsx
  tabs_transfers_30: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.overlay, justifyContent: 'center', alignItems: 'center', padding: 16 }),
  // tabs/transfers.tsx
  tabs_transfers_31: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: 500, maxHeight: '90%' }),
  // tabs/transfers.tsx
  tabs_transfers_32: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ height: 150, textAlignVertical: 'top', marginTop: 12, marginBottom: 16 }),
  // tabs/transfers.tsx
  tabs_transfers_33: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ opacity: 0.5 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 18 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 18, alignItems: 'center' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_4: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_5: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_6: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, minHeight: 0 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_7: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 16, paddingBottom: 32 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_8: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ width: '100%', maxWidth: 1200, alignSelf: 'center', gap: 20 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_9: (_theme: AppTheme, { surfaceColor }: ThemeStyleValues): any => ({ backgroundColor: surfaceColor, borderRadius: 16, padding: 18 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_10: (_theme: AppTheme, { compactMasthead }: ThemeStyleValues): any => ({ flexDirection: compactMasthead ? 'column' : 'row', alignItems: compactMasthead ? 'stretch' : 'center', justifyContent: 'space-between', gap: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_11: (_theme: AppTheme, { compactMasthead }: ThemeStyleValues): any => ({ flex: compactMasthead ? undefined : 1, minWidth: compactMasthead ? undefined : 200 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_12: (_theme: AppTheme, { textColor, displayFont }: ThemeStyleValues): any => ({ color: textColor, padding: 0, fontFamily: displayFont, fontSize: 26 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_13: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 14, marginTop: 2, padding: 0 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_14: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 11, marginTop: 2 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_15: (_theme: AppTheme, { compactMasthead }: ThemeStyleValues): any => ({ flex: compactMasthead ? undefined : 1, minWidth: compactMasthead ? undefined : 200 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_16: (_theme: AppTheme, { displayFont }: ThemeStyleValues): any => ({ fontFamily: displayFont, fontSize: 26 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_17: (_theme: AppTheme, { mutedColor, displayFontItalic }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 14, marginTop: 2, fontFamily: displayFontItalic }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_18: (_theme: AppTheme, { compactMasthead }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: compactMasthead ? 'flex-start' : 'flex-end', gap: 8, maxWidth: compactMasthead ? '100%' : '60%' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_19: (_theme: AppTheme, { editMode, theme }: ThemeStyleValues): any => ({ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: editMode ? (theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted) : (theme?.colors?.cta ?? _theme.colors.dangerAction) }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_20: (_theme: AppTheme, { editMode, textColor }: ThemeStyleValues): any => ({ color: editMode ? textColor : _theme.colors.onCta }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_21: (_theme: AppTheme, { theme, quickCapturing, uploading }: ThemeStyleValues): any => ({ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted, opacity: quickCapturing || uploading ? 0.6 : 1 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_22: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_23: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 6, paddingHorizontal: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_24: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors?.link ?? _theme.colors.linkText, fontWeight: '700' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_25: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_26: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors?.link ?? _theme.colors.linkText, fontWeight: '700' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_27: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6, marginBottom: 10 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_28: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 13 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_29: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ fontWeight: '700', color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_30: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 13 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_31: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ fontWeight: '700', color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_32: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 13 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_33: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ fontWeight: '700', color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_34: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 13 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_35: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ fontWeight: '700', color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_36: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 13 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_37: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ fontWeight: '700', color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_38: (_theme: AppTheme, { borderColor }: ThemeStyleValues): any => ({ flexDirection: 'row', borderWidth: 1, borderColor, borderRadius: 10, overflow: 'hidden', marginLeft: 'auto' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_39: (_theme: AppTheme, { selected, theme }: ThemeStyleValues): any => ({ paddingHorizontal: 9, paddingVertical: 2, backgroundColor: selected ? _theme.colors.selectedSurface : _theme.colors.transparent }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_40: (_theme: AppTheme, { selected, mutedColor }: ThemeStyleValues): any => ({ fontSize: 12, fontWeight: '700', color: selected ? _theme.colors.onSelected : mutedColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_41: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginBottom: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_42: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 10, borderWidth: 1, borderColor: _theme.colors.dangerBorder, borderRadius: 8, marginBottom: 12, backgroundColor: _theme.colors.surfaceMuted }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_43: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText, fontWeight: '700' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_44: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_45: (_theme: AppTheme, { textColor, borderColor, inputColor }: ThemeStyleValues): any => ({ color: textColor, borderWidth: 1, borderColor, borderRadius: 8, padding: 8, marginBottom: 4, lineHeight: 20, backgroundColor: inputColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_46: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, marginBottom: 4 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_47: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_48: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 6, paddingHorizontal: 10, minWidth: 160 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_49: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_50: (_theme: AppTheme, { canEdit, theme, surfaceColor, borderColor }: ThemeStyleValues): any => ({
              marginBottom: 20,
              backgroundColor: canEdit ? (theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted) : surfaceColor,
              borderRadius: 16,
              padding: 18,
              ...(canEdit ? { borderWidth: 1, borderColor: theme?.colors?.link ?? borderColor, borderStyle: 'dashed' as const } : {}),
            }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_51: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderRadius: 12, overflow: 'hidden', marginBottom: 10, minHeight: 160 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_52: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ borderRadius: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_53: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ minHeight: 160, justifyContent: 'flex-end', padding: 16, borderRadius: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_54: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_55: (_theme: AppTheme, { displayFont }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 24, fontFamily: displayFont, marginTop: 2 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_56: (_theme: AppTheme, { displayFontItalic }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent, fontSize: 14, marginTop: 4, fontFamily: displayFontItalic }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_57: (_theme: AppTheme, { compactMasthead, canEdit, showHeroHeader }: ThemeStyleValues): any => ({
                flexDirection: compactMasthead && canEdit ? 'column' : 'row',
                justifyContent: 'space-between',
                alignItems: canEdit ? (compactMasthead ? 'stretch' : 'flex-start') : 'center',
                gap: compactMasthead && canEdit ? 10 : 0,
                marginBottom: 8,
                display: showHeroHeader && !canEdit ? 'none' as const : 'flex' as const,
              }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_58: (_theme: AppTheme, { compactMasthead }: ThemeStyleValues): any => ({ flex: compactMasthead ? undefined : 1, marginRight: compactMasthead ? 0 : 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_59: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, padding: 0 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_60: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 11, marginTop: 1 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_61: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 13, marginTop: 4, padding: 0 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_62: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 11, marginTop: 2 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_63: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_64: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 11 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_65: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 13, marginTop: 2 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_66: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, flexShrink: 1 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_67: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 4, paddingHorizontal: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_68: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_69: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ paddingVertical: 4, paddingHorizontal: 8, backgroundColor: theme?.colors?.link ?? _theme.colors.premiumAction }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_70: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_71: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ paddingVertical: 4, paddingHorizontal: 8, backgroundColor: theme?.colors?.link ?? _theme.colors.premiumAction }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_72: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.error ?? _theme.colors.dangerAction }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_73: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_74: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 4, paddingHorizontal: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_75: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_76: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor: theme?.colors?.error ?? _theme.colors.dangerBorder, borderRadius: 8, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_77: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors?.error ?? _theme.colors.dangerText, flex: 1 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_78: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_79: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 4, marginBottom: 4 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_80: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surface, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_81: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ fontSize: 12.5, fontWeight: '600', color: theme?.colors?.link ?? _theme.colors.linkText }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_82: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ width: 100, height: 52, borderRadius: 10, backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surface }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_83: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 4, marginBottom: 4 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_84: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ fontSize: 12, color: theme?.colors?.textMuted ?? _theme.colors.text }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_85: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_86: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 11, marginBottom: 3 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_87: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12, marginBottom: 4 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_88: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12, marginTop: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_89: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_90: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_91: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_92: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_93: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_94: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_95: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_96: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.error ?? _theme.colors.dangerAction }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_97: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', paddingVertical: 5, marginTop: 5 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_98: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ color: theme?.colors?.link ?? _theme.colors.premiumText, fontWeight: '700' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_99: (_theme: AppTheme, { borderColor, inputColor }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor: inputColor, marginTop: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_100: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '600' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_101: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 4 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_102: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', marginTop: 8, backgroundColor: theme?.colors?.error ?? _theme.colors.dangerAction }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_103: (_theme: AppTheme, { borderColor, inputColor }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor: inputColor, marginTop: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_104: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '600' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_105: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, marginTop: 4 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_106: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_107: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 8, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_108: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', marginTop: 8, backgroundColor: theme?.colors?.error ?? _theme.colors.dangerAction }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_109: (_theme: AppTheme, { borderColor }: ThemeStyleValues): any => ({ marginTop: 8, borderTopWidth: 1, borderTopColor: borderColor, paddingTop: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_110: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 14 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_111: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700', marginBottom: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_112: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ borderLeftWidth: 3, borderLeftColor: theme?.colors?.link ?? _theme.colors.accentBorder, paddingLeft: 10, marginBottom: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_113: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '600' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_114: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_115: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 10 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_116: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_117: (_theme: AppTheme, { borderColor, inputColor }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor, borderRadius: 16, paddingVertical: 5, paddingHorizontal: 9, backgroundColor: inputColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_118: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_119: (_theme: AppTheme, { textColor, borderColor }: ThemeStyleValues): any => ({ color: textColor, borderWidth: 1, borderColor, borderRadius: 6, padding: 8, marginTop: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_120: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8, marginTop: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_121: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_122: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_123: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_124: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_125: (_theme: AppTheme, { borderColor }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor, borderRadius: 16, paddingVertical: 5, paddingHorizontal: 9 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_126: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_127: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ backgroundColor: _theme.colors.surfaceMuted, marginTop: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_128: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.text }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_129: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_130: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', backgroundColor: theme?.colors?.link ?? _theme.colors.premiumAction }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_131: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12, marginTop: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_132: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_133: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', paddingVertical: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_134: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontWeight: '700', fontSize: 13 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_135: (_theme: AppTheme, { surfaceColor }: ThemeStyleValues): any => ({ backgroundColor: surfaceColor, borderRadius: 16, padding: 18, marginTop: 6, gap: 14 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_136: (_theme: AppTheme, { borderColor, inputColor }: ThemeStyleValues): any => ({ padding: 10, borderWidth: 1, borderColor, borderRadius: 8, backgroundColor: inputColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_137: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_138: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_139: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ paddingVertical: 5, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_140: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_141: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flexDirection: 'row', gap: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_142: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 5, paddingHorizontal: 10 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_143: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ paddingVertical: 5, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_144: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_145: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_146: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 5, paddingHorizontal: 10 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_147: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ paddingVertical: 5, paddingHorizontal: 10 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_148: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_149: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.dangerText, marginTop: 8, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_150: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 6, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_151: (_theme: AppTheme, { borderColor, inputColor }: ThemeStyleValues): any => ({ padding: 10, borderWidth: 1, borderColor, borderRadius: 8, backgroundColor: inputColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_152: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_153: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 4, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_154: (_theme: AppTheme, { blog, theme }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', marginTop: 8, paddingVertical: 5, paddingHorizontal: 10, minHeight: 44, justifyContent: 'center', ...(blog?.photoLocationEnabled ? { backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted } : {}) }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_155: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_156: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 8, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_157: (_theme: AppTheme, { borderColor, inputColor }: ThemeStyleValues): any => ({ padding: 10, borderWidth: 1, borderColor, borderRadius: 8, backgroundColor: inputColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_158: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_159: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 4, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_160: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', marginTop: 8, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_161: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_162: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginTop: 8, gap: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_163: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_164: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_165: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 6 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_166: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_167: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_168: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ gap: 2 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_169: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_170: (_theme: AppTheme, { mapPreview }: ThemeStyleValues): any => ({ alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, opacity: mapPreview.length === 0 ? 0.5 : 1 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_171: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginTop: 8, fontSize: 12 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_172: (_theme: AppTheme, { borderColor, inputColor }: ThemeStyleValues): any => ({ borderWidth: 1, borderColor, borderRadius: 8, padding: 10, backgroundColor: inputColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_173: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontWeight: '700' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_174: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, fontSize: 11, marginTop: 2 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_175: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, justifyContent: 'flex-end', backgroundColor: _theme.colors.scrim }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_176: (_theme: AppTheme, { surfaceColor }: ThemeStyleValues): any => ({ backgroundColor: surfaceColor, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '85%' }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_177: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 18, fontWeight: 'bold', marginBottom: 4 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_178: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginBottom: 8, fontSize: 13 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_179: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted, marginTop: 14 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_180: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_181: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ flex: 1, justifyContent: 'flex-end', backgroundColor: _theme.colors.scrim }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_182: (_theme: AppTheme, { surfaceColor }: ThemeStyleValues): any => ({ backgroundColor: surfaceColor, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_183: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor, fontSize: 20, fontWeight: 'bold', marginBottom: 8 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_184: (_theme: AppTheme, { mutedColor }: ThemeStyleValues): any => ({ color: mutedColor, marginBottom: 20 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_185: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ marginBottom: 10 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_186: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ color: _theme.colors.onAccent }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_187: (_theme: AppTheme, { theme }: ThemeStyleValues): any => ({ backgroundColor: theme?.colors?.surfaceMuted ?? _theme.colors.surfaceMuted, marginTop: 10 }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_188: (_theme: AppTheme, { textColor }: ThemeStyleValues): any => ({ color: textColor }),
  // tabs/tripBlog.tsx
  tabs_tripBlog_189: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // tabs/tripBlog.tsx
  tabs_tripBlog_190: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // tabs/tripBlog.tsx
  tabs_tripBlog_191: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // tabs/tripBlog.tsx
  tabs_tripBlog_192: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surfaceMuted),
  // tabs/tripBlog.tsx
  tabs_tripBlog_193: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.accentSurface),
  // tabs/tripBlog.tsx
  tabs_tripBlog_194: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.overlay),
  // tabs/tripBlog.tsx
  tabs_tripBlog_195: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.overlay),
  // tabs/tripBlog.tsx
  tabs_tripBlog_196: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.overlay),
  // tabs/tripBlog.tsx
  tabs_tripBlog_197: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.transparent),
  // tabs/tripBlog.tsx
  tabs_tripBlog_198: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.accentSurface),
  // utils/keepsakeMapCapture.web.ts
  utils_keepsakeMapCapture_web_1: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ position: 'fixed', left: '-10000px', top: '0', width: '640px', height: '400px' }),
  // utils/keepsakeMapCapture.web.ts
  utils_keepsakeMapCapture_web_2: (_theme: AppTheme, {  }: ThemeStyleValues): any => ({ padding: 45, maxZoom: 13, duration: 0 }),
  // utils/keepsakeMapCapture.web.ts
  utils_keepsakeMapCapture_web_3: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.accentSurface),
  // utils/keepsakeMapCapture.web.ts
  utils_keepsakeMapCapture_web_4: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
  // utils/keepsakeMapCapture.web.ts
  utils_keepsakeMapCapture_web_5: (_theme: AppTheme, {  }: ThemeStyleValues): any => (_theme.colors.surface),
} as const;

export type ThemeStyleName = keyof typeof styleFactories;
type CachedStyle = { values: ThemeStyleValues; style: unknown };
const styleCache = new WeakMap<AppTheme, Map<ThemeStyleName, CachedStyle>>();

/** Reuse definitions until their theme or runtime measurements change. */
export const themeStyle = (name: ThemeStyleName, values: ThemeStyleValues, theme: AppTheme): any => {
  let cache = styleCache.get(theme);
  if (!cache) {
    cache = new Map();
    styleCache.set(theme, cache);
  }
  const previous = cache.get(name);
  const keys = Object.keys(values);
  if (previous && keys.length === Object.keys(previous.values).length && keys.every(key => Object.is(values[key], previous.values[key]))) {
    return previous.style;
  }
  const definition = styleFactories[name](theme, values);
  const style: unknown = definition && typeof definition === 'object' && !Array.isArray(definition)
    ? ('backgroundColor' in definition ? solidBackground(definition) : solidBackgrounds(definition))
    : definition;
  cache.set(name, { values: { ...values }, style });
  return style;
};

/** Fixed paper palettes for exported keepsakes. */
export const keepsakeThemes: KeepsakeTheme[] = [
  { key: 'classic', name: 'Classic', description: 'Crisp white with navy headings', page: '#FFFFFF', card: '#FFFFFF', text: '#1F2937', muted: '#6B7280', accent: '#152944', rule: '#E5E7EB' },
  { key: 'linen', name: 'Linen', description: 'Warm paper tones, like a travel journal', page: '#F6F1E7', card: '#FFFDF8', text: '#3B3024', muted: '#8A7A66', accent: '#9C6B3C', rule: '#E6DCC8' },
  { key: 'coastal', name: 'Coastal', description: 'Soft sea-glass blues', page: '#EAF4F6', card: '#FFFFFF', text: '#1E3A47', muted: '#5B7A86', accent: '#2E96A6', rule: '#CFE3E8' },
  { key: 'sunset', name: 'Sunset', description: 'Peach and terracotta warmth', page: '#FFF1E6', card: '#FFFFFF', text: '#4A2A1A', muted: '#9A6B55', accent: '#E0662F', rule: '#F6D9C6' },
  { key: 'midnight', name: 'Midnight', description: 'Deep navy, best on screen (uses more ink)', page: '#132238', card: '#1B3050', text: '#EEF2F7', muted: '#A9B8C9', accent: '#F5B041', rule: '#2B4468' },
];


/** Keep legacy native shadows out of styles compiled by React Native Web. */
export function shadowStyle(color: string, opacity: number, x: number, y: number, radius: number): ViewStyle {
  if (Platform.OS !== 'web') {
    return ({ shadowColor: color, shadowOpacity: opacity, shadowOffset: { width: x, height: y }, shadowRadius: radius });
  }
  const hex = color.replace(/^#/, '');
  const expanded = hex.length === 3 ? hex.split('').map(value => value + value).join('') : hex;
  const shadowColor = color.startsWith('#') && /^[\da-f]{6}$/i.test(expanded)
    ? `rgba(${parseInt(expanded.slice(0, 2), 16)},${parseInt(expanded.slice(2, 4), 16)},${parseInt(expanded.slice(4, 6), 16)},${opacity})`
    : `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`;
  return ({ boxShadow: `${x}px ${y}px ${radius}px ${shadowColor}` });
}


/**
 * A table cell must have an identical measured width in its header and in
 * every body row. `flex: 1` with only a minimum width allows content in one
 * row to redistribute the remaining space, which makes column borders drift.
 *
 * Keep the width fixed and let `HorizontalTableScroll` provide access to
 * overflow on compact native and web screens.
 */
export const fixedTableColumn = (width: number): ViewStyle => (({
  width,
  minWidth: width,
  maxWidth: width,
  flexGrow: 0,
  flexShrink: 0,
}));


export const horizontalTableLayout = {
  table: ({
    minWidth: '100%',
    alignSelf: 'flex-start',
  }) satisfies ViewStyle,
  scroll: ({
    width: '100%',
    maxWidth: '100%',
  }) satisfies ViewStyle,
  content: ({
    minWidth: '100%',
  }) satisfies ViewStyle,
};

export const rootErrorStyles = (_theme: AppTheme) => (StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: _theme.colors.surfaceMuted,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: _theme.colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  message: {
    color: _theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
}));

const stripAndroidFontWeights = <T extends Record<string, any>>(styles: T): T => {
  if (Platform.OS !== 'android') return styles;
  return Object.fromEntries(
    Object.entries(styles).map(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !('fontWeight' in value)) {
        return [key, value];
      }
      const { fontWeight: _fontWeight, ...rest } = value;
      return [key, rest];
    })
  ) as T;
};

export const buildStyles = (theme: AppTheme) => StyleSheet.create(solidBackgrounds(stripAndroidFontWeights({
  container: ({
    flex: 1,
    backgroundColor: theme.colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
  }),
  topBar: ({
    width: '100%',
    maxWidth: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  }),
  topBarStacked: ({
    alignItems: 'stretch',
    rowGap: 8,
  }),
  topBarLeft: ({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
    minWidth: 0,
  }),
  topBarLeftNarrow: ({
    flexWrap: 'wrap',
    minWidth: 0,
  }),
  brandIcon: ({
    width: 28,
    height: 28,
    borderRadius: 6,
  }),
  homeButton: ({
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  }),
  homeButtonText: ({
    color: theme.colors.onPrimary,
    fontSize: theme.typography.body,
    fontWeight: theme.typography.weightBold,
  }),
  backButton: ({
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  }),
  backButtonText: ({
    color: theme.colors.onPrimary,
    fontSize: theme.typography.body,
    fontWeight: theme.typography.weightBold,
  }),
  topRightWrapper: ({
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  }),
  topRightWrapperNarrow: ({
    width: '100%',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  }),
  topRight: ({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    flexShrink: 1,
  }),
  topRightNarrow: ({
    marginLeft: 'auto',
  }),
  contentScroll: ({
    minHeight: 0,
    flex: 1,
    width: '100%',
  }),
  contentScrollContent: ({
    alignItems: 'center',
    padding: 16,
    gap: 16,
  }),
  contentViewport: ({
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
  }),
  signedOutScroll: ({
    flex: 1,
    width: '100%',
    minHeight: 0,
  }),
  signedOutScrollContent: ({
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 24,
  }),
  pageScroll: ({
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    minHeight: 0,
  }),
  pageScrollContent: ({
    flexGrow: 1,
    padding: 16,
  }),
  pageScrollInner: ({
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    gap: 16,
  }),
  pageViewport: ({
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    minHeight: 0,
    padding: 16,
    alignItems: 'center',
    overflow: 'hidden',
  }),
  pageViewportInner: ({
    flex: 1,
    width: '100%',
    minHeight: 0,
    maxWidth: 1200,
    overflow: 'hidden',
  }),
  card: ({
    width: '100%',
    maxWidth: 1200,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  }),
  homeScrollContent: ({
    gap: 16,
  }),
  homeTitle: ({
    fontSize: theme.typography.h1,
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
    marginBottom: 4,
  }),
  homeHeroCard: ({
    position: 'relative',
    borderRadius: 20,
    overflow: 'hidden',
    minHeight: 180,
    backgroundColor: theme.colors.surfaceMuted,
  }),
  homeHeroCardPressed: ({
    opacity: 0.92,
    transform: [{ scale: 0.995 }],
  }),
  homeHeroImage: ({
    position: 'absolute',
    width: '100%',
    height: '100%',
  }),
  homeHeroFallback: ({
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: theme.colors.surfaceMuted,
  }),
  homeHeroOverlay: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
  }),
  homeHeroTextWrap: ({
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
    paddingRight: 150,
    maxWidth: '100%',
  }),
  homeHeroSubtitle: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.textMuted,
    fontSize: 16,
    lineHeight: 20,
  }),
  homeHeroTitle: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 38,
  }),
  homeHeroChangeTripBadge: ({
    position: 'absolute',
    right: 14,
    bottom: 14,
    backgroundColor: (theme ?? getAppTheme('light', 'light')).colors.changeTripSurface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: '90%',
  }),
  homeHeroChangeTripText: ({
    color: lightTheme.colors.text,
    fontSize: 12,
    fontWeight: '700',
  }),
  homeNavList: ({
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  }),
  homeNavButton: ({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  }),
  homeNavButtonPressed: ({
    backgroundColor: theme.colors.surfaceMuted,
  }),
  homeNavButtonDisabled: ({
    opacity: 0.5,
  }),
  homeNavIcon: ({
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  }),
  homeNavLabel: ({
    flex: 1,
    fontSize: 16,
    color: theme.colors.text,
  }),
  homeNavArrow: ({
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '600',
  }),
  homeModalOverlay: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.background,
    zIndex: 30000,
    padding: 16,
  }),
  homeModalCard: ({
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
  }),
  homeModalHeader: ({
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginBottom: 12,
    gap: 8,
  }),
  homeModalTitle: ({
    fontSize: 20,
    fontWeight: '600',
    color: theme.colors.text,
    flexShrink: 1,
  }),
  homeModalClose: ({
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  }),
  homeModalClosePressed: ({
    backgroundColor: theme.colors.backgroundAlt,
  }),
  homeModalCloseText: ({
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  }),
  homeModalList: ({
    flex: 1,
  }),
  homeModalRow: ({
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingVertical: 12,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  }),
  homeModalRowPressed: ({
    backgroundColor: theme.colors.surfaceMuted,
  }),
  homeModalRowActive: ({
    backgroundColor: theme.colors.backgroundAlt,
  }),
  homeModalRowText: ({
    flex: 1,
    minWidth: 0,
  }),
  homeModalRowTitle: ({
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  }),
  homeModalRowMeta: ({
    color: theme.colors.textMuted,
    fontSize: 13,
  }),
  homeModalActiveBadge: ({
    color: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.successText : (theme ?? getAppTheme('light', 'light')).colors.successText,
    fontSize: 12,
    fontWeight: '700',
  }),
  homeModalRowDelete: ({
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.dangerAction,
  }),
  homeModalRowDeletePressed: ({
    opacity: 0.8,
  }),
  homeModalRowDeleteText: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontWeight: theme.typography.weightBold,
    fontSize: 13,
  }),
  title: ({
    fontSize: theme.typography.h2,
    fontWeight: theme.typography.weightBold,
    color: theme.colors.text,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  }),
  titleNarrow: ({
    fontSize: 18,
    lineHeight: 22,
  }),
  auth: ({
    width: '100%',
    maxWidth: 420,
    marginTop: 40,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  }),
  toggleRow: ({
    flexDirection: 'row',
    marginBottom: 16,
  }),
  toggleButton: ({
    flex: 1,
    padding: 10,
    borderBottomWidth: 2,
    borderColor: theme.colors.border,
  }),
  toggleActive: ({
    borderColor: theme.colors.link,
  }),
  toggleText: ({
    textAlign: 'center',
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.textMuted,
  }),
  toggleGroup: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    position: 'relative',
    zIndex: 1,
  }),
  expenseToggleButton: ({
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.text,
    backgroundColor: theme.colors.surface,
  }),
  expenseToggleSelected: ({
    backgroundColor: (theme ?? getAppTheme('light', 'light')).colors.selectedSurface,
    borderColor: theme.colors.link,
  }),
  expenseToggleUnselected: ({
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.text,
  }),
  expenseToggleText: ({
    fontWeight: '600',
    color: theme.colors.text,
  }),
  expenseToggleTextSelected: ({
    color: theme.colors.onSelected,
  }),
  input: ({
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
    width: '100%',
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  }),
  button: ({
    ...ctaGradientStyle(theme),
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  }),
  buttonText: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onCta,
    fontWeight: theme.typography.weightBold,
  }),
  secondaryButton: ({
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  }),
  secondaryButtonText: ({
    color: theme.colors.text,
    fontWeight: theme.typography.weightBold,
  }),
  topBarActionButton: ({
    minHeight: 38,
    justifyContent: 'center',
    marginBottom: 0,
  }),
  topBarTripControl: ({
    minHeight: 38,
    marginBottom: 0,
    justifyContent: 'center',
    paddingVertical: 0,
  }),
  userNameButton: ({
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
    maxWidth: '100%',
  }),
  userNameButtonText: ({
    color: theme.colors.text,
    fontWeight: theme.typography.weightSemibold,
    flexShrink: 1,
  }),
  smallButton: ({
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  }),
  dangerButton: ({
    backgroundColor: theme.colors.dangerAction, // Previously error
  }),
  dangerButtonText: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontWeight: theme.typography.weightBold,
  }),
  toggleOption: ({
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  }),
  toggleOptionSelected: ({
    backgroundColor: (theme ?? getAppTheme('light', 'light')).colors.selectedSurface,
    borderColor: theme.colors.link,
  }),
  toggleOptionText: ({
    color: theme.colors.text,
    fontWeight: theme.typography.weightSemibold,
  }),
  toggleOptionTextSelected: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onSelected,
  }),
  navRow: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  }),
  navButton: ({
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.colors.surfaceMuted,
  }),
  navButtonActive: ({
    backgroundColor: theme.colors.primary,
  }),
  navButtonText: ({
    color: theme.colors.text,
    fontWeight: theme.typography.weightSemibold,
  }),
  navButtonActiveText: ({
    color: theme.colors.onPrimary,
  }),
  section: ({
    width: '100%',
    maxWidth: 1200,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  }),
  sectionTitle: ({
    fontSize: theme.typography.h3,
    fontWeight: theme.typography.weightBold,
    color: theme.colors.text,
    marginBottom: 8,
  }),
  helperText: ({
    color: theme.colors.textMuted,
    marginBottom: 8,
    fontSize: theme.typography.small,
  }),
  authErrorBanner: ({
    width: '100%',
    backgroundColor: theme.colors.dangerAction,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  }),
  authErrorBannerText: ({
    color: theme.colors.onPrimary,
    fontWeight: theme.typography.weightSemibold,
  }),
  row: ({
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
    flexWrap: 'wrap',
  }),
  sectionHeaderRow: ({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  }),
  sectionActions: ({
    marginLeft: 'auto',
    flexWrap: 'wrap',
    gap: 8,
  }),
  groupRow: ({
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  }),
  groupRowLast: ({
    borderBottomWidth: 0,
  }),
  table: ({
    ...horizontalTableLayout.table,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
  }),
  tableRow: ({
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  }),
  tableHeaderRow: ({
    backgroundColor: theme.colors.surfaceMuted,
  }),
  lastRow: ({
    borderBottomWidth: 0,
  }),
  tableHeader: ({
    backgroundColor: theme.colors.surfaceMuted,
  }),
  cell: ({
    padding: 8,
    borderRightWidth: 1,
    borderColor: theme.colors.border,
  }),
  tableHeaderCell: ({
    padding: 8,
    borderRightWidth: 1,
    borderColor: theme.colors.border,
  }),
  tableCell: ({
    padding: 8,
    borderRightWidth: 1,
    borderColor: theme.colors.border,
  }),
  lastCell: ({
    borderRightWidth: 0,
  }),
  headerText: ({
    fontWeight: theme.typography.weightBold,
    color: theme.colors.text,
  }),
  cellText: ({
    flexWrap: 'wrap',
    color: theme.colors.text,
  }),
  actionCell: ({
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  }),
  tableActionButton: ({
    minWidth: 72,
    height: 32,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  }),
  tableActionButtonPrimary: ({
    backgroundColor: theme.colors.selectedSurface,
  }),
  tableActionButtonDanger: ({
    backgroundColor: theme.colors.error,
  }),
  tableNameButton: ({
    alignSelf: 'flex-start',
  }),
  roundButton: ({
    width: 32,
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 0,
    justifyContent: 'center',
    alignItems: 'center',
  }),
  bodyText: ({
    fontSize: theme.typography.small,
    color: theme.colors.text,
  }),
  flightsSection: ({
    gap: 12,
  }),
  flightsList: ({
    gap: 8,
  }),
  flightCard: ({
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  }),
  flightTitle: ({
    fontSize: theme.typography.body,
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
  }),
  attendeeList: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  }),
  attendeeChip: ({
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 10,
    gap: 6,
    maxWidth: '100%',
  }),
  attendeeChipRemoving: ({
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.dangerAction : (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted,
  }),
  attendeeChipPending: ({
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.accentSurface : (theme ?? getAppTheme('light', 'light')).colors.accentSurface,
  }),
  attendeeText: ({
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
    flexShrink: 1,
  }),
  attendeeRemoveButton: ({
    marginLeft: 4,
  }),
  attendeeRemoveText: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.dangerText,
    fontWeight: 'bold',
  }),
  addTravelerForm: ({
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    gap: 8,
  }),
  flightEditorWrap: ({
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
  }),
  flightRow: ({
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  }),
  dailyExpenseDayCard: ({
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceMuted,
  }),
  dailyExpensesVerticalScroll: ({
    width: '100%',
    maxWidth: '100%',
    minHeight: 0,
  }),
  dailyExpensesVerticalContent: ({
    paddingBottom: 24,
  }),
  divider: ({
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 12,
  }),
  dayPill: ({
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  }),
  dayPillActive: ({
    backgroundColor: theme.colors.primary,
  }),
  dayPillText: ({
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
  }),
  dayPillActiveText: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
  }),
  dayPillNumber: ({
    fontWeight: theme.typography.weightBold,
    color: theme.colors.text,
    fontSize: theme.typography.caption,
  }),
  dayPillDate: ({
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  }),
  dayHeroCard: ({
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
  }),
  dayHeroImage: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  }),
  // Fills the whole day card like a photo would (dayHeroImage). As a plain flex child it only
  // spanned part of the card, leaving strips at the sides on phones.
  dayHeroImageFallback: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted,
  }),
  dayHeroOverlay: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
  }),
  dayHeroBadge: ({
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  }),
  dayHeroBadgeText: ({
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 999,
    fontWeight: '700',
    fontSize: 12,
    overflow: 'hidden',
  }),
  dayHeroTextWrap: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  }),
  dayHeroTitle: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  }),
  dayHeroAction: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  }),
  dayDetailsBackButton: ({
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 10,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  }),
  dayDetailsBackText: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontWeight: '600',
  }),
  dayNarrativeBox: ({
    gap: 8,
  }),
  dayInfoCard: ({
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  }),
  dayInfoRow: ({
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 6,
    alignItems: 'flex-start',
  }),
  dayInfoText: ({
    flex: 1,
    minWidth: 0,
  }),
  detailDeleteButton: ({
    flexShrink: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.dangerAction,
  }),
  detailDeleteButtonText: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontSize: 16,
    fontWeight: theme.typography.weightBold,
    lineHeight: 18,
  }),
  checklistCheckbox: ({
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.border : theme.colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: (theme ?? getAppTheme('light', 'light')).colors.transparent,
  }),
  checklistCheckboxChecked: ({
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.surface : theme.colors.text,
  }),
  checklistCheckboxMark: ({
    color: theme.mode === 'dark' ? theme.colors.surface : (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontSize: 12,
    fontWeight: theme.typography.weightBold,
    lineHeight: 14,
  }),
  lodgingImage: ({
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceMuted,
  }),
  lodgingImageFallback: ({
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  }),
  dayInfoRoute: ({
    fontSize: theme.typography.body,
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
    flexShrink: 1,
    flexWrap: 'wrap',
  }),
  dayInfoButton: ({
    alignSelf: 'center',
    paddingVertical: 6,
  }),
  dayInfoButtonText: ({
    color: theme.colors.text,
    fontWeight: theme.typography.weightSemibold,
  }),
  dayNextButton: ({
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 16,
    padding: 12,
  }),
  memberPill: ({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    maxWidth: '100%',
  }),
  pendingBlock: ({
    gap: 4,
    marginBottom: 4,
  }),
  removeText: ({
    color: theme.colors.dangerText,
    fontWeight: theme.typography.weightSemibold,
  }),
  linkText: ({
    color: theme.colors.linkText,
    textDecorationLine: 'underline',
  }),
  lodgingNameCol: fixedTableColumn(200),
  lodgingDateCol: fixedTableColumn(140),
  lodgingRoomsCol: fixedTableColumn(100),
  lodgingRefundCol: fixedTableColumn(160),
  lodgingCostCol: fixedTableColumn(120),
  lodgingPayerCol: fixedTableColumn(180),
  lodgingAddressCol: fixedTableColumn(220),
  lodgingActionCol: fixedTableColumn(180),
  lodgingTabNameCol: ({ flex: 1, minWidth: 160 }),
  lodgingTabDateCol: ({ flexGrow: 0, flexShrink: 0, minWidth: 110 }),
  lodgingTabActionsCol: ({ flexGrow: 0, flexShrink: 0, minWidth: 168 }),
  cellTextWrap: ({
    flexWrap: 'wrap',
    whiteSpace: 'normal',
  }),
  addRow: ({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  }),
  carFormSection: ({
    marginTop: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 10,
  }),
  carFormGrid: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'flex-start',
  }),
  carFormField: ({
    flex: 1,
    minWidth: 210,
    marginBottom: 0,
  }),
  carFormWideField: ({
    flexBasis: '100%',
    minWidth: 210,
    marginBottom: 0,
  }),
  carMemberRow: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-start',
  }),
  carMemberField: ({
    minWidth: 260,
  }),
  carAddButton: ({
    minHeight: 38,
    alignSelf: 'flex-end',
    marginLeft: 'auto',
  }),
  carEditorDialog: ({
    width: 'min(720px, 94vw)' as any,
    maxWidth: 720,
  }),
  carEditorScroll: ({
    maxHeight: 520,
  }),
  carEditorContent: ({
    gap: 10,
    paddingBottom: 8,
  }),
  inlineInput: ({
    flex: 1,
    marginVertical: 0,
  }),
  dropdown: ({
    position: 'relative',
    zIndex: 120,
  }),
  selectButton: ({
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  }),
  selectButtonRow: ({
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  }),
  placeholderText: ({
    color: theme.colors.textMuted,
  }),
  selectCaret: ({
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    marginLeft: 8,
  }),
  dropdownList: ({
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 8,
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted : (theme ?? getAppTheme('light', 'light')).colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    zIndex: 20000,
    elevation: 24,
    overflow: 'hidden',
    maxHeight: 280,
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 24px rgba(0,0,0,0.18)' } : null),
    ...shadowStyle((theme ?? getAppTheme('light', 'light')).colors.surfaceMuted, 0.18, 0, 8, 18),
  }),
  dropdownOption: ({
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted : (theme ?? getAppTheme('light', 'light')).colors.surface,
  }),
  dropdownOptionHover: ({
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted : (theme ?? getAppTheme('light', 'light')).colors.surface,
  }),
  dropdownOptionPressed: ({
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.accentSurface : (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted,
  }),
  prepaidSelectorButton: ({
    marginBottom: 0,
    minHeight: 42,
    borderColor: theme.colors.cta,
    backgroundColor: theme.colors.surfaceMuted,
  }),
  prepaidSelectorButtonSelected: ({
    backgroundColor: theme.colors.surface,
  }),
  prepaidSelectorText: ({
    fontWeight: theme.typography.weightSemibold,
  }),
  prepaidDropdownList: ({
    top: '100%',
    marginTop: 6,
    zIndex: 24000,
    elevation: 28,
  }),
  dateInputWrap: ({
    position: 'relative',
    justifyContent: 'center',
    flex: 1,
    minWidth: 220,
    maxWidth: '100%',
  }),
  dateIcon: ({
    position: 'absolute',
    right: 8,
    top: 10,
    padding: 6,
    zIndex: 2,
  }),
  dateTouchable: ({
    justifyContent: 'center',
  }),
  activeTrip: ({
    minWidth: 180,
    position: 'relative',
    zIndex: 2000,
  }),
  activeTripNarrow: ({
    flex: 1,
    minWidth: 0,
    maxWidth: '72%',
  }),
  warningText: ({
    color: theme.colors.dangerText,
    fontWeight: theme.typography.weightSemibold,
  }),
  passengerDropdown: ({
    zIndex: 3000,
    position: 'relative',
  }),
  passengerDropdownList: ({
    zIndex: 5000,
    elevation: 12,
  }),
  passengerOverlay: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 12000,
    elevation: 28,
  }),
  passengerOverlayBackdrop: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  }),
  passengerOverlayList: ({
    position: 'absolute',
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted : (theme ?? getAppTheme('light', 'light')).colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    zIndex: 13000,
    elevation: 32,
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 24px rgba(0,0,0,0.18)' } : null),
    ...shadowStyle((theme ?? getAppTheme('light', 'light')).colors.surfaceMuted, 0.18, 0, 8, 18),
    overflow: 'hidden',
  }),
  modalCard: ({
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 40,
    maxHeight: 520,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  }),
  expenseModalCard: ({
    maxWidth: 760,
    maxHeight: 640,
    overflow: 'visible',
  }),
  expenseModalScroll: ({
    maxHeight: 520,
    marginBottom: 8,
    overflow: 'visible',
  }),
  detailModal: ({
    maxHeight: 640,
    maxWidth: 720,
    width: '100%',
  }),
  expenseFieldRow: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    position: 'relative',
    zIndex: 10,
  }),
  expenseFieldDate: ({
    minWidth: 160,
    flexGrow: 1,
    flexBasis: 160,
    zIndex: 1,
  }),
  expenseFieldCategory: ({
    minWidth: 150,
    flexGrow: 1,
    flexBasis: 150,
    zIndex: 3,
  }),
  expenseFieldCurrency: ({
    minWidth: 110,
    flexGrow: 0,
    flexBasis: 110,
    zIndex: 2,
  }),
  expenseFieldAmount: ({
    minWidth: 120,
    flexGrow: 0,
    flexBasis: 120,
  }),
  expenseFieldVendor: ({
    minWidth: 180,
    flexGrow: 1,
    flexBasis: 180,
  }),
  expenseFieldNotes: ({
    minWidth: 240,
    flexGrow: 2,
    flexBasis: 260,
    minHeight: 42,
  }),
  detailModalScroll: ({
    maxHeight: 420,
    marginBottom: 8,
  }),
  detailSection: ({
    marginTop: 8,
    gap: 4,
  }),
  detailActionsRow: ({
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  }),
  modalLabel: ({
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
    marginTop: 8,
  }),
  modalLabelSmall: ({
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
    marginBottom: 4,
  }),
  modalRow: ({
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  }),
  modalField: ({
    flex: 1,
    position: 'relative',
    minWidth: 200,
    maxWidth: '100%',
    flexBasis: 0,
  }),
  inlineDropdownList: ({
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted : (theme ?? getAppTheme('light', 'light')).colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    zIndex: 14000,
    elevation: 40, // keep above other inputs on native
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 24px rgba(0,0,0,0.18)' } : null),
    ...shadowStyle((theme ?? getAppTheme('light', 'light')).colors.surfaceMuted, 0.18, 0, 8, 18),
  }),
  locationField: ({
    position: 'relative',
  }),
  tableScroll: {
    ...horizontalTableLayout.scroll,
  },
  tableScrollContent: {
    ...horizontalTableLayout.content,
  },  rangeContainer: ({
    gap: 6,
    marginBottom: 8,
  }),
  rangeLabels: ({
    flexDirection: 'row',
    justifyContent: 'space-between',
  }),
  itinerarySummary: ({
    marginTop: 8,
    gap: 4,
  }),
  planBox: ({
    marginTop: 12,
    padding: 12,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
  }),
  itineraryDropdown: ({
    zIndex: 6000,
  }),
  dropdownOverlay: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: (theme ?? getAppTheme('light', 'light')).colors.transparent,
    zIndex: 40000,
    elevation: 40,
  }),
  dropdownBackdrop: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.overlay : (theme ?? getAppTheme('light', 'light')).colors.overlay,
  }),
  dropdownPortal: ({
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
    backgroundColor: theme.mode === 'dark' ? (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted : (theme ?? getAppTheme('light', 'light')).colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 8,
    maxHeight: 360,
    zIndex: 41000,
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 24px rgba(0,0,0,0.18)' } : null),
    elevation: 60,
    ...shadowStyle((theme ?? getAppTheme('light', 'light')).colors.surfaceMuted, 0.18, 0, 8, 18),
  }),
  dropdownScroll: ({
    maxHeight: 300,
  }),
  traitGrid: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  }),
  traitChip: ({
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  }),
  traitChipSelected: ({
    backgroundColor: theme.mode === 'dark' ? theme.colors.link : theme.colors.primary,
    borderColor: theme.mode === 'dark' ? theme.colors.link : theme.colors.primary,
  }),
  traitChipText: ({
    color: theme.colors.text,
    fontWeight: theme.typography.weightSemibold,
  }),
  traitChipTextSelected: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
  }),
  attendeeChipContent: ({
    flexDirection: 'row',
    alignItems: 'center',
  }),
  badge: ({
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: theme.mode === 'dark' ? theme.colors.surface : (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted,
  }),
  badgePending: ({
    backgroundColor: (theme ?? getAppTheme('light', 'light')).colors.warningAction,
  }),
  badgeRemoved: ({
    backgroundColor: theme.mode === 'dark' ? theme.colors.surfaceMuted : (theme ?? getAppTheme('light', 'light')).colors.surfaceMuted,
  }),
  badgeText: ({
    fontSize: theme.typography.caption,
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
  }),
  buttonDisabled: ({
    opacity: 0.6,
  }),
  wizardOverlay: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: (theme ?? getAppTheme('light', 'light')).colors.overlay,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30000,
  }),
  wizardModal: ({
    width: '100%',
    maxWidth: 1200,
    maxHeight: '90%',
    flex: 1,
    alignSelf: 'center',
  }),
  pendingInviteModal: ({
    maxWidth: 720,
  }),
  inviteList: ({
    maxHeight: 360,
  }),
  inviteListContent: ({
    gap: 12,
  }),
  inviteCard: ({
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: theme.colors.surface,
  }),
  modalOverlay: ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: (theme ?? getAppTheme('light', 'light')).colors.scrim,
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 16,
    paddingTop: 24,
    zIndex: 20000,
  }),
  confirmModal: ({
    backgroundColor: theme.colors.surface,
    padding: 16,
    borderRadius: 10,
    width: '100%',
    maxWidth: 420,
    ...(Platform.OS === 'web' ? { boxShadow: '0 4px 10px rgba(0,0,0,0.25)' } : null),
    borderWidth: 1,
    borderColor: theme.colors.border,
  }),
  premiumTrialFeatureList: ({
    marginTop: 4,
    marginBottom: 12,
    gap: 2,
  }),
  planComparisonModal: ({
    maxWidth: 560,
  }),
  planComparisonGrid: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
    marginBottom: 12,
  }),
  planComparisonTier: ({
    flex: 1,
    minWidth: 210,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: theme.colors.surfaceMuted,
  }),
  planComparisonTierPremium: ({
    borderColor: theme.colors.premium,
    backgroundColor: theme.colors.surface,
  }),
  planComparisonTierTitle: ({
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontWeight: theme.typography.weightSemibold,
    marginBottom: 6,
  }),
  planComparisonFeatureList: ({
    gap: 4,
  }),
  planComparisonFeature: ({
    color: theme.colors.textMuted,
    fontSize: theme.typography.small,
    lineHeight: 20,
  }),
  planComparisonOptions: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  }),
  planComparisonOption: ({
    flex: 1,
    minWidth: 210,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.premiumAction, // Previously premium
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 84,
  }),
  planComparisonOptionTitle: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontSize: theme.typography.small,
    fontWeight: theme.typography.weightSemibold,
    marginBottom: 3,
  }),
  planComparisonOptionPrice: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontSize: theme.typography.body,
    fontWeight: theme.typography.weightBold,
    textAlign: 'center',
  }),
  planComparisonOptionTrial: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onAccent,
    fontSize: theme.typography.caption,
    marginTop: 4,
    textAlign: 'center',
  }),
  planComparisonMaybeLater: ({
    alignSelf: 'center',
    minWidth: 180,
    marginTop: 4,
  }),
  errorText: ({
    color: theme.colors.dangerText,
    fontSize: theme.typography.small,
    marginTop: 6,
    marginBottom: 6,
  }),
  payerChips: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 8,
  }),
  payerChip: ({
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 16,
    paddingVertical: 2,
    paddingHorizontal: 8,
    gap: 4,
  }),
  mapOptionButton: ({
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  }),
  mapOptionActive: ({
    borderColor: theme.mode === 'dark' ? theme.colors.link : theme.colors.primary,
    backgroundColor: theme.mode === 'dark' ? theme.colors.link : theme.colors.primary,
  }),
  mapOptionText: ({
    color: theme.colors.text,
    fontSize: theme.typography.small,
    fontWeight: theme.typography.weightSemibold,
  }),
  mapOptionActiveText: ({
    color: (theme ?? getAppTheme('light', 'light')).colors.onSelected,
  }),
  payerOptions: ({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  }),
})));


/** Export/print presentation, kept separate from the screen appearance. */
export const keepsakeCss = (theme: KeepsakeTheme): string => `
  :root { --page:${theme.page}; --card:${theme.card}; --text:${theme.text}; --muted:${theme.muted}; --accent:${theme.accent}; --rule:${theme.rule}; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: var(--page); }
  body { margin: 0; color: var(--text); font: 16px/1.65 Georgia, 'Times New Roman', serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 56px 28px 64px; }
  header { text-align: center; padding-bottom: 28px; margin-bottom: 32px; border-bottom: 1px solid var(--rule); }
  .eyebrow { font: 600 12px/1 system-ui, -apple-system, sans-serif; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); margin: 0 0 14px; }
  h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 44px; line-height: 1.1; margin: 0 0 10px; }
  .subtitle { font-family: 'Fraunces', Georgia, serif; font-style: italic; font-size: 19px; color: var(--muted); margin: 0 0 8px; }
  .range { font: 500 14px/1.4 system-ui, -apple-system, sans-serif; color: var(--muted); margin: 0; }
  .intro { font-size: 17px; margin: 0 0 14px; }
  .day { background: var(--card); border: 1px solid var(--rule); border-top: 4px solid var(--accent); border-radius: 14px; padding: 26px 28px 24px; margin: 0 0 26px; break-inside: avoid-page; }
  .day-date { font: 600 12px/1 system-ui, -apple-system, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); margin: 0 0 10px; }
  h2 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 27px; line-height: 1.2; margin: 0 0 8px; }
  .summary { font-style: italic; color: var(--muted); margin: 0 0 14px; }
  .day p { margin: 0 0 12px; }
  .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
  .photos.single { grid-template-columns: 1fr; }
  figure { margin: 0; break-inside: avoid; }
  img { display: block; width: 100%; max-height: 520px; object-fit: cover; border-radius: 10px; }
  .photos:not(.single) img { aspect-ratio: 4 / 3; height: auto; }
  figcaption { font: 13px/1.4 system-ui, -apple-system, sans-serif; color: var(--muted); margin-top: 6px; }
  footer { text-align: center; font: 12px/1.4 system-ui, -apple-system, sans-serif; color: var(--muted); margin-top: 36px; }
  @page { margin: 14mm; }
  @media print { .wrap { padding: 0; } }
`;

/** Export/print presentation, kept separate from the screen appearance. */
export const printableItineraryCss = `
    @page { size: Letter; margin: 0.62in; }
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; color: #18212b; background: #fff; }
    * { box-sizing: border-box; }
    body { margin: 0; font-size: 10.5pt; line-height: 1.45; }
    .cover { border-bottom: 4px solid #d06b3c; padding: 0 0 22px; margin-bottom: 22px; }
    .eyebrow { color: #d06b3c; font-size: 9pt; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
    h1 { color: #142c3c; font-family: Georgia, serif; font-size: 31pt; line-height: 1.08; margin: 7px 0 8px; }
    h2 { color: #142c3c; font-family: Georgia, serif; font-size: 18pt; margin: 0; }
    h3 { color: #142c3c; font-size: 12pt; margin: 3px 0 0; }
    .meta { color: #53616c; font-size: 10pt; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 18px 0; }
    .summary-card { background: #f1f5f3; border-left: 3px solid #6b9c8a; padding: 9px 11px; min-height: 46px; }
    .summary-card span { display: block; color: #687772; font-size: 8pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .summary-card strong { display: block; margin-top: 3px; }
    .intro { border-left: 3px solid #d06b3c; margin: 18px 0 25px; padding-left: 13px; white-space: pre-wrap; }
    .day { break-inside: avoid; margin: 0 0 25px; }
    .day-heading { align-items: baseline; border-bottom: 1px solid #cbd5d1; display: flex; gap: 12px; margin-bottom: 9px; padding-bottom: 6px; }
    .day-heading span { color: #d06b3c; font-size: 8.5pt; font-weight: 800; letter-spacing: .13em; }
    .item { border: 1px solid #dce4df; border-radius: 5px; break-inside: avoid; margin: 8px 0; padding: 10px 12px; }
    .item-heading { align-items: baseline; display: flex; gap: 10px; }
    .item-kind { color: #5f806f; font-size: 8pt; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 18px; margin-top: 7px; }
    .field { display: flex; gap: 5px; min-width: 0; }
    .field span { color: #66737b; flex: 0 0 auto; }
    .field strong { overflow-wrap: anywhere; }
    .item-note, .empty { color: #53616c; margin: 8px 0 0; }
    .time { color: #d06b3c; font-weight: 700; margin-top: 5px; }
    .checklist { list-style: none; margin: 8px 0 0; padding: 0; }
    .checklist .checked { color: #718078; text-decoration: line-through; }
    .practical { border-top: 2px solid #142c3c; break-inside: avoid; margin-top: 28px; padding-top: 12px; }
    .footer { border-top: 1px solid #dce4df; color: #7a858a; font-size: 8.5pt; margin-top: 30px; padding-top: 8px; }
    @media print { a { color: inherit; text-decoration: none; } .day-heading { break-after: avoid; } }
  `;

/** Export/print presentation, kept separate from the screen appearance. */
export const packingListPrintCss = `
    @page { size: letter landscape; margin: 0.4in; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, sans-serif; color: #111827; margin: 0; font-size: 10px; }
    h1 { font-size: 16px; margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1.5px solid #111827; }
    th, td { border: 1px solid #111827; padding: 4px 5px; text-align: left; vertical-align: middle; line-height: 1.2; }
    th { background: #F3F4F6; font-size: 8px; text-transform: uppercase; overflow-wrap: anywhere; }
    th:first-child, td:first-child { width: 34%; }
    .category td { background: #E5E7EB; font-weight: 700; padding: 5px; }
    .check { text-align: center; font-size: 12px; font-weight: 700; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    @media screen { body { padding: 24px; } }
  `;

export const keepsakeLoadingHtml = (theme: AppTheme): string => `<p style="font:16px system-ui;padding:24px;color:${theme.colors.textMuted};background:${theme.colors.surface}">Preparing your keepsake…</p>`;

export const mapFontFamily = "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif";

/** Keep the app viewport bounded, restoring document styles on unmount. */
export const applyDocumentLayout = (document: Document): (() => void) => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const previous = {
      htmlHeight: html.style.height,
      bodyHeight: body.style.height,
      bodyMargin: body.style.margin,
      bodyOverflow: body.style.overflow,
      rootHeight: root?.style.height ?? '',
    };
    html.style.height = '100%';
    body.style.height = '100%';
    body.style.margin = '0';
    body.style.overflow = 'hidden';
    if (root) root.style.height = '100%';
    return () => {
      html.style.height = previous.htmlHeight;
      body.style.height = previous.bodyHeight;
      body.style.margin = previous.bodyMargin;
      body.style.overflow = previous.bodyOverflow;
      if (root) root.style.height = previous.rootHeight;
    };
};

/** Stable identity colors with white-label contrast in both appearances. */
export const avatarPalette = ['#B91C1C', '#7E22CE', '#1D4ED8', '#155E75', '#166534', '#92400E', '#6D4C41', '#075985', '#9A3412', '#3F6212', '#115E59', '#3730A3'] as const;
export const avatarColor = (userId: string): string => {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return avatarPalette[hash % avatarPalette.length];
};

/** Fixed presentation measurements; viewport and item data remain caller inputs. */
export const layoutMetrics = {
  AssistantChatPanel_PANEL_WIDTH: 360,
  AssistantChatPanel_PANEL_HEIGHT: 480,
  BasicTripMap_web_HEIGHT: 400,
  BlogContributorStrip_AVATAR_SIZE: 22,
  BlogContributorStrip_OVERLAP: 6,
  ChatPanel_PANEL_WIDTH: 360,
  ChatPanel_PANEL_HEIGHT: 480,
  DayMediaGallery_MOSAIC_HEIGHT: 220,
  DayMediaLightbox_WIDE_LAYOUT_MIN_WIDTH: 700,
  PackingListMatrix_ITEM_WIDTH: 240,
  PackingListMatrix_TRAVELER_WIDTH: 110,
  PresenceAvatars_AVATAR_SIZE: 28,
  PresenceAvatars_OVERLAP: 8,
  transfers_CHAR_WIDTH_PX: 7.2,
  transfers_CELL_PADDING_PX: 32,
  transfers_MAX_COLUMN_WIDTH_PX: 420,
} as const;

export const richTextHeadingSizes: Record<number, number> = { 1: 24, 2: 21, 3: 18, 4: 17, 5: 16, 6: 16 };

export const themeFontFamilies = { display: 'Fraunces_600SemiBold', displayItalic: 'Fraunces_600SemiBold_Italic', bodyDisplay: 'Fraunces_400Regular' } as const;
