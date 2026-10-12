// Read-only display of a blog note's rich text. Sizes exactly to its content (no frame, no
// scrolling, no trailing blank space) because it is plain React Native <Text>, not the WebView
// editor -- whose auto-height is unavailable under Expo. See utils/blogHtml.ts for what is parsed.
import React, { useMemo } from 'react';
import { Linking, Text, View } from 'react-native';
import { parseBlogHtml, type BlogHtmlBlock, type BlogHtmlRun } from '../utils/blogHtml';

type Props = {
  html: string;
  textColor?: string;
  linkColor?: string;
  testID?: string;
};

const HEADING_SIZES: Record<number, number> = { 1: 24, 2: 21, 3: 18, 4: 17, 5: 16, 6: 16 };

const BlogRichTextView = ({ html, textColor = '#111827', linkColor = '#2563eb', testID }: Props) => {
  const blocks = useMemo(() => parseBlogHtml(html), [html]);
  if (!blocks.length) return null;

  const renderRun = (run: BlogHtmlRun, index: number) => (
    <Text
      key={index}
      onPress={run.href ? () => { void Linking.openURL(run.href as string); } : undefined}
      accessibilityRole={run.href ? 'link' : undefined}
      style={{
        ...(run.bold ? { fontWeight: '700' as const } : {}),
        ...(run.italic ? { fontStyle: 'italic' as const } : {}),
        ...((run.underline || run.href) && run.strike ? { textDecorationLine: 'underline line-through' as const } : {}),
        ...((run.underline || run.href) && !run.strike ? { textDecorationLine: 'underline' as const } : {}),
        ...(!(run.underline || run.href) && run.strike ? { textDecorationLine: 'line-through' as const } : {}),
        ...(run.code ? { fontFamily: 'monospace' } : {}),
        ...(run.href ? { color: linkColor } : {}),
      }}
    >
      {run.text}
    </Text>
  );

  const renderBlock = (block: BlogHtmlBlock, index: number) => {
    const blank = block.runs.every((run) => !run.text.trim());
    const last = index === blocks.length - 1;
    const base = { color: textColor, fontSize: 16, lineHeight: 24 };
    const spacing = last ? 0 : blank ? 4 : 10;
    if (block.kind === 'listItem') {
      return (
        <View key={index} style={{ flexDirection: 'row', marginBottom: last ? 0 : 4, paddingLeft: 4 }}>
          <Text style={{ ...base, width: 22 }}>{block.ordinal ? `${block.ordinal}.` : '•'}</Text>
          <Text style={{ ...base, flex: 1 }}>{block.runs.map(renderRun)}</Text>
        </View>
      );
    }
    if (block.kind === 'heading') {
      const size = HEADING_SIZES[block.level ?? 3] ?? 18;
      return (
        <Text key={index} accessibilityRole="header" style={{ ...base, fontSize: size, lineHeight: Math.round(size * 1.3), fontWeight: '700', marginBottom: spacing }}>
          {block.runs.map(renderRun)}
        </Text>
      );
    }
    if (block.kind === 'quote') {
      return (
        <View key={index} style={{ borderLeftWidth: 3, borderLeftColor: linkColor, paddingLeft: 10, marginBottom: spacing }}>
          <Text style={{ ...base, fontStyle: 'italic' }}>{block.runs.map(renderRun)}</Text>
        </View>
      );
    }
    return (
      <Text key={index} style={{ ...base, marginBottom: spacing }}>
        {block.runs.length ? block.runs.map(renderRun) : ' '}
      </Text>
    );
  };

  return <View testID={testID}>{blocks.map(renderBlock)}</View>;
};

export default BlogRichTextView;
