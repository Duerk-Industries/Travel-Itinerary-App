import { getAppTheme, themeStyle } from '../theme/theme';

// R8: phone touch targets are at least 44 x 44.
describe('minimum touch targets', () => {
  const theme = getAppTheme('light', 'light');

  it('public-blog reaction buttons are at least 44 x 44', () => {
    const style = themeStyle('components_PublicTripBlogPage_2', { selectedReaction: null, emoji: 'heart' }, theme) as { minWidth: number; minHeight: number };
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });
});
