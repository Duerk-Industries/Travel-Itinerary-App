// Phase 4 of docs/trip-blog-social-implementation-plan.md (B2) — the comment/reply input box
// used both at the foot of BlogCommentThread.tsx and inline under a comment for a reply. Carries
// the "Visible publicly"/"Visible to travelers"/"Visible to followers" disclosure next to the
// submit action (architecture PR-8, PRD §6.5: "A public comment composer carries the persistent
// 'Visible publicly' label ... next to the submit action") — the caller decides the label from
// the target's own effective audience, this component just renders whatever it's given.
import React, { useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
  textColor = '#111827',
  mutedColor = '#6b7280',
  borderColor = '#ccd4df',
  backgroundColor = '#ffffff',
  styles,
  testID,
}) => {
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
    <View testID={testID} style={{ gap: 6 }}>
      <TextInput
        testID={testID ? `${testID}-input` : undefined}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={mutedColor}
        editable={!disabled && !submitting}
        autoFocus={autoFocus}
        multiline
        maxLength={MAX_LENGTH}
        style={{
          borderWidth: 1, borderColor, borderRadius: 8, padding: 8, minHeight: 40,
          color: textColor, backgroundColor,
        }}
        accessibilityLabel={placeholder}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {audienceLabel ? (
          <Text testID={testID ? `${testID}-audience-label` : undefined} style={{ fontSize: 11, fontWeight: '600', color: mutedColor }}>
            {audienceLabel}
          </Text>
        ) : <View />}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {onCancel ? (
            <TouchableOpacity testID={testID ? `${testID}-cancel` : undefined} accessibilityRole="button" onPress={onCancel} disabled={submitting}>
              <Text style={{ color: mutedColor, fontWeight: '600', paddingVertical: 6, paddingHorizontal: 4 }}>Cancel</Text>
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
            style={[styles?.button, { opacity: canSubmit ? 1 : 0.5, paddingVertical: 6, paddingHorizontal: 12 }]}
          >
            {submitting ? <ActivityIndicator size="small" color={styles?.buttonText?.color ?? '#fff'} /> : (
              <Text style={styles?.buttonText}>{submitLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default BlogCommentComposer;
