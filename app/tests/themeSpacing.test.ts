/// <reference types="jest" />
/// <reference types="node" />

import { getAppTheme, hitSlop, MIN_TOUCH_TARGET } from '../theme/theme';

describe('theme spacing scale', () => {
  it('exposes an ascending spacing scale on both light and dark themes', () => {
    const light = getAppTheme('light', 'light');
    const dark = getAppTheme('dark', 'dark');

    expect(light.spacing).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });
    expect(dark.spacing).toEqual(light.spacing);

    const values = Object.values(light.spacing);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('provides hitSlop presets that extend small tap targets toward the recommended minimum', () => {
    expect(hitSlop.small).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
    expect(hitSlop.medium).toEqual({ top: 10, bottom: 10, left: 10, right: 10 });
    expect(MIN_TOUCH_TARGET).toBe(44);
  });
});
