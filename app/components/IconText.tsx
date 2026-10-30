import React from 'react';
import { StyleSheet, Text, type TextProps } from 'react-native';
import Icon, { type IconName } from './Icon';
import { useAppTheme } from '../theme/ThemeContext';

/** UI glyph aliases only. User-authored text continues to use React Native Text. */
export const UI_ICON_GLYPHS: Readonly<Record<string, IconName>> = {
  '🗑': 'trash', '✕': 'close', '✖': 'close', '×': 'close',
  '👍': 'thumbsUp', '👎': 'thumbsDown', '👤': 'profile', '🔔': 'bell',
  '🏨': 'lodging', '📍': 'pin', '📝': 'note', '📋': 'checklist',
  '✅': 'checkbox', '☑': 'checkbox', '☐': 'square', '✓': 'check', '✔': 'check',
  '📷': 'camera', '📸': 'camera', '🎬': 'video', '🎞': 'video',
  '🎙': 'microphone', '🖼': 'image', '💡': 'bulb', '✨': 'sparkle',
  '🗓': 'calendar', '📅': 'calendar', '✏': 'edit', '✎': 'edit',
  '🧭': 'compass', '👀': 'eye', '👋': 'wave', '✈': 'flight',
  '🚆': 'transfer', '🚗': 'car', '🎟': 'activity', '🎫': 'activity',
  '♥': 'heart', '❤': 'heart', '😂': 'smile', '😮': 'wow', '🔥': 'fire',
  '👏': 'clap', '🙏': 'thanks', '🏆': 'trophy', '💬': 'chat', '⚠': 'warning',
  '⭐': 'star', '☆': 'star', '★': 'star', '○': 'circle', '●': 'circle',
  '🌤': 'sun', '☀': 'sun', '🌞': 'sun', '🌥': 'cloud', '☁': 'cloud',
  '⛅': 'cloud', '🌦': 'rain', '🌧': 'rain', '⛈': 'rain', '🌩': 'rain',
  '❄': 'snow', '🌨': 'snow', '☔': 'rain', '🌫': 'cloud',
  '↶': 'undo', '↷': 'redo', '▲': 'up', '▼': 'down', '▾': 'down', '▴': 'up',
  '▸': 'forward', '▶': 'play', '↑': 'up', '↓': 'down', '↗': 'share', '•': 'circle',
  '←': 'back', '➜': 'forward', '＋': 'plus', '+': 'plus',
};

/** Render legacy UI icon labels through the same SVG geometry, stroke and theme as Icon. */
const IconText = React.forwardRef<Text, TextProps>(function IconText({ children, style, accessibilityLabel, ...props }, ref) {
  const theme = useAppTheme();
  const flattened = StyleSheet.flatten(style);
  const color = typeof flattened?.color === 'string' ? flattened.color : theme.colors.text;
  const size = typeof flattened?.fontSize === 'number' ? flattened.fontSize : theme.typography.body;
  const labelChildren = React.Children.toArray(children);
  const inferredLabel = labelChildren.every(child => typeof child === 'string' || typeof child === 'number')
    ? labelChildren.map(child => Array.from(String(child)).map(glyph => {
        if (glyph === '\uFE0F' || glyph === '\uFE0E') return '';
        const name = UI_ICON_GLYPHS[glyph];
        return name ? ` ${name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} ` : glyph;
      }).join('')).join('').replace(/\s+/g, ' ').trim()
    : undefined;
  const renderChild = (child: React.ReactNode): React.ReactNode => {
    if (typeof child !== 'string') return child;
    const parts: React.ReactNode[] = [];
    let text = '';
    let index = 0;
    const flush = () => { if (text) { parts.push(text); text = ''; } };
    for (const glyph of child) {
      if (glyph === '\uFE0F' || glyph === '\uFE0E') continue;
      const name = UI_ICON_GLYPHS[glyph];
      if (name) {
        flush();
        parts.push(<Icon key={`icon-${index++}`} name={name} size={size} color={color} />);
      } else text += glyph;
    }
    flush();
    return parts;
  };
  return <Text {...props} ref={ref} style={style} accessibilityLabel={accessibilityLabel ?? (inferredLabel || undefined)}>
    {React.Children.map(children, renderChild)}
  </Text>;
});

export default IconText;
