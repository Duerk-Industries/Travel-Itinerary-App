import React from 'react';
import { Linking, Text } from 'react-native';

type InlineToken = { text: string; bold?: boolean; italic?: boolean; link?: string };

const parseInlineMarkdown = (input: string): InlineToken[] => {
  const tokens: InlineToken[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input))) {
    if (match.index > lastIndex) {
      tokens.push({ text: input.slice(lastIndex, match.index) });
    }
    if (match[2]) {
      tokens.push({ text: match[2], bold: true });
    } else if (match[3]) {
      tokens.push({ text: match[3], italic: true });
    } else if (match[4] && match[5]) {
      tokens.push({ text: match[4], link: match[5] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < input.length) {
    tokens.push({ text: input.slice(lastIndex) });
  }

  return tokens;
};

export const renderRichTextBlocks = (
  text: string,
  styles: {
    base: any;
    bold: any;
    italic: any;
    link: any;
    listItem?: any;
  }
): React.ReactNode[] => {
  const lines = text.split(/\r?\n/);
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <Text key={`rt-empty-${idx}`} style={styles.base}>{' '}</Text>;
    }

    const listMatch = /^([-*]|\d+\.)\s+/.exec(trimmed);
    const content = listMatch ? trimmed.replace(/^([-*]|\d+\.)\s+/, '') : trimmed;
    const tokens = parseInlineMarkdown(content);
    return (
      <Text key={`rt-${idx}`} style={listMatch ? [styles.base, styles.listItem] : styles.base}>
        {listMatch ? '• ' : ''}
        {tokens.map((token, i) => (
          <Text
            key={`rt-token-${idx}-${i}`}
            style={[token.bold ? styles.bold : null, token.italic ? styles.italic : null, token.link ? styles.link : null]}
            onPress={token.link ? () => Linking.openURL(token.link as string) : undefined}
          >
            {token.text}
          </Text>
        ))}
      </Text>
    );
  });
};
