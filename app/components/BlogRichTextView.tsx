import { themeStyle, richTextHeadingSizes as HEADING_SIZES } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
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



const BlogRichTextView = ({ html, textColor: _textColorOverride, linkColor: _linkColorOverride, testID }: Props) => {
  const _styleTheme = useStyleTheme();
  const textColor = _textColorOverride ?? themeStyle('components_BlogRichTextView_16', {  }, _styleTheme);
  const linkColor = _linkColorOverride ?? themeStyle('components_BlogRichTextView_17', {  }, _styleTheme);
  const blocks = useMemo(() => parseBlogHtml(html), [html]);
  if (!blocks.length) return null;

  const renderRun = (run: BlogHtmlRun, index: number) => (
    <Text
      key={index}
      onPress={run.href ? () => { void Linking.openURL(run.href as string); } : undefined}
      accessibilityRole={run.href ? 'link' : undefined}
      style={themeStyle('richTextRun1', { run: run, linkColor: linkColor }, _styleTheme)}
    >
      {run.text}
    </Text>
  );

  const renderBlock = (block: BlogHtmlBlock, index: number) => {
    const blank = block.runs.every((run) => !run.text.trim());
    const last = index === blocks.length - 1;
    const base = themeStyle('components_BlogRichTextView_8', { textColor: textColor }, _styleTheme);
    const spacing = last ? 0 : blank ? 4 : 10;
    if (block.kind === 'listItem') {
      return (
        <View key={index} style={themeStyle('components_BlogRichTextView_9', { last: last }, _styleTheme)}>
          <Text style={themeStyle('components_BlogRichTextView_10', { base: base }, _styleTheme)}>{block.ordinal ? `${block.ordinal}.` : '•'}</Text>
          <Text style={themeStyle('components_BlogRichTextView_11', { base: base }, _styleTheme)}>{block.runs.map(renderRun)}</Text>
        </View>
      );
    }
    if (block.kind === 'heading') {
      const size = HEADING_SIZES[block.level ?? 3] ?? 18;
      return (
        <Text key={index} accessibilityRole="header" style={themeStyle('components_BlogRichTextView_12', { base: base, size: size, spacing: spacing }, _styleTheme)}>
          {block.runs.map(renderRun)}
        </Text>
      );
    }
    if (block.kind === 'quote') {
      return (
        <View key={index} style={themeStyle('components_BlogRichTextView_13', { linkColor: linkColor, spacing: spacing }, _styleTheme)}>
          <Text style={themeStyle('components_BlogRichTextView_14', { base: base }, _styleTheme)}>{block.runs.map(renderRun)}</Text>
        </View>
      );
    }
    return (
      <Text key={index} style={themeStyle('components_BlogRichTextView_15', { base: base, spacing: spacing }, _styleTheme)}>
        {block.runs.length ? block.runs.map(renderRun) : ' '}
      </Text>
    );
  };

  return <View testID={testID}>{blocks.map(renderBlock)}</View>;
};

export default BlogRichTextView;
