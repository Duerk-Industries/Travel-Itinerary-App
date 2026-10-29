import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View, type ViewProps } from 'react-native';

const KeyboardViewportContext = createContext(false);

/** The visible browser area can shrink without the layout viewport resizing. */
export function useVisibleWebViewport() {
  const _styleTheme = useStyleTheme();
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const visual = window.visualViewport;
    const update = () => {
      // Pinch zoom is not a keyboard resize. Do not reflow the app while zooming.
      if (visual && Math.abs(visual.scale - 1) > 0.01) return;
      const height = Math.round(visual?.height ?? window.innerHeight);
      const top = Math.max(0, Math.round(visual?.offsetTop ?? 0));
      if (height <= 0) return;
      setViewport(previous => previous?.height === height && previous.top === top ? previous : themeStyle('components_KeyboardViewport_1', { height: height, top: top }, _styleTheme));
    };
    update();
    window.addEventListener('resize', update);
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
    };
  }, [_styleTheme]);
  return viewport;
}

/** Bound pages (including their scroll views and footers) to the space above the keyboard. */
export default function KeyboardViewport({ children, style, independent = false, ...props }: ViewProps & { independent?: boolean }) {
  const _styleTheme = useStyleTheme();
  const parentHandlesKeyboard = useContext(KeyboardViewportContext);
  const viewport = useVisibleWebViewport();
  const handlesKeyboard = independent || !parentHandlesKeyboard;
  const content = Platform.OS === 'web' ? (
    <View {...props} style={[themeStyle('components_KeyboardViewport_2', {  }, _styleTheme), handlesKeyboard && themeStyle('components_KeyboardViewport_3', {  }, _styleTheme), style, handlesKeyboard && viewport ? themeStyle('components_KeyboardViewport_4', { viewport: viewport }, _styleTheme) as unknown as ViewProps['style'] : null]}>{children}</View>
  ) : (
    <KeyboardAvoidingView {...props} enabled={handlesKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[themeStyle('components_KeyboardViewport_5', {  }, _styleTheme), handlesKeyboard && themeStyle('components_KeyboardViewport_6', {  }, _styleTheme), style]}>
      {children}
    </KeyboardAvoidingView>
  );
  return <KeyboardViewportContext.Provider value>{content}</KeyboardViewportContext.Provider>;
}
