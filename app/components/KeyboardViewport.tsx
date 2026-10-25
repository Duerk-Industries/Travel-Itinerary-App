import React, { createContext, useContext, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View, type ViewProps } from 'react-native';

const KeyboardViewportContext = createContext(false);

/** The visible browser area can shrink without the layout viewport resizing. */
export function useVisibleWebViewport() {
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
      setViewport(previous => previous?.height === height && previous.top === top ? previous : { height, top });
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
  }, []);
  return viewport;
}

/** Bound pages (including their scroll views and footers) to the space above the keyboard. */
export default function KeyboardViewport({ children, style, independent = false, ...props }: ViewProps & { independent?: boolean }) {
  const parentHandlesKeyboard = useContext(KeyboardViewportContext);
  const viewport = useVisibleWebViewport();
  const handlesKeyboard = independent || !parentHandlesKeyboard;
  const content = Platform.OS === 'web' ? (
    <View {...props} style={[{ minHeight: 0 }, handlesKeyboard && { flex: 1 }, style, handlesKeyboard && viewport ? {
      position: 'fixed', left: 0, right: 0, top: viewport.top,
      height: viewport.height, maxHeight: viewport.height,
    } as unknown as ViewProps['style'] : null]}>{children}</View>
  ) : (
    <KeyboardAvoidingView {...props} enabled={handlesKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[{ minHeight: 0 }, handlesKeyboard && { flex: 1 }, style]}>
      {children}
    </KeyboardAvoidingView>
  );
  return <KeyboardViewportContext.Provider value>{content}</KeyboardViewportContext.Provider>;
}
