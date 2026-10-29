/** @jest-environment node */
import { Platform, StyleSheet } from 'react-native';
import { buildStyles, getAppTheme, themeStyle, type ThemeStyleName } from '../theme/theme';

const contrast = (a: string, b: string) => {
  const luminance = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
const originalOS = Platform.OS;
afterEach(() => { Platform.OS = originalOS; });

it.each(['web', 'ios', 'android'] as const)('keeps composed action styles readable on %s in both appearances', platform => {
  Platform.OS = platform;
  for (const mode of ['light', 'dark'] as const) {
    const theme = { ...getAppTheme(mode, mode) };
    const shared = buildStyles(theme);
    const values = { theme, colors: theme.colors, typography: theme.typography, spacing: theme.spacing,
      StyleSheet, shadowStyle: () => ({}), getResponsivePanelWidth: () => 360, PANEL_HEIGHT: 480 };
    const readable = (name: string, text: string, background: string) => {
      expect({ name, passes: contrast(text, background) >= 4.5 }).toEqual({ name, passes: true });
    };
    for (const [bg, fg] of [['button', 'buttonText'], ['secondaryButton', 'secondaryButtonText'], ['dangerButton', 'dangerButtonText']] as const) {
      const composed = { ...shared.button, ...shared[bg] };
      readable(bg, shared[fg].color!, composed.backgroundColor!);
      if (bg !== 'button') expect((composed as Record<string, unknown>)[platform === 'web' ? 'backgroundImage' : 'experimental_backgroundImage']).toEqual(platform === 'web' ? 'none' : []);
    }
    for (const endpoint of [theme.colors.ctaGradientStart, theme.colors.ctaGradientEnd]) readable('CTA gradient endpoint', theme.colors.onCta, endpoint);
    const pairs: [ThemeStyleName, ThemeStyleName][] = [
      ['components_LandingPage_12', 'components_LandingPage_13'],
      ['components_PackingListTable_17', 'components_PackingListTable_18'],
      ['components_PlaidImportQueue_11', 'components_PlaidImportQueue_12'],
      ['components_PlaidLinkButton_1', 'components_PlaidLinkButton_2'],
      ['components_RetryableErrorBanner_3', 'components_RetryableErrorBanner_4'],
      ['tabs_AdminTab_304', 'tabs_AdminTab_305'],
    ];
    for (const [bg, fg] of pairs) readable(bg, themeStyle(fg, values, theme).color, themeStyle(bg, values, theme).backgroundColor);
    for (const key of ['components_ChatPanel_3', 'components_AssistantChatPanel_4'] as const) {
      const styles = themeStyle(key, values, theme);
      for (const [bg, fg] of [['header', 'headerBtnText'], ['sendBtn', 'sendBtnText'], ['ownBubble', 'ownText']]) {
        readable(`${key}.${bg}`, styles[fg].color, styles[bg].backgroundColor);
      }
      expect(styles.sendBtnDisabled.backgroundColor).toBeUndefined();
    }
    for (const active of [true, false]) {
      const selection = { ...values, source: { active }, selectedPresetKeys: active ? ['clothing'] : [], preset: { key: 'clothing' } };
      for (const [bg, fg] of [['components_PackingListTable_27', 'components_PackingListTable_28'], ['components_PackingListTable_29', 'components_PackingListTable_30']] as const) {
        readable(`${bg}.${active}`, themeStyle(fg, selection, theme).color, themeStyle(bg, selection, theme).backgroundColor);
      }
      for (const selectedMode of ['range', 'month']) {
        const dates = { ...values, dateModeSelected: selectedMode };
        for (const [bg, fg] of [['tabs_createTripWizard_16', 'tabs_createTripWizard_18'], ['tabs_createTripWizard_19', 'tabs_createTripWizard_20']] as const) {
          readable(`${bg}.${selectedMode}`, themeStyle(fg, dates, theme).color, themeStyle(bg, dates, theme).backgroundColor);
        }
      }
    }
  }
});
