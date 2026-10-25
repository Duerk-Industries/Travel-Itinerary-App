import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
// Phase 4 of docs/trip-blog-social-implementation-plan.md (B2) — the comment/reply input box
// used both at the foot of BlogCommentThread.tsx and inline under a comment for a reply. Carries
// the "Visible publicly"/"Visible to travelers"/"Visible to followers" disclosure next to the
// submit action (architecture PR-8, PRD §6.5: "A public comment composer carries the persistent
// 'Visible publicly' label ... next to the submit action") — the caller decides the label from
// the target's own effective audience, this component just renders whatever it's given.
import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import AutoGrowTextInput from './AutoGrowTextInput';

type Props = {
  onSubmit: (body: string) => Promise<void>;
  placeholder?: string;
  audienceLabel?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  submitLabel?: string;
  onCancel?: () => void;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
  styles?: any;
  testID?: string;
};

const MAX_LENGTH = 2000;

const BlogCommentComposer: React.FC<Props> = ({
  onSubmit,
  placeholder = 'Write a comment…',
  audienceLabel = null,
  disabled = false,
  autoFocus = false,
  submitLabel = 'Post',
  onCancel,
  textColor: _textColorOverride,
  mutedColor: _mutedColorOverride,
  borderColor: _borderColorOverride,
  backgroundColor: _backgroundColorOverride,
  styles,
  testID,
}) => {
  const _styleTheme = useStyleTheme();
  const textColor = _textColorOverride ?? themeStyle('components_BlogCommentComposer_8', {  }, _styleTheme);
  const mutedColor = _mutedColorOverride ?? themeStyle('components_BlogCommentComposer_9', {  }, _styleTheme);
  const borderColor = _borderColorOverride ?? themeStyle('components_BlogCommentComposer_10', {  }, _styleTheme);
  const backgroundColor = _backgroundColorOverride ?? themeStyle('components_BlogCommentComposer_11', {  }, _styleTheme);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !disabled && !submitting && value.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(value.trim());
      setValue('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View testID={testID} style={themeStyle('components_BlogCommentComposer_1', {  }, _styleTheme)}>
      <AutoGrowTextInput
        testID={testID ? `${testID}-input` : undefined}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={mutedColor}
        editable={!disabled && !submitting}
        autoFocus={autoFocus}
        maxLength={MAX_LENGTH}
        minHeight={40}
        maxLines={8}
        lineHeight={20}
        style={themeStyle('components_BlogCommentComposer_2', { borderColor: borderColor, textColor: textColor, backgroundColor: backgroundColor }, _styleTheme)}
        accessibilityLabel={placeholder}
      />
      <View style={themeStyle('components_BlogCommentComposer_3', {  }, _styleTheme)}>
        {audienceLabel ? (
          <Text testID={testID ? `${testID}-audience-label` : undefined} style={themeStyle('components_BlogCommentComposer_4', { mutedColor: mutedColor }, _styleTheme)}>
            {audienceLabel}
          </Text>
        ) : <View />}
        <View style={themeStyle('components_BlogCommentComposer_5', {  }, _styleTheme)}>
          {onCancel ? (
            <TouchableOpacity testID={testID ? `${testID}-cancel` : undefined} accessibilityRole="button" onPress={onCancel} disabled={submitting}>
              <Text style={themeStyle('components_BlogCommentComposer_6', { mutedColor: mutedColor }, _styleTheme)}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            testID={testID ? `${testID}-submit` : undefined}
            accessibilityRole="button"
            accessibilityLabel={submitLabel}
            accessibilityState={{ disabled: !canSubmit }}
            disabled={!canSubmit}
            hitSlop={8}
            onPress={handleSubmit}
            style={[styles?.button, themeStyle('components_BlogCommentComposer_7', { canSubmit: canSubmit }, _styleTheme)]}
          >
            {submitting ? <ActivityIndicator size="small" color={styles?.buttonText?.color ?? themeStyle('components_BlogCommentComposer_12', {  }, _styleTheme)} /> : (
              <Text style={styles?.buttonText}>{submitLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default BlogCommentComposer;
