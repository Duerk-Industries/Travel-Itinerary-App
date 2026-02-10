import { StyleSheet } from 'react-native';

type WebStyle = Record<string, any>;

const warnOnce = (() => {
  const seen = new Set<string>();
  return (key: string, message: string) => {
    if (process.env.NODE_ENV === 'production') return;
    if (seen.has(key)) return;
    seen.add(key);
    // eslint-disable-next-line no-console
    console.warn(message);
  };
})();

export const toWebStyle = (style: any, extras?: WebStyle): WebStyle => {
  if (Array.isArray(style)) {
    warnOnce('webStyle-array', '[webStyle] style array passed to web element; flattening.');
  }
  const flattened = (StyleSheet.flatten(style) ?? {}) as WebStyle;
  const result = extras ? { ...flattened, ...extras } : flattened;
  return result;
};
