import { getAppTheme, linkTextColor } from '../theme/theme';

// WCAG relative luminance and contrast ratio.
const channel = (value: number) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const luminance = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const AA = 4.5;

describe.each(['light', 'dark'] as const)('%s theme text contrast', (mode) => {
  const theme = getAppTheme(mode, mode);
  const { colors } = theme;

  it('main text is readable on every surface', () => {
    for (const background of [colors.background, colors.surface, colors.surfaceMuted]) {
      expect(ratio(colors.text, background)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('link text is readable on every surface', () => {
    for (const background of [colors.background, colors.surface, colors.surfaceMuted]) {
      expect(ratio(linkTextColor(theme), background)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('muted text is readable on the page and card backgrounds it is used on', () => {
    for (const background of [colors.background, colors.surface]) {
      expect(ratio(colors.textMuted, background)).toBeGreaterThanOrEqual(AA);
    }
  });
});

it('uses a readable neutral link color in light mode', () => {
  const light = getAppTheme('light', 'light');
  expect(light.colors.link).toBe(light.colors.text);
  expect(ratio(linkTextColor(light), light.colors.surface)).toBeGreaterThanOrEqual(AA);
});

describe.each(['light', 'dark'] as const)('%s theme buttons', (mode) => {
  const theme = getAppTheme(mode, mode);

  it('button text is readable on both ends of the button gradient and on its solid fallback', () => {
    for (const stop of [...theme.gradients.cta, theme.colors.cta]) {
      expect(ratio(theme.colors.onCta, stop)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('white hero text is readable on both ends of the hero gradient', () => {
    for (const stop of theme.gradients.hero) {
      expect(ratio('#FFFFFF', stop)).toBeGreaterThanOrEqual(AA);
    }
  });
});
