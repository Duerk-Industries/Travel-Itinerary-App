import React, { createContext, forwardRef, useContext } from 'react';
import { Text, type TextProps } from 'react-native';
import { useAppTheme } from '../theme/ThemeContext';
import { linkTextColor } from '../theme/theme';

/** True inside another ThemedText, where text should keep inheriting its parent's color. */
const InsideText = createContext(false);

export type ThemedTextProps = TextProps & {
  /** `muted` for secondary text, `link` for text that acts as a link or button. Default is the main text color. */
  tone?: 'muted' | 'link';
};

/**
 * Drop-in replacement for react-native's Text that follows light/dark mode. Plain Text has a fixed default color
 * (black), which disappears on a dark surface. This applies the theme's text color first and your `style` second, so
 * a color you set always wins. Text nested inside another ThemedText inherits as usual unless it asks for a tone.
 */
export const ThemedText = forwardRef<Text, ThemedTextProps>(function ThemedText({ style, tone, ...rest }, ref) {
  const theme = useAppTheme();
  const { colors } = theme;
  const nested = useContext(InsideText);
  const color = tone === 'muted' ? colors.textMuted : tone === 'link' ? linkTextColor(theme) : colors.text;
  // The provider wraps the Text rather than its children, so the Text's own children stay exactly as written.
  return (
    <InsideText.Provider value>
      <Text ref={ref} {...rest} style={nested && !tone ? style : [{ color }, style]} />
    </InsideText.Provider>
  );
});

export default ThemedText;
