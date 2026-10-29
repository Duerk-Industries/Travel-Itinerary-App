import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// A multiline TextInput that is as tall as its text: one line when empty or short, growing as
// lines are added, and only scrollable once the text needs more than `maxLines` lines. A plain
// multiline TextInput keeps a fixed height (two rows on web), which leaves blank space under a short
// comment and scrolls inside the box as soon as it overflows.
import React, { forwardRef, useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

type Props = TextInputProps & {
  /** Height of a single line of text including vertical padding. */
  minHeight?: number;
  /** Grow up to this many lines of text before scrolling. */
  maxLines?: number;
  lineHeight?: number;
};

const AutoGrowTextInput = forwardRef<TextInput, Props>(({ minHeight = 40, maxLines = 8, lineHeight = 20, style, onContentSizeChange, ...rest }, ref) => {
  const _styleTheme = useStyleTheme();
  const [contentHeight, setContentHeight] = useState(0);
  // minHeight already includes padding, so the cap is "padding + maxLines of text".
  const maxHeight = minHeight - lineHeight + maxLines * lineHeight;
  const height = Math.min(maxHeight, Math.max(minHeight, contentHeight));
  return (
    <TextInput
      ref={ref}
      {...rest}
      multiline
      numberOfLines={1}
      scrollEnabled={contentHeight > maxHeight}
      onContentSizeChange={(event) => {
        setContentHeight(Math.ceil(event.nativeEvent.contentSize.height));
        onContentSizeChange?.(event);
      }}
      style={[style, themeStyle('components_AutoGrowTextInput_1', { height: height, minHeight: minHeight, maxHeight: maxHeight }, _styleTheme)]}
    />
  );
});
AutoGrowTextInput.displayName = 'AutoGrowTextInput';

export default AutoGrowTextInput;
