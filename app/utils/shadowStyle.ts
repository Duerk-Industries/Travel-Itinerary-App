import { Platform, type ViewStyle } from 'react-native';

/** Keep legacy native shadows out of styles compiled by React Native Web. */
export function shadowStyle(color: string, opacity: number, x: number, y: number, radius: number): ViewStyle {
  if (Platform.OS !== 'web') {
    return { shadowColor: color, shadowOpacity: opacity, shadowOffset: { width: x, height: y }, shadowRadius: radius };
  }
  const hex = color.replace(/^#/, '');
  const expanded = hex.length === 3 ? hex.split('').map(value => value + value).join('') : hex;
  const shadowColor = color.startsWith('#') && /^[\da-f]{6}$/i.test(expanded)
    ? `rgba(${parseInt(expanded.slice(0, 2), 16)},${parseInt(expanded.slice(2, 4), 16)},${parseInt(expanded.slice(4, 6), 16)},${opacity})`
    : `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`;
  return { boxShadow: `${x}px ${y}px ${radius}px ${shadowColor}` };
}
